// Unit tests for the applications postgres adapter. These tests cover the
// deterministic Go code (mapCreateError, mapTransitionError, mapGetError,
// buildCreateApplicationParams, buildTransitionParams, toApplication,
// toApplicationWithCandidate, toMyApplication) without touching a real
// database. The full SQL coverage lives in the
// `//go:build integration` test files.
//
// The adapter is seam-tested via a narrow `stubQuerier` (programmable
// per-query returns/errors). This pins the D5 two-step scope-check
// behavior (scope-miss → ErrApplicationNotFound; scope-hit + empty →
// non-nil empty slice) and the D2 mapping ordering (pgx.ErrNoRows BEFORE
// errors.As) without spinning up Postgres.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	applicationsvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- stubQuerier ---------------------------------------------------------

// stubQuerier implements the narrow Querier seam the adapter defines. Each
// method is independently programmable: set the `*Return` field for a
// success, set the `*Err` field for a failure. The default zero value
// returns pgx.ErrNoRows (because the underlying type-level zero for the
// return values is the zero value of the type, but we wrap it explicitly
// so the test can reason about the seam).
type stubQuerier struct {
	createApplicationReturn db.CreateApplicationRow
	createApplicationErr    error
	createApplicationCalls  int
	lastCreateApplication   db.CreateApplicationParams

	getApplicationByIDReturn db.GetApplicationByIDRow
	getApplicationByIDErr    error
	getApplicationByIDCalls  int
	lastGetApplicationByID   db.GetApplicationByIDParams

	listApplicationsByJobReturn []db.ListApplicationsByJobRow
	listApplicationsByJobErr    error
	listApplicationsByJobCalls  int
	lastListApplicationsByJob   db.ListApplicationsByJobParams

	listMyApplicationsReturn []db.ListMyApplicationsRow
	listMyApplicationsErr    error
	listMyApplicationsCalls  int
	lastListMyApplications   uuid.UUID

	transitionStatusReturn db.TransitionStatusRow
	transitionStatusErr    error
	transitionStatusCalls  int
	lastTransitionStatus   db.TransitionStatusParams

	getJobForApplicationsScopeReturn uuid.UUID
	getJobForApplicationsScopeErr    error
	getJobForApplicationsScopeCalls  int
	lastGetJobForApplicationsScope   db.GetJobForApplicationsScopeParams
}

func (s *stubQuerier) CreateApplication(ctx context.Context, arg db.CreateApplicationParams) (db.CreateApplicationRow, error) {
	s.createApplicationCalls++
	s.lastCreateApplication = arg
	return s.createApplicationReturn, s.createApplicationErr
}

func (s *stubQuerier) GetApplicationByID(ctx context.Context, arg db.GetApplicationByIDParams) (db.GetApplicationByIDRow, error) {
	s.getApplicationByIDCalls++
	s.lastGetApplicationByID = arg
	return s.getApplicationByIDReturn, s.getApplicationByIDErr
}

func (s *stubQuerier) ListApplicationsByJob(ctx context.Context, arg db.ListApplicationsByJobParams) ([]db.ListApplicationsByJobRow, error) {
	s.listApplicationsByJobCalls++
	s.lastListApplicationsByJob = arg
	return s.listApplicationsByJobReturn, s.listApplicationsByJobErr
}

func (s *stubQuerier) ListMyApplications(ctx context.Context, candidateID uuid.UUID) ([]db.ListMyApplicationsRow, error) {
	s.listMyApplicationsCalls++
	s.lastListMyApplications = candidateID
	return s.listMyApplicationsReturn, s.listMyApplicationsErr
}

func (s *stubQuerier) TransitionStatus(ctx context.Context, arg db.TransitionStatusParams) (db.TransitionStatusRow, error) {
	s.transitionStatusCalls++
	s.lastTransitionStatus = arg
	return s.transitionStatusReturn, s.transitionStatusErr
}

