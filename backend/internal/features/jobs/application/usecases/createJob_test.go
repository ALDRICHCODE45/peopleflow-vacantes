// Unit tests for the CreateJob use case (design D5/D8).
//
// CreateJob implements the 8-step deterministic flow pinned by
// design §4.2:
//
//  1. trim + non-empty title/description (ErrEmptyTitle / ErrEmptyDescription)
//  2. parse work_mode / employment_type / seniority (VO sentinels)
//  3. salary_currency nil -> MXN; else parse (D5)
//  4. salary_min <= salary_max when both present (ErrInvalidSalaryRange)
//  5. uuid.NewV7() for id (D4)
//  6. build repositories.CreateJobParams
//  7. repo.Create (propagate ErrCompanyNotActive / ErrCompanyGone /
//     ErrInvalidStatusTransition untouched)
//  8. project toEditorView -- reuse the package-private helper from
//     updateJob.go (D2 no parallel projection)
//
// The stub (writeStubRepo) was extended in Phase 1.2 with a
// programmable Create surface (createOut / createErr + captured
// lastCreateID / lastCreateCompany / lastCreateParams).
package usecases

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// --- helpers ----------------------------------------------------------

// validCreateDto returns a fully-populated DTO that should pass every
// validation step. Tests mutate individual fields to exercise one
// branch at a time.
func validCreateDto() dtos.CreateJobDto {
	return dtos.CreateJobDto{
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "senior",
		SalaryCurrency: strPtrDto("MXN"),
	}
}

func strPtrDto(s string) *string { return &s }
func intPtrDto(i int) *int       { return &i }

// --- step 1: trim + non-empty title/description -----------------------

// TestCreateJob_EmptyTitleRejectedAfterTrim pins step 1: a whitespace
// title after trim must surface ErrEmptyTitle (handler -> 400).
func TestCreateJob_EmptyTitleRejectedAfterTrim(t *testing.T) {
	repo := &writeStubRepo{}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.Title = "   "

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if !errors.Is(err, entities.ErrEmptyTitle) {
		t.Fatalf("err: want ErrEmptyTitle, got %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("Create must NOT be called on empty title, got %d calls", repo.createCalls)
	}
}

// TestCreateJob_EmptyDescriptionRejected pins step 1 for description.
func TestCreateJob_EmptyDescriptionRejected(t *testing.T) {
	repo := &writeStubRepo{}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.Description = ""

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if !errors.Is(err, entities.ErrEmptyDescription) {
		t.Fatalf("err: want ErrEmptyDescription, got %v", err)
	}
}

// TestCreateJob_TitleTrimmedBeforeForwarding pins the trim side of
// step 1: leading/trailing whitespace is stripped before being handed
// to the repo. The stub captures lastCreateParams.
func TestCreateJob_TitleTrimmedBeforeForwarding(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updated := time.Now().UTC()
	repo := &writeStubRepo{
		createOut: &entities.JobForUpdate{
			ID:             jobID,
			Title:          "Backend Engineer",
			Description:    "Go + Postgres",
			WorkMode:       valueobjects.Remote,
			EmploymentType: valueobjects.FullTime,
			Seniority:      valueobjects.SeniorSeniority,
			JobStatus:      valueobjects.Draft,
			SalaryCurrency: valueobjects.MXN,
			UpdatedAt:      updated,
			Company:        entities.CompanyRef{ID: companyID, Name: "Acme"},
		},
	}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.Title = "  Backend Engineer  "
	in.Description = "  Go + Postgres  "

	view, err := svc.CreateJob(context.Background(), companyID, in)
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil, got nil")
	}
	if repo.lastCreateParams.Title != "Backend Engineer" {
		t.Errorf("Title: want trimmed %q, got %q", "Backend Engineer", repo.lastCreateParams.Title)
	}
	if repo.lastCreateParams.Description != "Go + Postgres" {
		t.Errorf("Description: want trimmed %q, got %q", "Go + Postgres", repo.lastCreateParams.Description)
	}
}

// --- step 2: VO parse -----------------------------------------------

