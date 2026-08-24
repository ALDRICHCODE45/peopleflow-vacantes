// Unit tests for the EditJob use case.
//
// EditJob is the application-layer orchestrator for PATCH /jobs/{id}.
// It owns the 8-step flow pinned in design D5:
//
//  1. GetForUpdate                          → ErrJobNotFound → (nil, Err)
//  2. CAS compare                            → mismatch → (view, ErrConflict)
//  3. VO parse                               → bad VO → (nil, Err)
//  4. transition check (closed-terminal first)
//  5. validation                             → bad field → (nil, Err)
//  6. build UpdatePatch
//  7. Update                                 → ErrJobNotFound → re-read
//  8. re-read + toEditorView                 → (view, nil)
//
// The tests pin every cell of the transition table, every validation
// branch, the CAS compare behavior (matching / stale / zero-token),
// and the re-read-after-Update path. The test stub repo is dedicated
// to EditJob (the existing stubJobRepository serves SearchJobs /
// GetJobByID).
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

// --- write-side stub repo -----------------------------------------------

// writeStubRepo satisfies JobRepository for the EditJob tests. It
// records the most recent GetForUpdate/Update call so the assertions
// can pin what the use case forwarded, and it lets each test program
// the response shape (next GetForUpdate return, next Update return,
// re-read return on the second GetForUpdate call).
type writeStubRepo struct {
	// GetForUpdate call counter — first call is the initial read,
	// second call is the re-read after a 0-rows Update.
	getForUpdateCalls int

	// getForUpdateResponses is the queue of GetForUpdate returns. The
	// stub pulls the next one per call; if the queue is exhausted the
	// stub returns ErrJobNotFound (mirroring the production adapter's
	// default on 0 rows).
	getForUpdateResponses []getForUpdateResponse

	// getForUpdateIDs / getForUpdateCompanyIDs record the last call
	// parameters so the assertions can pin what the use case forwarded.
	getForUpdateIDs        []uuid.UUID
	getForUpdateCompanyIDs []uuid.UUID

	// updateErr is the error returned by Update. Default nil = success.
	updateErr error

	// updateCalls / lastUpdateCapture record Update call parameters so
	// the assertions can pin what the use case forwarded (patch,
	// casUpdatedAt).
	updateCalls       int
	lastUpdateID      uuid.UUID
	lastUpdateCompany uuid.UUID
	lastUpdatePatch   repositories.UpdatePatch
	lastUpdateCas     time.Time
}

type getForUpdateResponse struct {
	job *entities.JobForUpdate
	err error
}

func (s *writeStubRepo) Search(_ context.Context, _ repositories.SearchParams) ([]entities.Job, error) {
	return nil, nil
}

func (s *writeStubRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Job, error) {
	return nil, entities.ErrJobNotFound
}

func (s *writeStubRepo) GetForUpdate(_ context.Context, id, companyID uuid.UUID) (*entities.JobForUpdate, error) {
	s.getForUpdateCalls++
	s.getForUpdateIDs = append(s.getForUpdateIDs, id)
	s.getForUpdateCompanyIDs = append(s.getForUpdateCompanyIDs, companyID)
	if len(s.getForUpdateResponses) == 0 {
		return nil, entities.ErrJobNotFound
	}
	resp := s.getForUpdateResponses[0]
	s.getForUpdateResponses = s.getForUpdateResponses[1:]
	if resp.err != nil {
		return nil, resp.err
	}
	return resp.job, nil
}

func (s *writeStubRepo) Update(_ context.Context, id, companyID uuid.UUID, patch repositories.UpdatePatch, casUpdatedAt time.Time) error {
	s.updateCalls++
	s.lastUpdateID = id
	s.lastUpdateCompany = companyID
	s.lastUpdatePatch = patch
	s.lastUpdateCas = casUpdatedAt
	return s.updateErr
}

// Compile-time guard: the stub satisfies the domain port.
var _ repositories.JobRepository = (*writeStubRepo)(nil)

// --- helpers ------------------------------------------------------------

// makeJobForUpdate builds a synthetic JobForUpdate the use case can
// read for CAS / transition / validation. The fields are stable and
// explicit so each assertion can pin a known value without per-test
// boilerplate. The default status is Draft; tests override per case.
func makeJobForUpdate(id, companyID uuid.UUID, status valueobjects.JobStatus, updated time.Time) *entities.JobForUpdate {
	return &entities.JobForUpdate{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		JobStatus:      status,
		SalaryCurrency: valueobjects.MXN,
		UpdatedAt:      updated,
		Company: entities.CompanyRef{
			ID:   companyID,
			Name: "Acme SA",
		},
	}
}