func (s *stubQuerier) GetJobForApplicationsScope(ctx context.Context, arg db.GetJobForApplicationsScopeParams) (uuid.UUID, error) {
	s.getJobForApplicationsScopeCalls++
	s.lastGetJobForApplicationsScope = arg
	return s.getJobForApplicationsScopeReturn, s.getJobForApplicationsScopeErr
}

// --- TestMapCreateError --------------------------------------------------

// TestMapCreateError walks the D2 dispatch table:
//   - nil → nil
//   - bare pgx.ErrNoRows → ErrJobNotApplicable
//   - wrapped pgx.ErrNoRows → ErrJobNotApplicable (errors.Is path)
//   - 23505 → ErrAlreadyApplied (both bare + wrapped)
//   - 23503 → ErrInvalidApplicationReference
//   - 23514 → ErrInvalidStatusTransition
//   - unknown PgError → pass-through
//   - non-pg error → pass-through
//
// Ordering is pinned: pgx.ErrNoRows is checked BEFORE errors.As so a
// 23505 unique violation can never be shadowed by the gate-miss branch.
func TestMapCreateError(t *testing.T) {
	tests := []struct {
		name    string
		in      error
		wantNil bool
		wantIs  error
		wantPas bool
	}{
		{"nil pass-through", nil, true, nil, false},
		{"bare pgx.ErrNoRows → ErrJobNotApplicable", pgx.ErrNoRows, false, sentinelJobNotApplicable, false},
		{"wrapped pgx.ErrNoRows → ErrJobNotApplicable (errors.Is)", fmt.Errorf("querying create_application: %w", pgx.ErrNoRows), false, sentinelJobNotApplicable, false},
		{"direct *pgconn.PgError 23505 → ErrAlreadyApplied", &pgconn.PgError{Code: "23505", Message: "duplicate key"}, false, sentinelAlreadyApplied, false},
		{"wrapped 23505 → ErrAlreadyApplied", fmt.Errorf("create_application: %w", &pgconn.PgError{Code: "23505"}), false, sentinelAlreadyApplied, false},
		{"direct 23503 → ErrInvalidApplicationReference", &pgconn.PgError{Code: "23503", Message: "fk violation"}, false, sentinelInvalidApplicationReference, false},
		{"direct 23514 → ErrInvalidStatusTransition", &pgconn.PgError{Code: "23514", Message: "check violation"}, false, sentinelInvalidStatusTransition, false},
		{"unknown PgError → pass-through", &pgconn.PgError{Code: "42P01", Message: "undefined_table"}, false, nil, true},
		{"non-pg error → pass-through", errors.New("kaboom"), false, nil, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mapCreateError(tc.in)
			if tc.wantNil {
				if got != nil {
					t.Errorf("nil → nil, got %v", got)
				}
				return
			}
			if tc.wantIs != nil {
				if !errors.Is(got, tc.wantIs) {
					t.Errorf("mapCreateError(%v): want errors.Is(., %v), got %v", tc.in, tc.wantIs, got)
				}
				return
			}
			if tc.wantPas {
				if !errors.Is(got, tc.in) {
					t.Errorf("mapCreateError(%v): want pass-through, got %v", tc.in, got)
				}
				return
			}
			t.Fatalf("test case %q: no assertion branch picked", tc.name)
		})
	}
}

// --- TestMapTransitionError ----------------------------------------------