// TestCreateJob_UnknownVOsRejected pins step 2: each closed-set VO
// surfaces its own sentinel (handler -> 400).
func TestCreateJob_UnknownVOsRejected(t *testing.T) {
	tests := []struct {
		name string
		mut  func(*dtos.CreateJobDto)
		want error
	}{
		{
			name: "unknown work_mode",
			mut:  func(d *dtos.CreateJobDto) { d.WorkMode = "telecommute" },
			want: valueobjects.ErrInvalidWorkMode,
		},
		{
			name: "unknown employment_type",
			mut:  func(d *dtos.CreateJobDto) { d.EmploymentType = "freelance" },
			want: valueobjects.ErrInvalidEmploymentType,
		},
		{
			name: "unknown seniority",
			mut:  func(d *dtos.CreateJobDto) { d.Seniority = "principal" },
			want: valueobjects.ErrInvalidSeniority,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &writeStubRepo{}
			svc := NewJobService(repo)
			in := validCreateDto()
			tt.mut(&in)

			_, err := svc.CreateJob(context.Background(), uuid.New(), in)
			if !errors.Is(err, tt.want) {
				t.Errorf("err: want %v, got %v", tt.want, err)
			}
			if repo.createCalls != 0 {
				t.Errorf("Create must NOT be called on bad VO, got %d calls", repo.createCalls)
			}
		})
	}
}

// --- step 3: currency default (D5) ----------------------------------

// TestCreateJob_SalaryCurrencyNilDefaultsToMXN pins D5: when the DTO
// leaves salary_currency nil, the use case resolves it to MXN before
// forwarding to the repo.
func TestCreateJob_SalaryCurrencyNilDefaultsToMXN(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updated := time.Now().UTC()
	repo := &writeStubRepo{
		createOut: &entities.JobForUpdate{
			ID:             jobID,
			Title:          "Backend Engineer",
			Description:    "Go + Postgres",
			WorkMode:       valueobjects.Remote,
			EmploymentType: valueobjects.FullTime,
			Seniority:      valueobjects.SeniorSeniority,
			JobStatus:      valueobjects.Draft,
			SalaryCurrency: valueobjects.MXN,
			UpdatedAt:      updated,
			Company:        entities.CompanyRef{ID: companyID, Name: "Acme"},
		},
	}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.SalaryCurrency = nil // explicitly absent

	_, err := svc.CreateJob(context.Background(), companyID, in)
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if repo.lastCreateParams.SalaryCurrency != valueobjects.MXN {
		t.Errorf("SalaryCurrency: want MXN (default), got %v", repo.lastCreateParams.SalaryCurrency)
	}
}

// TestCreateJob_SalaryCurrencyUSDForwards pins the value branch of
// step 3: an explicit USD string is parsed and forwarded.
func TestCreateJob_SalaryCurrencyUSDForwards(t *testing.T) {
	repo := &writeStubRepo{
		createOut: makeStubForUpdate(uuid.New(), uuid.New(), time.Now()),
	}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.SalaryCurrency = strPtrDto("USD")

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if repo.lastCreateParams.SalaryCurrency != valueobjects.USD {
		t.Errorf("SalaryCurrency: want USD, got %v", repo.lastCreateParams.SalaryCurrency)
	}
}