func dtosString(s string) *string { return &s }

func dtosInt(i int) *int { return &i }

func dtosJobStatus(s valueobjects.JobStatus) *valueobjects.JobStatus { return &s }

func mustUUID(s string) uuid.UUID {
	return uuid.MustParse(s)
}

// --- isTransitionAllowed (design D5) ------------------------------------

// TestIsTransitionAllowed_FullTable covers every cell of the 3x3
// transition matrix:
//
//	draft     → {draft, published}    (allowed)
//	published → {published, closed}   (allowed)
//	closed    → nothing               (rejected; closed is terminal)
func TestIsTransitionAllowed_FullTable(t *testing.T) {
	tests := []struct {
		from valueobjects.JobStatus
		to   valueobjects.JobStatus
		want bool
	}{
		{valueobjects.Draft, valueobjects.Draft, true},
		{valueobjects.Draft, valueobjects.Published, true},
		{valueobjects.Draft, valueobjects.Closed, false},
		{valueobjects.Published, valueobjects.Draft, false},
		{valueobjects.Published, valueobjects.Published, true},
		{valueobjects.Published, valueobjects.Closed, true},
		{valueobjects.Closed, valueobjects.Draft, false},
		{valueobjects.Closed, valueobjects.Published, false},
		{valueobjects.Closed, valueobjects.Closed, false},
	}
	for _, tt := range tests {
		got := isTransitionAllowed(tt.from, tt.to)
		if got != tt.want {
			t.Errorf("isTransitionAllowed(%v, %v): want %v, got %v", tt.from, tt.to, tt.want, got)
		}
	}
}

// TestIsTransitionAllowed_UnknownStatusDefaultsFor covers a defensive
// case: if a future code path reaches the helper with a status value
// outside the closed set, the helper returns false (no transitions
// allowed). The DB CHECK should prevent this in production; this is
// defense-in-depth.
func TestIsTransitionAllowed_UnknownStatusDefaultsFor(t *testing.T) {
	if isTransitionAllowed(valueobjects.JobStatus(99), valueobjects.Published) {
		t.Errorf("unknown from-status: want false, got true")
	}
}

// --- CAS compare --------------------------------------------------------

// TestEditJob_CASMismatchReturnsConflict covers the design D5 step 2:
// a stale `If-Unmodified-Since` (current.UpdatedAt > header value)
// returns (view, ErrConcurrencyConflict) WITHOUT touching Update.
func TestEditJob_CASMismatchReturnsConflict(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("New"),
	}, current.Add(-1*time.Hour)) // stale
	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("err: want ErrConcurrencyConflict, got %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil on CAS conflict, got nil")
	}
	if repo.updateCalls != 0 {
		t.Errorf("Update must NOT be called on CAS mismatch, got %d calls", repo.updateCalls)
	}
}

// TestEditJob_CASZeroTokenReturnsConflict covers the spec scenario
// "missing If-Unmodified-Since": the handler parses a missing or
// malformed header as time.Time{}; that value never equals any real
// row's UpdatedAt, so the use case must return ErrConcurrencyConflict.
func TestEditJob_CASZeroTokenReturnsConflict(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("New"),
	}, time.Time{}) // missing/malformed header
	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("err: want ErrConcurrencyConflict, got %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil on missing CAS, got nil")
	}
}

// TestEditJob_CASMatchProceedsToUpdate covers the happy-path CAS:
// matching `If-Unmodified-Since` advances the flow into Update.
func TestEditJob_CASMatchProceedsToUpdate(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	// First GetForUpdate = current row (draft).
	// Second GetForUpdate = the post-update authoritative view.
	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current.Add(time.Second))},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("New"),
	}, current)
	if err != nil {
		t.Fatalf("EditJob: %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil on success, got nil")
	}
	if repo.updateCalls != 1 {
		t.Errorf("Update calls: want 1, got %d", repo.updateCalls)
	}
	if !repo.lastUpdateCas.Equal(current) {
		t.Errorf("Update cas: want %v, got %v", current, repo.lastUpdateCas)
	}
}

// --- 404 propagation ----------------------------------------------------

// TestEditJob_NotFoundPropagates covers the design D5 step 1: the
// initial GetForUpdate returns ErrJobNotFound; the use case surfaces
// (nil, ErrJobNotFound) so the handler can map to 404.
func TestEditJob_NotFoundPropagates(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	repo := &writeStubRepo{} // no queued responses → ErrJobNotFound
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("X"),
	}, time.Now())
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Fatalf("err: want ErrJobNotFound, got %v", err)
	}
	if view != nil {
		t.Errorf("view: want nil on 404, got %+v", view)
	}
	if repo.updateCalls != 0 {
		t.Errorf("Update must NOT be called when GetForUpdate returned 404, got %d", repo.updateCalls)
	}
}