// TestMapTransitionError covers the D4 dispatch table:
//   - nil → nil
//   - pgx.ErrNoRows → ErrApplicationNotFound (lost race / cross-company /
//     non-existent / mismatched job — indistinguishable, 404)
//   - 23514 → ErrInvalidStatusTransition (defense-in-depth)
//   - unknown PgError / non-pg → pass-through
func TestMapTransitionError(t *testing.T) {
	tests := []struct {
		name    string
		in      error
		wantNil bool
		wantIs  error
		wantPas bool
	}{
		{"nil pass-through", nil, true, nil, false},
		{"pgx.ErrNoRows → ErrApplicationNotFound", pgx.ErrNoRows, false, sentinelApplicationNotFound, false},
		{"23514 → ErrInvalidStatusTransition", &pgconn.PgError{Code: "23514"}, false, sentinelInvalidStatusTransition, false},
		{"unknown PgError → pass-through", &pgconn.PgError{Code: "42P01"}, false, nil, true},
		{"non-pg error → pass-through", errors.New("kaboom"), false, nil, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mapTransitionError(tc.in)
			if tc.wantNil {
				if got != nil {
					t.Errorf("nil → nil, got %v", got)
				}
				return
			}
			if tc.wantIs != nil {
				if !errors.Is(got, tc.wantIs) {
					t.Errorf("mapTransitionError(%v): want errors.Is(., %v), got %v", tc.in, tc.wantIs, got)
				}
				return
			}
			if tc.wantPas {
				if !errors.Is(got, tc.in) {
					t.Errorf("mapTransitionError(%v): want pass-through, got %v", tc.in, got)
				}
				return
			}
			t.Fatalf("test case %q: no assertion branch picked", tc.name)
		})
	}
}

// TestMapTransitionError_NoUniqueOrForeignKeyBranch pins the D4 contract
// that mapTransitionError has NO 23503 / 23505 branch — the UPDATE does
// not change FKs (no 23503) and does not touch the UNIQUE pair (no 23505).
// A future refactor that adds one of these branches must justify it
// against this guard.
func TestMapTransitionError_NoUniqueOrForeignKeyBranch(t *testing.T) {
	for code, wantSentinel := range map[string]error{
		"23503": sentinelInvalidApplicationReference,
		"23505": sentinelAlreadyApplied,
	} {
		in := &pgconn.PgError{Code: code, Message: code + " violation"}
		got := mapTransitionError(in)
		if errors.Is(got, wantSentinel) {
			t.Errorf("mapTransitionError MUST NOT map %s → %v (D4: UPDATE doesn't touch FKs or UNIQUE), got %v", code, wantSentinel, got)
		}
		if !errors.Is(got, in) {
			t.Errorf("mapTransitionError must pass through %s unchanged, got %v", code, got)
		}
	}
}

// --- TestMapGetError -----------------------------------------------------

// TestMapGetError covers the small GetByID / scope-check dispatcher:
//   - nil → nil
//   - pgx.ErrNoRows → ErrApplicationNotFound
//   - non-pg / unknown → pass-through
func TestMapGetError(t *testing.T) {
	tests := []struct {
		name    string
		in      error
		wantNil bool
		wantIs  error
		wantPas bool
	}{
		{"nil pass-through", nil, true, nil, false},
		{"pgx.ErrNoRows → ErrApplicationNotFound", pgx.ErrNoRows, false, sentinelApplicationNotFound, false},
		{"wrapped pgx.ErrNoRows → ErrApplicationNotFound", fmt.Errorf("get: %w", pgx.ErrNoRows), false, sentinelApplicationNotFound, false},
		{"non-pg → pass-through", errors.New("kaboom"), false, nil, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mapGetError(tc.in)
			if tc.wantNil {
				if got != nil {
					t.Errorf("nil → nil, got %v", got)
				}
				return
			}
			if tc.wantIs != nil {
				if !errors.Is(got, tc.wantIs) {
					t.Errorf("mapGetError(%v): want errors.Is(., %v), got %v", tc.in, tc.wantIs, got)
				}
				return
			}
			if tc.wantPas {
				if !errors.Is(got, tc.in) {
					t.Errorf("mapGetError(%v): want pass-through, got %v", tc.in, got)
				}
				return
			}
			t.Fatalf("test case %q: no assertion branch picked", tc.name)
		})
	}
}

// --- TestListByJob_ScopeMissReturnsNotFound ------------------------------

