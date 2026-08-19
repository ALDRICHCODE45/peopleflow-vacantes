package usecases

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/cursor"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// --- stub repository -------------------------------------------------------

// stubJobRepository satisfies the JobRepository port for the use-case
// tests. It records the SearchParams it received so the assertions can
// pin what the use case forwards (filter handling, cursor decoding,
// limit inflation).
type stubJobRepository struct {
	mu sync.Mutex

	searchOut []entities.Job
	searchErr error

	getByIDOut *entities.Job
	getByIDErr error

	// searchCalls / searchParams mirror every call the use case made.
	searchCalls  int
	searchParams []repositories.SearchParams
}

func (s *stubJobRepository) Search(_ context.Context, p repositories.SearchParams) ([]entities.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.searchCalls++
	s.searchParams = append(s.searchParams, p)
	if s.searchErr != nil {
		return nil, s.searchErr
	}
	out := make([]entities.Job, len(s.searchOut))
	copy(out, s.searchOut)
	return out, nil
}

func (s *stubJobRepository) GetByID(_ context.Context, id uuid.UUID) (*entities.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getByIDErr != nil {
		return nil, s.getByIDErr
	}
	if s.getByIDOut != nil {
		j := *s.getByIDOut
		return &j, nil
	}
	return nil, entities.ErrJobNotFound
}

// Compile-time guard: the stub satisfies the same surface the
// postgres adapter will (so wiring changes later cannot break us).
var _ repositories.JobRepository = (*stubJobRepository)(nil)

// --- helpers ---------------------------------------------------------------

// makeJob builds a Job with a PublishedAt set and (optionally) a
// Rank. Tests use it to assemble synthetic search result pages.
func makeJob(id uuid.UUID, pubAt time.Time, rank *float64) entities.Job {
	loc := "CDMX"
	smin := 40000
	smax := 60000
	pub := pubAt
	return entities.Job{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		JobStatus:      valueobjects.Published,
		Location:       &loc,
		SalaryMin:      &smin,
		SalaryMax:      &smax,
		SalaryCurrency: valueobjects.MXN,
		PublishedAt:    &pub,
		Rank:           rank,
		Company:        entities.CompanyRef{ID: uuid.MustParse("018e0000-0000-7000-8000-000000000001"), Name: "Acme SA"},
	}
}

func strPtr(s string) *string { return &s }

// --- SearchJobs tests ------------------------------------------------------

// TestSearchJobs_EmptyFiltersMapToNil covers the spec scenario "missing
// q returns all visible jobs" and the design's "empty filters → DB
// sentinel". The use case MUST forward nil pointers so the SQL
// predicate `@seniority::text = ” OR …` collapses to TRUE.
func TestSearchJobs_EmptyFiltersMapToNil(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	_, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}
	if repo.searchCalls != 1 {
		t.Fatalf("expected 1 Search call, got %d", repo.searchCalls)
	}
	got := repo.searchParams[0]
	if got.Q != nil {
		t.Errorf("Q: want nil, got %v", *got.Q)
	}
	if got.Seniority != nil {
		t.Errorf("Seniority: want nil, got %v", *got.Seniority)
	}
	if got.WorkMode != nil {
		t.Errorf("WorkMode: want nil, got %v", *got.WorkMode)
	}
	if got.EmploymentType != nil {
		t.Errorf("EmploymentType: want nil, got %v", *got.EmploymentType)
	}
	if got.Location != nil {
		t.Errorf("Location: want nil, got %v", *got.Location)
	}
	if got.SalaryCurrency != nil {
		t.Errorf("SalaryCurrency: want nil, got %v", *got.SalaryCurrency)
	}
	if got.Cursor != nil {
		t.Errorf("Cursor: want nil, got %+v", *got.Cursor)
	}
}