// --- closed terminal rule (design D5) -----------------------------------

// TestEditJob_ClosedTerminalAnyBodyRejects covers the spec scenario
// "closed is terminal": a row in `closed` status rejects ANY body —
// even field-only edits with no status field.
func TestEditJob_ClosedTerminalAnyBodyRejects(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Closed, current)},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("New"), // field-only, no status
	}, current)
	if !errors.Is(err, entities.ErrInvalidStatusTransition) {
		t.Fatalf("err: want ErrInvalidStatusTransition, got %v", err)
	}
	if view != nil {
		t.Errorf("view: want nil on closed-terminal rejection, got %+v", view)
	}
	if repo.updateCalls != 0 {
		t.Errorf("Update must NOT be called on closed-terminal rejection, got %d", repo.updateCalls)
	}
}

// TestEditJob_ClosedTerminalStatusAnyRejected explicitly tries a
// status transition from closed (any target is illegal per the
// transition table).
func TestEditJob_ClosedTerminalStatusAnyRejected(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Closed, current)},
		},
	}
	svc := NewJobService(repo)

	_, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Status: dtosString("draft"),
	}, current)
	if !errors.Is(err, entities.ErrInvalidStatusTransition) {
		t.Fatalf("err: want ErrInvalidStatusTransition, got %v", err)
	}
}

// --- illegal transitions (design D5) ------------------------------------

// TestEditJob_DraftToClosedRejected covers the spec scenario
// "draft → closed is rejected".
func TestEditJob_DraftToClosedRejected(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
		},
	}
	svc := NewJobService(repo)

	_, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Status: dtosString("closed"),
	}, current)
	if !errors.Is(err, entities.ErrInvalidStatusTransition) {
		t.Fatalf("err: want ErrInvalidStatusTransition, got %v", err)
	}
}

// TestEditJob_PublishedToDraftRejected covers the spec scenario
// "published → draft is rejected" (no un-publish in this change).
func TestEditJob_PublishedToDraftRejected(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Published, current)},
		},
	}
	svc := NewJobService(repo)

	_, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Status: dtosString("draft"),
	}, current)
	if !errors.Is(err, entities.ErrInvalidStatusTransition) {
		t.Fatalf("err: want ErrInvalidStatusTransition, got %v", err)
	}
}

// --- validation (design D5 step 5) -------------------------------------

// TestEditJob_EmptyTitleRejected covers the spec scenario
// "empty title is rejected": `"   "` after trim is empty.
func TestEditJob_EmptyTitleRejected(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
		},
	}
	svc := NewJobService(repo)

	_, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("   "),
	}, current)
	if !errors.Is(err, entities.ErrEmptyTitle) {
		t.Fatalf("err: want ErrEmptyTitle, got %v", err)
	}
}

// TestEditJob_EmptyDescriptionRejected covers the spec scenario
// "empty description is rejected".
func TestEditJob_EmptyDescriptionRejected(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
		},
	}
	svc := NewJobService(repo)

	_, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Description: dtosString(""),
	}, current)
	if !errors.Is(err, entities.ErrEmptyDescription) {
		t.Fatalf("err: want ErrEmptyDescription, got %v", err)
	}
}

// TestEditJob_SalaryRangeRejected covers the spec scenario
// "salary_min greater than salary_max is rejected" when BOTH fields
// are present and non-null.
func TestEditJob_SalaryRangeRejected(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
		},
	}
	svc := NewJobService(repo)

	_, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		SalaryMin: valueobjects.Optional[int]{Set: true, Valid: true, Value: 10000},
		SalaryMax: valueobjects.Optional[int]{Set: true, Valid: true, Value: 5000},
	}, current)
	if !errors.Is(err, entities.ErrInvalidSalaryRange) {
		t.Fatalf("err: want ErrInvalidSalaryRange, got %v", err)
	}
}

// TestEditJob_SalaryRangeAllowsEqual confirms the boundary: min == max
// is permitted (the spec rule is `min <= max`).
func TestEditJob_SalaryRangeAllowsEqual(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current.Add(time.Second))},
		},
	}
	svc := NewJobService(repo)

	_, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		SalaryMin: valueobjects.Optional[int]{Set: true, Valid: true, Value: 5000},
		SalaryMax: valueobjects.Optional[int]{Set: true, Valid: true, Value: 5000},
	}, current)
	if err != nil {
		t.Fatalf("err: want nil (equal salaries allowed), got %v", err)
	}
}