// TestListByJob_ScopeMissReturnsNotFound pins D5: when the scope-check
// returns pgx.ErrNoRows (cross-company / non-existent job), ListByJob
// MUST surface ErrApplicationNotFound and MUST NOT call the list query.
func TestListByJob_ScopeMissReturnsNotFound(t *testing.T) {
	q := &stubQuerier{
		getJobForApplicationsScopeErr: pgx.ErrNoRows,
	}
	repo := NewApplicationRepository(q)

	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000001")
	companyID := uuid.MustParse("018f0000-0000-7000-8000-000000000002")

	got, err := repo.ListByJob(context.Background(), jobID, companyID)
	if !errors.Is(err, sentinelApplicationNotFound) {
		t.Errorf("ListByJob scope-miss: want ErrApplicationNotFound, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil on scope miss, got %v", got)
	}
	if q.getJobForApplicationsScopeCalls != 1 {
		t.Errorf("scope-check calls: want 1, got %d", q.getJobForApplicationsScopeCalls)
	}
	if q.listApplicationsByJobCalls != 0 {
		t.Errorf("ListApplicationsByJob MUST NOT be called on scope miss; got %d calls", q.listApplicationsByJobCalls)
	}
}

// --- TestListByJob_ScopeHitEmptyListNonNil -------------------------------

// TestListByJob_ScopeHitEmptyListNonNil: scope check passes, list query
// returns empty → non-nil empty slice (JSON `[]` not `null`).
func TestListByJob_ScopeHitEmptyListNonNil(t *testing.T) {
	q := &stubQuerier{
		getJobForApplicationsScopeReturn: uuid.MustParse("018e0000-0000-7000-8000-0000000000aa"),
		listApplicationsByJobReturn:      nil, // explicit nil — adapter MUST normalize
	}
	repo := NewApplicationRepository(q)

	got, err := repo.ListByJob(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("ListByJob: unexpected err %v", err)
	}
	if got == nil {
		t.Error("want non-nil empty slice, got nil")
	}
	if len(got) != 0 {
		t.Errorf("want empty slice, got %d items", len(got))
	}
	if q.listApplicationsByJobCalls != 1 {
		t.Errorf("list calls: want 1, got %d", q.listApplicationsByJobCalls)
	}
}

// --- TestListByJob_ScopeHitWithRows --------------------------------------

// TestListByJob_ScopeHitWithRows: scope check passes, list query returns
// rows → mapped to []ApplicationWithCandidate with the snippet populated.
func TestListByJob_ScopeHitWithRows(t *testing.T) {
	q := &stubQuerier{
		getJobForApplicationsScopeReturn: uuid.MustParse("018e0000-0000-7000-8000-0000000000aa"),
		listApplicationsByJobReturn: []db.ListApplicationsByJobRow{
			makeListByJobRow(),
		},
	}
	repo := NewApplicationRepository(q)

	got, err := repo.ListByJob(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("ListByJob: unexpected err %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 item, got %d", len(got))
	}
	if got[0].Candidate.FullName != "Test Candidate" {
		t.Errorf("snippet full_name: want %q, got %q", "Test Candidate", got[0].Candidate.FullName)
	}
	if got[0].Candidate.ProfessionalTitle == nil || *got[0].Candidate.ProfessionalTitle != "Engineer" {
		t.Errorf("snippet professional_title: want Engineer, got %v", got[0].Candidate.ProfessionalTitle)
	}
	if got[0].Candidate.YearsOfExperience == nil || *got[0].Candidate.YearsOfExperience != 7 {
		t.Errorf("snippet years_of_experience: want 7, got %v", got[0].Candidate.YearsOfExperience)
	}
}

// --- TestBuildCreateApplicationParams ------------------------------------