// TestSearchJobs_ValidFiltersMapToPointers covers the design rule
// "valid filters map to *string". Whitespace-only strings collapse to
// nil (DB sentinel); anything with non-whitespace content passes
// through as a non-nil pointer.
func TestSearchJobs_ValidFiltersMapToPointers(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	q := "go"
	sn := "  " // whitespace → nil
	wm := "remote"
	et := "full_time"
	loc := "CDMX"
	cur := "USD"

	_, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{
		Q:              &q,
		Seniority:      &sn,
		WorkMode:       &wm,
		EmploymentType: &et,
		Location:       &loc,
		SalaryCurrency: &cur,
	})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}
	got := repo.searchParams[0]
	if got.Q == nil || *got.Q != "go" {
		t.Errorf("Q: want %q, got %v", "go", got.Q)
	}
	if got.Seniority != nil {
		t.Errorf("Seniority (whitespace-only): want nil, got %v", *got.Seniority)
	}
	if got.WorkMode == nil || *got.WorkMode != "remote" {
		t.Errorf("WorkMode: want %q, got %v", "remote", got.WorkMode)
	}
	if got.EmploymentType == nil || *got.EmploymentType != "full_time" {
		t.Errorf("EmploymentType: want %q, got %v", "full_time", got.EmploymentType)
	}
	if got.Location == nil || *got.Location != "CDMX" {
		t.Errorf("Location: want %q, got %v", "CDMX", got.Location)
	}
	if got.SalaryCurrency == nil || *got.SalaryCurrency != "USD" {
		t.Errorf("SalaryCurrency: want %q, got %v", "USD", got.SalaryCurrency)
	}
}

// TestSearchJobs_CursorDecodes covers the spec scenario "cursor advances
// the page": a non-empty cursor string is forwarded to the repo as a
// *repositories.Cursor with the parsed fields. Malformed cursors are
// tolerated (nil) — covered separately.
func TestSearchJobs_CursorDecodes(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	encoded := cursor.Encode(&repositories.Cursor{
		Rank:        nil,
		PublishedAt: time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC),
		ID:          uuid.MustParse("018e9b9c-1234-7def-9abc-0123456789ab"),
	})

	_, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{
		Cursor: &encoded,
	})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}
	got := repo.searchParams[0]
	if got.Cursor == nil {
		t.Fatal("Cursor: want non-nil, got nil")
	}
	if got.Cursor.Rank != nil {
		t.Errorf("Cursor.Rank: want nil, got %v", *got.Cursor.Rank)
	}
	if !got.Cursor.PublishedAt.Equal(time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)) {
		t.Errorf("Cursor.PublishedAt: want 2026-08-19T12:00:00Z, got %v", got.Cursor.PublishedAt)
	}
	if got.Cursor.ID != uuid.MustParse("018e9b9c-1234-7def-9abc-0123456789ab") {
		t.Errorf("Cursor.ID: got %v", got.Cursor.ID)
	}
}

// TestSearchJobs_MalformedCursorIsTolerant covers the design decision
// "malformed cursor → tolerant first page, never error". The repo
// receives a nil Cursor regardless of the garbage the client sent.
func TestSearchJobs_MalformedCursorIsTolerant(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	garbage := "not-a-cursor!!!@@@"
	_, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{
		Cursor: &garbage,
	})
	if err != nil {
		t.Fatalf("SearchJobs with garbage cursor: %v", err)
	}
	got := repo.searchParams[0]
	if got.Cursor != nil {
		t.Errorf("Cursor: want nil (tolerant first page), got %+v", *got.Cursor)
	}
}

// TestSearchJobs_LimitIsInflatedToPlusOne covers the keyset trick: the
// use case requests limit+1 internally so the +1 row can drive the
// NextCursor without a second round-trip. The page size the caller
// asks for is invisible to the repo.
func TestSearchJobs_LimitIsInflatedToPlusOne(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	_, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{Limit: 20})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}
	got := repo.searchParams[0]
	if got.Limit != 21 {
		t.Errorf("Limit: want 21 (page 20 + 1 has-more), got %d", got.Limit)
	}
}