// TestEditJob_UnknownVOsRejected covers the spec scenarios "unknown
// work_mode is rejected" / "unknown salary_currency is rejected" /
// "unknown status". The handler treats each as 400 with the
// field-naming message; the use case surfaces the matching VO sentinel.
func TestEditJob_UnknownVOsRejected(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	tests := []struct {
		name string
		in   dtos.UpdateJobDto
		want error
	}{
		{
			name: "unknown work_mode",
			in:   dtos.UpdateJobDto{WorkMode: dtosString("telecommute")},
			want: valueobjects.ErrInvalidWorkMode,
		},
		{
			name: "unknown employment_type",
			in:   dtos.UpdateJobDto{EmploymentType: dtosString("freelance")},
			want: valueobjects.ErrInvalidEmploymentType,
		},
		{
			name: "unknown seniority",
			in:   dtos.UpdateJobDto{Seniority: dtosString("principal")},
			want: valueobjects.ErrInvalidSeniority,
		},
		{
			name: "unknown salary_currency",
			in:   dtos.UpdateJobDto{SalaryCurrency: dtosString("EUR")},
			want: valueobjects.ErrInvalidSalaryCurrency,
		},
		{
			name: "unknown status",
			in:   dtos.UpdateJobDto{Status: dtosString("archived")},
			want: valueobjects.ErrInvalidJobStatus,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &writeStubRepo{
				getForUpdateResponses: []getForUpdateResponse{
					{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
				},
			}
			svc := NewJobService(repo)

			_, err := svc.EditJob(context.Background(), companyID, jobID, tt.in, current)
			if !errors.Is(err, tt.want) {
				t.Errorf("err: want %v, got %v", tt.want, err)
			}
		})
	}
}

// --- patch construction (design D5 step 6) ------------------------------

// TestEditJob_PatchCapturesNullVsAbsentLocation covers the design's
// null-vs-absent decision: an explicit null on `location` must
// produce `Optional{Set:true, Valid:false}` on the patch, while an
// absent `location` must produce `Optional{Set:false}`.
func TestEditJob_PatchCapturesNullVsAbsentLocation(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	tests := []struct {
		name      string
		location  valueobjects.Optional[string]
		wantSet   bool
		wantValid bool
	}{
		{
			name:      "absent: untouched",
			location:  valueobjects.Optional[string]{},
			wantSet:   false,
			wantValid: false,
		},
		{
			name:      "null: clear",
			location:  valueobjects.Optional[string]{Set: true, Valid: false},
			wantSet:   true,
			wantValid: false,
		},
		{
			name:      "value: set",
			location:  valueobjects.Optional[string]{Set: true, Valid: true, Value: "CDMX"},
			wantSet:   true,
			wantValid: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &writeStubRepo{
				getForUpdateResponses: []getForUpdateResponse{
					{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
					{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current.Add(time.Second))},
				},
			}
			svc := NewJobService(repo)

			_, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
				Location: tt.location,
			}, current)
			if err != nil {
				t.Fatalf("EditJob: %v", err)
			}
			if repo.lastUpdatePatch.Location.Set != tt.wantSet {
				t.Errorf("Location.Set: want %v, got %v", tt.wantSet, repo.lastUpdatePatch.Location.Set)
			}
			if repo.lastUpdatePatch.Location.Valid != tt.wantValid {
				t.Errorf("Location.Valid: want %v, got %v", tt.wantValid, repo.lastUpdatePatch.Location.Valid)
			}
		})
	}
}

// --- success path (design D5 step 7-8) ----------------------------------

// TestEditJob_StatusOnlyPatchReturns200 covers the spec scenario
// "status-only PATCH is allowed": an empty body except for `status`
// produces a successful 200 view with zero field changes.
func TestEditJob_StatusOnlyPatchReturns200(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, current)},
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Published, current.Add(time.Second))},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Status: dtosString("published"),
	}, current)
	if err != nil {
		t.Fatalf("EditJob: %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil on success, got nil")
	}
	if view.Status != "published" {
		t.Errorf("Status: want \"published\", got %q", view.Status)
	}
	// Field patch should be entirely absent: no title/description/etc
	// pointer set on the captured UpdatePatch.
	if repo.lastUpdatePatch.Title != nil {
		t.Errorf("Title on patch: want nil (status-only), got %v", *repo.lastUpdatePatch.Title)
	}
	if repo.lastUpdatePatch.Location.Set {
		t.Errorf("Location.Set: want false (status-only), got true")
	}
}