// TestBuildCreateApplicationParams pins the D1 pgtype marshaling:
//   - nil *source / *cover_letter → invalid pgtypes (SQL NULL)
//   - non-nil → valid pgtypes with the canonical String()
func TestBuildCreateApplicationParams(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-000000000111")
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000112")
	candidateID := uuid.MustParse("018e0000-0000-7000-8000-000000000113")

	t.Run("all optionals absent → invalid pgtypes", func(t *testing.T) {
		got := buildCreateApplicationParams(id, jobID, candidateID, nil, nil)
		if got.ID != id {
			t.Errorf("ID: want %v, got %v", id, got.ID)
		}
		if got.JobID != jobID {
			t.Errorf("JobID: want %v, got %v", jobID, got.JobID)
		}
		if got.CandidateID != candidateID {
			t.Errorf("CandidateID: want %v, got %v", candidateID, got.CandidateID)
		}
		if got.Source.Valid {
			t.Errorf("Source: want invalid, got %+v", got.Source)
		}
		if got.CoverLetter.Valid {
			t.Errorf("CoverLetter: want invalid, got %+v", got.CoverLetter)
		}
	})

	t.Run("all optionals present → valid pgtypes", func(t *testing.T) {
		src := applicationsvalueobjects.LinkedIn
		cover := "Hi team!"
		got := buildCreateApplicationParams(id, jobID, candidateID, &src, &cover)
		if !got.Source.Valid || got.Source.String != "linkedin" {
			t.Errorf("Source: want valid+linkedin, got %+v", got.Source)
		}
		if !got.CoverLetter.Valid || got.CoverLetter.String != "Hi team!" {
			t.Errorf("CoverLetter: want valid+%q, got %+v", "Hi team!", got.CoverLetter)
		}
	})
}

// --- TestBuildTransitionParams -------------------------------------------

// TestBuildTransitionParams pins the D3 pgtype marshaling for the UPDATE.
// sqlc arg order by first appearance: ToStatus, ID, JobID, FromStatus,
// CompanyID.
func TestBuildTransitionParams(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-000000000121")
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000122")
	companyID := uuid.MustParse("018f0000-0000-7000-8000-000000000123")

	got := buildTransitionParams(id, jobID, companyID, applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview)

	if got.ToStatus != "in_review" {
		t.Errorf("ToStatus: want %q, got %q", "in_review", got.ToStatus)
	}
	if got.FromStatus != "submitted" {
		t.Errorf("FromStatus: want %q, got %q", "submitted", got.FromStatus)
	}
	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.JobID != jobID {
		t.Errorf("JobID: want %v, got %v", jobID, got.JobID)
	}
	if got.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, got.CompanyID)
	}
}

// --- TestToApplicationEntity ---------------------------------------------