// TestSearchJobs_LimitPlusOneHitsNextCursor is the keystone: when the
// repo returns limit+1 rows, the use case (a) drops the extra row from
// the visible page and (b) encodes the LAST VISIBLE row (rows[limit-1])
// into NextCursor so the next page starts strictly after it (the +1
// sentinel row becomes the first row of the next page).
func TestSearchJobs_LimitPlusOneHitsNextCursor(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	var rows []entities.Job
	for i := 0; i < 21; i++ {
		// stagger PublishedAt so the last row's anchor is unambiguous
		pub := now.Add(time.Duration(i) * time.Minute)
		var rank *float64
		if i == 19 {
			r := 0.5
			rank = &r
		}
		rows = append(rows, makeJob(uuid.New(), pub, rank))
	}
	repo.searchOut = rows

	res, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{Limit: 20})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}

	if len(res.Items) != 20 {
		t.Fatalf("Items: want 20, got %d (extra row should be dropped)", len(res.Items))
	}
	if res.NextCursor == nil {
		t.Fatal("NextCursor: want non-nil on +1 row, got nil")
	}

	// The cursor must encode the LAST VISIBLE row (rows[19]), not the
	// +1 sentinel row (rows[20]). Decoding it proves the contract.
	decoded := cursor.Decode(*res.NextCursor)
	if decoded == nil {
		t.Fatal("NextCursor did not round-trip")
	}
	if decoded.ID != rows[19].ID {
		t.Errorf("NextCursor.ID: want %v (last visible row), got %v", rows[19].ID, decoded.ID)
	}
	if rows[19].PublishedAt == nil || !decoded.PublishedAt.Equal(*rows[19].PublishedAt) {
		t.Errorf("NextCursor.PublishedAt: want %v, got %v", rows[19].PublishedAt, decoded.PublishedAt)
	}
	if decoded.Rank == nil || *decoded.Rank != 0.5 {
		t.Errorf("NextCursor.Rank: want 0.5 (search mode), got %v", decoded.Rank)
	}
}

// TestSearchJobs_FewerThanLimitPlusOneHasNoCursor covers the spec
// scenario "cursor past the end returns empty": when the repo returns
// fewer than limit+1 rows, the caller is on the last page and there
// is no NextCursor.
func TestSearchJobs_FewerThanLimitPlusOneHasNoCursor(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	var rows []entities.Job
	for i := 0; i < 5; i++ {
		rows = append(rows, makeJob(uuid.New(), now.Add(time.Duration(i)*time.Minute), nil))
	}
	repo.searchOut = rows

	res, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{Limit: 20})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}
	if len(res.Items) != 5 {
		t.Errorf("Items: want 5, got %d", len(res.Items))
	}
	if res.NextCursor != nil {
		t.Errorf("NextCursor: want nil on last page, got %q", *res.NextCursor)
	}
}

// TestSearchJobs_BrowseModeCursorHasNoRank covers the wire format
// invariant: when no Q is passed the cursor narrows on
// (PublishedAt, ID) only — Rank stays nil.
func TestSearchJobs_BrowseModeCursorHasNoRank(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	var rows []entities.Job
	for i := 0; i < 21; i++ {
		rows = append(rows, makeJob(uuid.New(), now.Add(time.Duration(i)*time.Minute), nil))
	}
	repo.searchOut = rows

	res, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{Limit: 20})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}
	if res.NextCursor == nil {
		t.Fatal("NextCursor: want non-nil, got nil")
	}
	decoded := cursor.Decode(*res.NextCursor)
	if decoded == nil {
		t.Fatal("NextCursor did not round-trip")
	}
	if decoded.Rank != nil {
		t.Errorf("Browse cursor Rank: want nil, got %v", *decoded.Rank)
	}
}

