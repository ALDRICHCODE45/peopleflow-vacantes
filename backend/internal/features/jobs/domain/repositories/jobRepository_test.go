package repositories

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/google/uuid"
)

// stubJobRepo is the minimal in-memory implementation used to prove
// the JobRepository interface is satisfied at compile time AND to drive
// the round-trip tests that verify the port's contract: Search returns
// the slice the stub recorded, GetByID returns the recorded job or
// ErrJobNotFound.
type stubJobRepo struct {
	searchResult []entities.Job
	searchErr    error

	getResult *entities.Job
	getErr    error

	gotParams SearchParams
	gotID     uuid.UUID
}

func (s *stubJobRepo) Search(_ context.Context, p SearchParams) ([]entities.Job, error) {
	s.gotParams = p
	return s.searchResult, s.searchErr
}

func (s *stubJobRepo) GetByID(_ context.Context, id uuid.UUID) (*entities.Job, error) {
	s.gotID = id
	return s.getResult, s.getErr
}

// TestJobRepository_StubSatisfiesPort is the compile-time + runtime
// assertion that the JobRepository port is well-formed: the stub
// implements both methods without compile errors and is assignable to
// the interface variable.
func TestJobRepository_StubSatisfiesPort(t *testing.T) {
	var repo JobRepository = &stubJobRepo{}
	if repo == nil {
		t.Fatal("expected non-nil JobRepository after stub assignment")
	}
}

// TestCursor_RankNilMeansBrowseMode documents the dual-mode cursor
// invariant: Rank == nil means the cursor was decoded from a browse
// payload {t,i}; non-nil Rank means it was decoded from a search
// payload {r,t,i}. The codec is the application layer's job, but the
// port struct must make the distinction cheap to inspect.
func TestCursor_RankNilMeansBrowseMode(t *testing.T) {
	browse := Cursor{PublishedAt: time.Now().UTC(), ID: uuid.New()}
	if browse.Rank != nil {
		t.Errorf("browse-mode cursor: Rank must be nil, got %v", *browse.Rank)
	}

	rank := 0.42
	search := Cursor{Rank: &rank, PublishedAt: time.Now().UTC(), ID: uuid.New()}
	if search.Rank == nil {
		t.Error("search-mode cursor: Rank must be non-nil")
	}
	if *search.Rank != 0.42 {
		t.Errorf("Rank: got %v, want %v", *search.Rank, 0.42)
	}
}

// TestSearchParams_OptionalFiltersArePointers proves the port accepts
// nil filters (browse mode) AND set filters (filtered browse): the
// adapter turns an absent filter into a degenerate predicate. Building
// a SearchParams with nil filters must not panic and must round-trip
// through Search without mutation.
func TestSearchParams_OptionalFiltersArePointers(t *testing.T) {
	stub := &stubJobRepo{}
	repo := JobRepository(stub)

	_, err := repo.Search(context.Background(), SearchParams{
		// All filter pointers nil → browse.
		Limit: 20,
	})
	if err != nil {
		t.Fatalf("expected nil err on browse search, got: %v", err)
	}
	if stub.gotParams.Limit != 20 {
		t.Errorf("Limit: got %d, want 20", stub.gotParams.Limit)
	}
	if stub.gotParams.Q != nil {
		t.Errorf("Q must remain nil on browse, got %v", *stub.gotParams.Q)
	}
}

// TestSearchParams_FilteredSearchPassesValues confirms that populated
// filter pointers reach the port intact. The adapter will later map
// these into sqlc's pgtype.Text params, but the port itself only cares
// about the typed shape.
func TestSearchParams_FilteredSearchPassesValues(t *testing.T) {
	stub := &stubJobRepo{}
	repo := JobRepository(stub)

	q := "kubernetes"
	seniority := "senior"
	workMode := "remote"
	empType := "full_time"
	location := "CDMX"
	currency := "MXN"
	limit := 50

	_, err := repo.Search(context.Background(), SearchParams{
		Q:              &q,
		Seniority:      &seniority,
		WorkMode:       &workMode,
		EmploymentType: &empType,
		Location:       &location,
		SalaryCurrency: &currency,
		Limit:          limit,
	})
	if err != nil {
		t.Fatalf("Search returned unexpected err: %v", err)
	}

	got := stub.gotParams
	if got.Q == nil || *got.Q != q {
		t.Errorf("Q: got %v, want %q", got.Q, q)
	}
	if got.Seniority == nil || *got.Seniority != seniority {
		t.Errorf("Seniority: got %v, want %q", got.Seniority, seniority)
	}
	if got.WorkMode == nil || *got.WorkMode != workMode {
		t.Errorf("WorkMode: got %v, want %q", got.WorkMode, workMode)
	}
	if got.EmploymentType == nil || *got.EmploymentType != empType {
		t.Errorf("EmploymentType: got %v, want %q", got.EmploymentType, empType)
	}
	if got.Location == nil || *got.Location != location {
		t.Errorf("Location: got %v, want %q", got.Location, location)
	}
	if got.SalaryCurrency == nil || *got.SalaryCurrency != currency {
		t.Errorf("SalaryCurrency: got %v, want %q", got.SalaryCurrency, currency)
	}
	if got.Limit != limit {
		t.Errorf("Limit: got %d, want %d", got.Limit, limit)
	}
}

// TestJobRepository_GetByIDReturnsErrJobNotFound is the spec scenario
// "GET /jobs/{id} hides non-visible jobs" at the port boundary: when
// the stub returns ErrJobNotFound the caller must see exactly that
// sentinel (errors.Is), so the HTTP layer can map it to 404.
func TestJobRepository_GetByIDReturnsErrJobNotFound(t *testing.T) {
	stub := &stubJobRepo{getErr: entities.ErrJobNotFound}
	repo := JobRepository(stub)

	got, err := repo.GetByID(context.Background(), uuid.New())
	if got != nil {
		t.Errorf("expected nil job on ErrJobNotFound, got %+v", got)
	}
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("expected errors.Is(err, ErrJobNotFound), got %v", err)
	}
}

// TestJobRepository_SearchReturnsRecordedSlice proves the port's
// minimal contract: whatever the adapter puts in the slice is what
// the caller sees. We don't constrain the order here — that's the
// adapter's responsibility — only that values round-trip.
func TestJobRepository_SearchReturnsRecordedSlice(t *testing.T) {
	want := []entities.Job{
		{ID: uuid.New(), Title: "A"},
		{ID: uuid.New(), Title: "B"},
	}
	stub := &stubJobRepo{searchResult: want}
	repo := JobRepository(stub)

	got, err := repo.Search(context.Background(), SearchParams{Limit: 20})
	if err != nil {
		t.Fatalf("Search returned err: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("len: got %d, want %d", len(got), len(want))
	}
	for i := range got {
		if got[i].ID != want[i].ID {
			t.Errorf("[%d].ID: got %v, want %v", i, got[i].ID, want[i].ID)
		}
		if got[i].Title != want[i].Title {
			t.Errorf("[%d].Title: got %q, want %q", i, got[i].Title, want[i].Title)
		}
	}
}

// TestJobRepository_GetByIDPropagatesID is a thin sanity check that the
// port hands the id verbatim to the adapter — defensive against a
// future refactor that accidentally drops the parameter.
func TestJobRepository_GetByIDPropagatesID(t *testing.T) {
	want := uuid.New()
	stub := &stubJobRepo{}
	repo := JobRepository(stub)

	_, _ = repo.GetByID(context.Background(), want)
	if stub.gotID != want {
		t.Errorf("gotID: got %v, want %v", stub.gotID, want)
	}
}