// TestToApplicationEntity covers the row → entity mapping for the basic
// Application type (CreateApplicationRow / TransitionStatusRow).
func TestToApplicationEntity(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-000000000131")
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000132")
	candidateID := uuid.MustParse("018e0000-0000-7000-8000-000000000133")
	pub := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	t.Run("full row", func(t *testing.T) {
		row := db.CreateApplicationRow{
			ID:          id,
			JobID:       jobID,
			CandidateID: candidateID,
			Status:      "submitted",
			Source:      pgtype.Text{String: "linkedin", Valid: true},
			CoverLetter: pgtype.Text{String: "Hi", Valid: true},
			CreatedAt:   pgtype.Timestamptz{Time: pub, Valid: true},
			UpdatedAt:   pgtype.Timestamptz{Time: pub, Valid: true},
		}
		got, err := toApplication(row)
		if err != nil {
			t.Fatalf("toApplication: %v", err)
		}
		if got.ID != id {
			t.Errorf("ID: want %v, got %v", id, got.ID)
		}
		if got.JobID != jobID {
			t.Errorf("JobID: want %v, got %v", jobID, got.JobID)
		}
		if got.CandidateID != candidateID {
			t.Errorf("CandidateID: want %v, got %v", candidateID, got.CandidateID)
		}
		if got.Status != applicationsvalueobjects.Submitted {
			t.Errorf("Status: want Submitted, got %v", got.Status)
		}
		if got.Source == nil || *got.Source != applicationsvalueobjects.LinkedIn {
			t.Errorf("Source: want LinkedIn, got %v", got.Source)
		}
		if got.CoverLetter == nil || *got.CoverLetter != "Hi" {
			t.Errorf("CoverLetter: want %q, got %v", "Hi", got.CoverLetter)
		}
		if !got.CreatedAt.Equal(pub) {
			t.Errorf("CreatedAt: want %v, got %v", pub, got.CreatedAt)
		}
	})

	t.Run("optionals absent → nil pointers", func(t *testing.T) {
		row := db.CreateApplicationRow{
			ID:          id,
			JobID:       jobID,
			CandidateID: candidateID,
			Status:      "submitted",
			Source:      pgtype.Text{Valid: false},
			CoverLetter: pgtype.Text{Valid: false},
			CreatedAt:   pgtype.Timestamptz{Time: pub, Valid: true},
			UpdatedAt:   pgtype.Timestamptz{Time: pub, Valid: true},
		}
		got, err := toApplication(row)
		if err != nil {
			t.Fatalf("toApplication: %v", err)
		}
		if got.Source != nil {
			t.Errorf("Source: want nil, got %v", *got.Source)
		}
		if got.CoverLetter != nil {
			t.Errorf("CoverLetter: want nil, got %v", *got.CoverLetter)
		}
	})

	t.Run("invalid status fails loud", func(t *testing.T) {
		row := db.CreateApplicationRow{
			ID: id, JobID: jobID, CandidateID: candidateID,
			Status: "withdrawn",
		}
		_, err := toApplication(row)
		if !errors.Is(err, sentinelInvalidStatusTransition) {
			t.Errorf("want ErrInvalidStatusTransition, got %v", err)
		}
	})
}

// --- TestToApplicationWithCandidate --------------------------------------

// TestToApplicationWithCandidate covers the row → ApplicationWithCandidate
// mapping (GetApplicationByIDRow / ListApplicationsByJobRow), with
// candidate-without-profile → nil ProfessionalTitle / YearsOfExperience.
func TestToApplicationWithCandidate(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-000000000141")
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000142")
	candidateID := uuid.MustParse("018e0000-0000-7000-8000-000000000143")
	pub := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	t.Run("with profile", func(t *testing.T) {
		row := db.GetApplicationByIDRow{
			ID:                         id,
			JobID:                      jobID,
			CandidateID:                candidateID,
			Status:                     "in_review",
			CreatedAt:                  pgtype.Timestamptz{Time: pub, Valid: true},
			UpdatedAt:                  pgtype.Timestamptz{Time: pub, Valid: true},
			CandidateFullName:          "Alice Engineer",
			CandidateProfessionalTitle: pgtype.Text{String: "Senior", Valid: true},
			CandidateYearsOfExperience: pgtype.Int2{Int16: 7, Valid: true},
		}
		got, err := toApplicationWithCandidate(row)
		if err != nil {
			t.Fatalf("toApplicationWithCandidate: %v", err)
		}
		if got.Candidate.UserID != candidateID {
			t.Errorf("snippet user_id: want %v, got %v", candidateID, got.Candidate.UserID)
		}
		if got.Candidate.FullName != "Alice Engineer" {
			t.Errorf("snippet full_name: want %q, got %q", "Alice Engineer", got.Candidate.FullName)
		}
		if got.Candidate.ProfessionalTitle == nil || *got.Candidate.ProfessionalTitle != "Senior" {
			t.Errorf("snippet professional_title: want Senior, got %v", got.Candidate.ProfessionalTitle)
		}
		if got.Candidate.YearsOfExperience == nil || *got.Candidate.YearsOfExperience != 7 {
			t.Errorf("snippet years: want 7, got %v", got.Candidate.YearsOfExperience)
		}
		if got.Status != applicationsvalueobjects.InReview {
			t.Errorf("Status: want InReview, got %v", got.Status)
		}
	})

	t.Run("without profile → nil snippet fields", func(t *testing.T) {
		row := db.GetApplicationByIDRow{
			ID:                         id,
			JobID:                      jobID,
			CandidateID:                candidateID,
			Status:                     "submitted",
			CreatedAt:                  pgtype.Timestamptz{Time: pub, Valid: true},
			UpdatedAt:                  pgtype.Timestamptz{Time: pub, Valid: true},
			CandidateFullName:          "No Profile",
			CandidateProfessionalTitle: pgtype.Text{Valid: false},
			CandidateYearsOfExperience: pgtype.Int2{Valid: false},
		}
		got, err := toApplicationWithCandidate(row)
		if err != nil {
			t.Fatalf("toApplicationWithCandidate: %v", err)
		}
		if got.Candidate.FullName != "No Profile" {
			t.Errorf("snippet full_name: want %q, got %q", "No Profile", got.Candidate.FullName)
		}
		if got.Candidate.ProfessionalTitle != nil {
			t.Errorf("snippet professional_title: want nil (LEFT JOIN yielded NULL), got %v", got.Candidate.ProfessionalTitle)
		}
		if got.Candidate.YearsOfExperience != nil {
			t.Errorf("snippet years: want nil (LEFT JOIN yielded NULL), got %v", got.Candidate.YearsOfExperience)
		}
	})
}