// TestSearchJobs_ItemsIsNonNilEmpty covers the JSON wire invariant:
// nil slice → `"items": null` is a wire surprise; an empty page must
// serialize as `"items": []`.
func TestSearchJobs_ItemsIsNonNilEmpty(t *testing.T) {
	repo := &stubJobRepository{searchOut: nil}
	svc := NewJobService(repo)

	res, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{Limit: 20})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}
	if res.Items == nil {
		t.Fatal("Items: want non-nil empty slice, got nil")
	}
	if len(res.Items) != 0 {
		t.Errorf("Items: want 0, got %d", len(res.Items))
	}
}

// TestSearchJobs_RepoErrorPropagates covers the generic error path:
// anything the repo returns (other than ErrJobNotFound, which only
// surfaces from GetByID) flows up unchanged. The HTTP layer decides
// what status to emit.
func TestSearchJobs_RepoErrorPropagates(t *testing.T) {
	want := errors.New("db is on fire")
	repo := &stubJobRepository{searchErr: want}
	svc := NewJobService(repo)

	_, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{Limit: 20})
	if !errors.Is(err, want) {
		t.Errorf("want %v, got %v", want, err)
	}
}

// TestSearchJobs_ItemShapesFromEntity pins the entity → DTO mapping:
// enum VOs become wire strings, pointers stay pointers, the company
// ref flattens into a CompanyDto.
func TestSearchJobs_ItemShapesFromEntity(t *testing.T) {
	repo := &stubJobRepository{}
	svc := NewJobService(repo)

	pub := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	companyID := uuid.MustParse("018e0000-0000-7000-8000-000000000001")
	job := entities.Job{
		ID:             uuid.MustParse("018e0000-0000-7000-8000-0000000000aa"),
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		JobStatus:      valueobjects.Published,
		Location:       strPtr("CDMX"),
		SalaryMin:      intPtr(40000),
		SalaryMax:      intPtr(60000),
		SalaryCurrency: valueobjects.MXN,
		PublishedAt:    &pub,
		Company:        entities.CompanyRef{ID: companyID, Name: "Acme SA"},
	}
	repo.searchOut = []entities.Job{job}

	res, err := svc.SearchJobs(context.Background(), dtos.SearchJobsDto{Limit: 20})
	if err != nil {
		t.Fatalf("SearchJobs: %v", err)
	}
	if len(res.Items) != 1 {
		t.Fatalf("Items: want 1, got %d", len(res.Items))
	}
	got := res.Items[0]
	if got.WorkMode != "remote" {
		t.Errorf("WorkMode: want %q, got %q", "remote", got.WorkMode)
	}
	if got.EmploymentType != "full_time" {
		t.Errorf("EmploymentType: want %q, got %q", "full_time", got.EmploymentType)
	}
	if got.Seniority != "senior" {
		t.Errorf("Seniority: want %q, got %q", "senior", got.Seniority)
	}
	if got.SalaryCurrency != "MXN" {
		t.Errorf("SalaryCurrency: want %q, got %q", "MXN", got.SalaryCurrency)
	}
	if got.Location == nil || *got.Location != "CDMX" {
		t.Errorf("Location: want %q, got %v", "CDMX", got.Location)
	}
	if got.SalaryMin == nil || *got.SalaryMin != 40000 {
		t.Errorf("SalaryMin: want 40000, got %v", got.SalaryMin)
	}
	if got.SalaryMax == nil || *got.SalaryMax != 60000 {
		t.Errorf("SalaryMax: want 60000, got %v", got.SalaryMax)
	}
	if got.PublishedAt == nil || !got.PublishedAt.Equal(pub) {
		t.Errorf("PublishedAt: want %v, got %v", pub, got.PublishedAt)
	}
	if got.Company.ID != companyID.String() {
		t.Errorf("Company.ID: want %v, got %q", companyID, got.Company.ID)
	}
	if got.Company.Name != "Acme SA" {
		t.Errorf("Company.Name: want %q, got %q", "Acme SA", got.Company.Name)
	}
	if !strings.HasPrefix(got.ID, "018e0000-0000-7000-8000-0000000000aa") {
		t.Errorf("ID: want uuid-string, got %q", got.ID)
	}
}

func intPtr(i int) *int { return &i }