// TestCreateJob_SalaryCurrencyUnknownRejected pins step 3's parse
// failure: an unknown currency string surfaces ErrInvalidSalaryCurrency.
func TestCreateJob_SalaryCurrencyUnknownRejected(t *testing.T) {
	repo := &writeStubRepo{}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.SalaryCurrency = strPtrDto("EUR")

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if !errors.Is(err, valueobjects.ErrInvalidSalaryCurrency) {
		t.Fatalf("err: want ErrInvalidSalaryCurrency, got %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("Create must NOT be called on bad currency, got %d calls", repo.createCalls)
	}
}

// --- step 4: salary range ------------------------------------------

// TestCreateJob_SalaryRangeRejectedWhenBothPresent pins step 4: when
// BOTH salary_min and salary_max are present and salary_min > salary_max,
// the use case surfaces ErrInvalidSalaryRange. Mirrors PATCH.
func TestCreateJob_SalaryRangeRejectedWhenBothPresent(t *testing.T) {
	repo := &writeStubRepo{}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.SalaryMin = intPtrDto(10000)
	in.SalaryMax = intPtrDto(5000)

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if !errors.Is(err, entities.ErrInvalidSalaryRange) {
		t.Fatalf("err: want ErrInvalidSalaryRange, got %v", err)
	}
}

// TestCreateJob_SalaryMinOnlyAllowed pins the spec scenario: a lone
// salary_min (no max) is permitted (transient state).
func TestCreateJob_SalaryMinOnlyAllowed(t *testing.T) {
	repo := &writeStubRepo{
		createOut: makeStubForUpdate(uuid.New(), uuid.New(), time.Now()),
	}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.SalaryMin = intPtrDto(10000)
	in.SalaryMax = nil

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if repo.createCalls != 1 {
		t.Fatalf("Create must be called once, got %d", repo.createCalls)
	}
	if repo.lastCreateParams.SalaryMin == nil || *repo.lastCreateParams.SalaryMin != 10000 {
		t.Errorf("SalaryMin: want 10000 forwarded, got %v", repo.lastCreateParams.SalaryMin)
	}
}

// TestCreateJob_SalaryMaxOnlyAllowed pins the spec scenario: a lone
// salary_max (no min) is permitted.
func TestCreateJob_SalaryMaxOnlyAllowed(t *testing.T) {
	repo := &writeStubRepo{
		createOut: makeStubForUpdate(uuid.New(), uuid.New(), time.Now()),
	}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.SalaryMin = nil
	in.SalaryMax = intPtrDto(5000)

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if repo.createCalls != 1 {
		t.Fatalf("Create must be called once, got %d", repo.createCalls)
	}
	if repo.lastCreateParams.SalaryMax == nil || *repo.lastCreateParams.SalaryMax != 5000 {
		t.Errorf("SalaryMax: want 5000 forwarded, got %v", repo.lastCreateParams.SalaryMax)
	}
}

// TestCreateJob_SalaryRangeEqualAllowed pins the boundary: min == max
// is permitted (the rule is min <= max).
func TestCreateJob_SalaryRangeEqualAllowed(t *testing.T) {
	repo := &writeStubRepo{
		createOut: makeStubForUpdate(uuid.New(), uuid.New(), time.Now()),
	}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.SalaryMin = intPtrDto(5000)
	in.SalaryMax = intPtrDto(5000)

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if repo.createCalls != 1 {
		t.Fatalf("Create must be called once, got %d", repo.createCalls)
	}
}

// --- step 5/6/7: UUID v7 + params + repo.Create ----------------------

// TestCreateJob_IDIsUUIDv7 pins D4: the use case calls uuid.NewV7()
// for the row id; version nibble is 7. The stub captures lastCreateID.
func TestCreateJob_IDIsUUIDv7(t *testing.T) {
	repo := &writeStubRepo{
		createOut: makeStubForUpdate(uuid.New(), uuid.New(), time.Now()),
	}
	svc := NewJobService(repo)

	in := validCreateDto()
	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	id := repo.lastCreateID
	if id == uuid.Nil {
		t.Fatal("Create id: want non-nil UUID v7, got uuid.Nil")
	}
	if id.Version() != 7 {
		t.Errorf("Create id version: want 7, got %d", id.Version())
	}
}

// TestCreateJob_CompanyIDFromCaller pins the IDOR invariant: the use
// case receives companyID from the caller (CompanyContext in
// production), NOT from any body field. The body has no company_id
// field; we verify the forwarded id is the caller's.
func TestCreateJob_CompanyIDFromCaller(t *testing.T) {
	repo := &writeStubRepo{
		createOut: makeStubForUpdate(uuid.New(), uuid.New(), time.Now()),
	}
	svc := NewJobService(repo)

	callerCompany := uuid.New()

	_, err := svc.CreateJob(context.Background(), callerCompany, validCreateDto())
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if repo.lastCreateCompany != callerCompany {
		t.Errorf("Create companyID: want callerCompany %v, got %v", callerCompany, repo.lastCreateCompany)
	}
}

// TestCreateJob_SuccessReturnsEditorViewWithDraftStatus pins the spec
// scenario "create returns editor view with status=draft": the 201 body
// is a JobEditorViewDto whose Status="draft" and whose updated_at comes
// from the row the adapter returned.
func TestCreateJob_SuccessReturnsEditorViewWithDraftStatus(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updated := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubRepo{
		createOut: &entities.JobForUpdate{
			ID:             jobID,
			Title:          "Backend Engineer",
			Description:    "Go + Postgres",
			WorkMode:       valueobjects.Remote,
			EmploymentType: valueobjects.FullTime,
			Seniority:      valueobjects.SeniorSeniority,
			JobStatus:      valueobjects.Draft,
			SalaryCurrency: valueobjects.MXN,
			UpdatedAt:      updated,
			Company:        entities.CompanyRef{ID: companyID, Name: "Acme"},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.CreateJob(context.Background(), companyID, validCreateDto())
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil, got nil")
	}
	if view.ID != jobID.String() {
		t.Errorf("view.ID: want %v, got %q", jobID, view.ID)
	}
	if view.Status != "draft" {
		t.Errorf("view.Status: want %q, got %q", "draft", view.Status)
	}
	if !view.UpdatedAt.Equal(updated) {
		t.Errorf("view.UpdatedAt: want %v, got %v", updated, view.UpdatedAt)
	}
	if view.Company.ID != companyID.String() {
		t.Errorf("view.Company.ID: want %v, got %q", companyID, view.Company.ID)
	}
	if view.Company.Name != "Acme" {
		t.Errorf("view.Company.Name: want %q, got %q", "Acme", view.Company.Name)
	}
}

// TestCreateJob_RepoErrorPropagates pins the generic-error path:
// anything the repo returns (other than ErrCompanyNotActive /
// ErrCompanyGone / ErrInvalidStatusTransition, covered separately)
// flows up unchanged. The HTTP layer decides what status to emit.
func TestCreateJob_RepoErrorPropagates(t *testing.T) {
	want := errors.New("db is on fire")
	repo := &writeStubRepo{createErr: want}
	svc := NewJobService(repo)

	_, err := svc.CreateJob(context.Background(), uuid.New(), validCreateDto())
	if !errors.Is(err, want) {
		t.Errorf("want %v, got %v", want, err)
	}
}

// --- error propagation: 409 / 400 sentinels ----------------------------

// TestCreateJob_ErrCompanyNotActivePropagated pins the spec scenario
// "non-active company returns 409 ErrCompanyNotActive": the sentinel
// surfaces untouched through the use case so the handler's
// classifyError can render 409.
func TestCreateJob_ErrCompanyNotActivePropagated(t *testing.T) {
	repo := &writeStubRepo{createErr: entities.ErrCompanyNotActive}
	svc := NewJobService(repo)

	_, err := svc.CreateJob(context.Background(), uuid.New(), validCreateDto())
	if !errors.Is(err, entities.ErrCompanyNotActive) {
		t.Fatalf("err: want ErrCompanyNotActive, got %v", err)
	}
}

// TestCreateJob_ErrCompanyGonePropagated pins the defense-in-depth
// 23503 path: ErrCompanyGone surfaces untouched.
func TestCreateJob_ErrCompanyGonePropagated(t *testing.T) {
	repo := &writeStubRepo{createErr: entities.ErrCompanyGone}
	svc := NewJobService(repo)

	_, err := svc.CreateJob(context.Background(), uuid.New(), validCreateDto())
	if !errors.Is(err, entities.ErrCompanyGone) {
		t.Fatalf("err: want ErrCompanyGone, got %v", err)
	}
}

// TestCreateJob_ErrInvalidStatusTransitionPropagated pins the
// defense-in-depth 23514 path: ErrInvalidStatusTransition surfaces
// untouched (handler -> 400 "invalid status transition").
func TestCreateJob_ErrInvalidStatusTransitionPropagated(t *testing.T) {
	repo := &writeStubRepo{createErr: entities.ErrInvalidStatusTransition}
	svc := NewJobService(repo)

	_, err := svc.CreateJob(context.Background(), uuid.New(), validCreateDto())
	if !errors.Is(err, entities.ErrInvalidStatusTransition) {
		t.Fatalf("err: want ErrInvalidStatusTransition, got %v", err)
	}
}

// --- VOs forwarded verbatim -----------------------------------------

// TestCreateJob_ParsedVOsForwarded proves step 2's happy path: every
// parsed VO reaches the repo via .String() (canonicalized). The
// stub captures lastCreateParams for assertion.
func TestCreateJob_ParsedVOsForwarded(t *testing.T) {
	repo := &writeStubRepo{
		createOut: makeStubForUpdate(uuid.New(), uuid.New(), time.Now()),
	}
	svc := NewJobService(repo)

	_, err := svc.CreateJob(context.Background(), uuid.New(), validCreateDto())
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if repo.lastCreateParams.WorkMode != valueobjects.Remote {
		t.Errorf("WorkMode: want %v, got %v", valueobjects.Remote, repo.lastCreateParams.WorkMode)
	}
	if repo.lastCreateParams.EmploymentType != valueobjects.FullTime {
		t.Errorf("EmploymentType: want %v, got %v", valueobjects.FullTime, repo.lastCreateParams.EmploymentType)
	}
	if repo.lastCreateParams.Seniority != valueobjects.SeniorSeniority {
		t.Errorf("Seniority: want %v, got %v", valueobjects.SeniorSeniority, repo.lastCreateParams.Seniority)
	}
	if repo.lastCreateParams.SalaryCurrency != valueobjects.MXN {
		t.Errorf("SalaryCurrency: want %v, got %v", valueobjects.MXN, repo.lastCreateParams.SalaryCurrency)
	}
}

// TestCreateJob_OptionalPointersForwarded proves the optional-trio
// forwarding: a non-nil Location / SalaryMin / SalaryMax reaches the
// repo pointer-identical.
func TestCreateJob_OptionalPointersForwarded(t *testing.T) {
	repo := &writeStubRepo{
		createOut: makeStubForUpdate(uuid.New(), uuid.New(), time.Now()),
	}
	svc := NewJobService(repo)

	in := validCreateDto()
	in.Location = strPtrDto("CDMX")
	in.SalaryMin = intPtrDto(40000)
	in.SalaryMax = intPtrDto(60000)

	_, err := svc.CreateJob(context.Background(), uuid.New(), in)
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if repo.lastCreateParams.Location == nil || *repo.lastCreateParams.Location != "CDMX" {
		t.Errorf("Location: want CDMX, got %v", repo.lastCreateParams.Location)
	}
	if repo.lastCreateParams.SalaryMin == nil || *repo.lastCreateParams.SalaryMin != 40000 {
		t.Errorf("SalaryMin: want 40000, got %v", repo.lastCreateParams.SalaryMin)
	}
	if repo.lastCreateParams.SalaryMax == nil || *repo.lastCreateParams.SalaryMax != 60000 {
		t.Errorf("SalaryMax: want 60000, got %v", repo.lastCreateParams.SalaryMax)
	}
}

// --- helpers ----------------------------------------------------------

// makeStubForUpdate builds a minimal JobForUpdate the stub can return
// from Create. Used by every success-path test.
func makeStubForUpdate(id, companyID uuid.UUID, updated time.Time) *entities.JobForUpdate {
	return &entities.JobForUpdate{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		JobStatus:      valueobjects.Draft,
		SalaryCurrency: valueobjects.MXN,
		UpdatedAt:      updated,
		Company:        entities.CompanyRef{ID: companyID, Name: "Acme"},
	}
}

// Compile-time guard against an accidental port drift.
var _ repositories.JobRepository = (*writeStubRepo)(nil)