// --- TestToMyApplication --------------------------------------------------

// TestToMyApplication covers the row → MyApplication mapping
// (ListMyApplicationsRow), including the JobSummary pointer.
func TestToMyApplication(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-000000000151")
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000152")
	candidateID := uuid.MustParse("018e0000-0000-7000-8000-000000000153")
	companyID := uuid.MustParse("018f0000-0000-7000-8000-000000000154")
	pub := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	row := db.ListMyApplicationsRow{
		ID:          id,
		JobID:       jobID,
		CandidateID: candidateID,
		Status:      "submitted",
		CreatedAt:   pgtype.Timestamptz{Time: pub, Valid: true},
		UpdatedAt:   pgtype.Timestamptz{Time: pub, Valid: true},
		JobTitle:    "Backend Engineer",
		CompanyID:   companyID,
		CompanyName: "Acme SA",
	}
	got, err := toMyApplication(row)
	if err != nil {
		t.Fatalf("toMyApplication: %v", err)
	}
	if got.Job.ID != jobID {
		t.Errorf("Job.ID: want %v, got %v", jobID, got.Job.ID)
	}
	if got.Job.Title != "Backend Engineer" {
		t.Errorf("Job.Title: want %q, got %q", "Backend Engineer", got.Job.Title)
	}
	if got.Job.CompanyID != companyID {
		t.Errorf("Job.CompanyID: want %v, got %v", companyID, got.Job.CompanyID)
	}
	if got.Job.CompanyName != "Acme SA" {
		t.Errorf("Job.CompanyName: want %q, got %q", "Acme SA", got.Job.CompanyName)
	}
}

// --- helpers -------------------------------------------------------------

// makeListByJobRow returns a fully-populated row for the scope-hit-with-rows
// test.
func makeListByJobRow() db.ListApplicationsByJobRow {
	id := uuid.MustParse("018e0000-0000-7000-8000-000000000161")
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000162")
	candidateID := uuid.MustParse("018e0000-0000-7000-8000-000000000163")
	pub := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	return db.ListApplicationsByJobRow{
		ID:                         id,
		JobID:                      jobID,
		CandidateID:                candidateID,
		Status:                     "submitted",
		CreatedAt:                  pgtype.Timestamptz{Time: pub, Valid: true},
		UpdatedAt:                  pgtype.Timestamptz{Time: pub, Valid: true},
		CandidateFullName:          "Test Candidate",
		CandidateProfessionalTitle: pgtype.Text{String: "Engineer", Valid: true},
		CandidateYearsOfExperience: pgtype.Int2{Int16: 7, Valid: true},
	}
}