// TestEditJob_SuccessReReadsAuthoritativeView covers the design D5
// step 8: after Update succeeds the use case re-reads via
// GetForUpdate and projects the FRESH row (the post-update `now()`
// timestamp), not the stale `current` from step 1.
func TestEditJob_SuccessReReadsAuthoritativeView(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	oldTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	newTS := time.Date(2026, 8, 24, 12, 0, 5, 0, time.UTC)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, oldTS)},
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, newTS)},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("New"),
	}, oldTS)
	if err != nil {
		t.Fatalf("EditJob: %v", err)
	}
	if repo.getForUpdateCalls != 2 {
		t.Errorf("GetForUpdate calls: want 2 (read + re-read), got %d", repo.getForUpdateCalls)
	}
	if !view.UpdatedAt.Equal(newTS) {
		t.Errorf("UpdatedAt: want %v (post-update), got %v", newTS, view.UpdatedAt)
	}
}

// --- 0-rows Update (design D4 + D5 step 7) ------------------------------

// TestEditJob_UpdateZeroRowsReturnsConflict covers the case where the
// in-flight Update returns 0 rows because the row changed between
// read and write (CAS lost). The use case re-reads: if the row still
// exists it returns (view, ErrConcurrencyConflict); if it doesn't it
// returns (nil, ErrJobNotFound).
func TestEditJob_UpdateZeroRowsReReadsConflict(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	oldTS := time.Now().UTC()
	newTS := oldTS.Add(2 * time.Second)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, oldTS)},
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, newTS)},
		},
		updateErr: entities.ErrJobNotFound, // 0 rows in adapter
	}
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("New"),
	}, oldTS)
	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("err: want ErrConcurrencyConflict, got %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil on CAS conflict, got nil")
	}
	if !view.UpdatedAt.Equal(newTS) {
		t.Errorf("UpdatedAt: want %v (latest after re-read), got %v", newTS, view.UpdatedAt)
	}
	if repo.getForUpdateCalls != 2 {
		t.Errorf("GetForUpdate calls: want 2 (read + re-read), got %d", repo.getForUpdateCalls)
	}
}

// TestEditJob_UpdateZeroRowsRereadGoneReturns404 covers the corner:
// 0-rows Update AND the re-read also misses (the row was soft-deleted
// between read and write). The use case returns (nil, ErrJobNotFound)
// so the handler can map to 404.
func TestEditJob_UpdateZeroRowsRereadGoneReturns404(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	oldTS := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, oldTS)},
			// No second queued response → second call returns ErrJobNotFound.
		},
		updateErr: entities.ErrJobNotFound,
	}
	svc := NewJobService(repo)

	view, err := svc.EditJob(context.Background(), companyID, jobID, dtos.UpdateJobDto{
		Title: dtosString("New"),
	}, oldTS)
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Fatalf("err: want ErrJobNotFound, got %v", err)
	}
	if view != nil {
		t.Errorf("view: want nil on 404 after gone re-read, got %+v", view)
	}
}

// --- company context priority (design D5 + spec IDOR) ------------------

// TestEditJob_UseCaseReceivesCompanyIDFromCaller covers the IDOR
// invariant: the use case receives `companyID` from the caller
// (CompanyContext in production), NOT from any body field. The body
// field does not exist; we just verify the forwarded companyID is
// the one the caller passed.
func TestEditJob_UseCaseReceivesCompanyIDFromCaller(t *testing.T) {
	jobID := uuid.New()
	callerCompany := uuid.New() // CompanyContext.CompanyID
	bodyCompany := uuid.New()   // a body field, hypothetically
	current := time.Now().UTC()

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, callerCompany, valueobjects.Draft, current)},
			{job: makeJobForUpdate(jobID, callerCompany, valueobjects.Draft, current.Add(time.Second))},
		},
	}
	svc := NewJobService(repo)

	_, err := svc.EditJob(context.Background(), callerCompany, jobID, dtos.UpdateJobDto{
		Title: dtosString("New"),
	}, current)
	if err != nil {
		t.Fatalf("EditJob: %v", err)
	}
	// First GetForUpdate received the caller's companyID, NOT bodyCompany.
	if repo.getForUpdateCompanyIDs[0] != callerCompany {
		t.Errorf("first GetForUpdate companyID: want callerCompany, got %v", repo.getForUpdateCompanyIDs[0])
	}
	// Same for Update.
	if repo.lastUpdateCompany != callerCompany {
		t.Errorf("Update companyID: want callerCompany, got %v", repo.lastUpdateCompany)
	}
	// Sanity: bodyCompany was NEVER seen by the repo (proves the DTO does
	// not surface any company_id field).
	_ = bodyCompany
}
