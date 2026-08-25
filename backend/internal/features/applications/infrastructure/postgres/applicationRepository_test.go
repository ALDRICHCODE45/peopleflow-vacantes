// Unit tests for the applications postgres adapter. These tests cover the
// deterministic Go code (mapCreateError, mapTransitionError, mapGetError,
// buildCreateApplicationParams, buildTransitionParams, toApplication,
// toApplicationWithCandidate, toMyApplication) without touching a real
// database. The full SQL + co-write coverage lives in the
// `//go:build integration` test files.
//
// The old narrow `stubQuerier` seam (and the three TestListByJob_* tests that
// exercised the two-step scope check through it) is REMOVED with the D5 seam
// change: the pool-owning adapter's reads go through db.New(r.pool), which a
// stub cannot replace without spinning up Postgres — that coverage now lives
// in the integration suite (ListByJob scope-miss/hit/cap scenarios).
package postgres

import (
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
