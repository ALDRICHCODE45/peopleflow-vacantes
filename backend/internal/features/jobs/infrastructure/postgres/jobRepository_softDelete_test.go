// Unit tests for the SoftDelete adapter helpers (no DB required).
//
// These tests cover the deterministic Go helpers the postgres adapter
// introduces for soft-delete (jobs-soft-delete slice, design §5.5 +
// §3 D3). The DB-level proof lives in the
// `//go:build integration` suite; this file pins the helpers in
// isolation so the adapter compiles without a Postgres fixture.
//
// Test coverage mirrors `updateJobRepository_test.go` (the parallel
// unit-test file for the Update adapter):
//
//   - TestMapSoftDeleteError        → mapSoftDeleteError dispatch table.
//   - TestBuildSoftDeleteJobParams  → buildSoftDeleteJobParams param shape.
//
// mapSoftDeleteError specifically asserts the D3 ordering invariants:
//   - pgx.ErrNoRows → ErrCompanyNotActive (BEFORE errors.As into
//     *pgconn.PgError so the two checks coexist without precedence
//     conflict).
//   - 23514 → ErrInvalidStatusTransition (defense-in-depth; the minimal
//     SET list cannot trip a CHECK on the designed flow).
//   - NO 23503 mapping (soft-delete never inserts/reassigns company_id).
//   - Unknown PgError / non-pg error → pass-through (HTTP 500).
package postgres

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// --- TestMapSoftDeleteError --------------------------------------------

// TestMapSoftDeleteError walks every cell of the D3 dispatch table:
// nil pass-through, pgx.ErrNoRows → ErrCompanyNotActive (bare + wrapped),
// 23514 → ErrInvalidStatusTransition (direct + wrapped + via fmt.Errorf),
// unknown PgError pass-through, non-pg error pass-through. The test also
// pins the absence of a 23503 branch (D3 — soft-delete never touches
// company_id, so FK violation is impossible on this path).
func TestMapSoftDeleteError(t *testing.T) {
	tests := []struct {
		name    string
		in      error
		wantNil bool
		wantIs  error
		wantPas bool // want pass-through (in == out by errors.Is)
	}{
		{
			name:    "nil pass-through",
			in:      nil,
			wantNil: true,
		},
		{
			name:   "bare pgx.ErrNoRows → ErrCompanyNotActive",
			in:     pgx.ErrNoRows,
			wantIs: entities.ErrCompanyNotActive,
		},
		{
			name:   "wrapped pgx.ErrNoRows → ErrCompanyNotActive (errors.Is path)",
			in:     fmt.Errorf("querying soft_delete_job: %w", pgx.ErrNoRows),
			wantIs: entities.ErrCompanyNotActive,
		},
		{
			name: "direct *pgconn.PgError Code 23514 → ErrInvalidStatusTransition",
			in: &pgconn.PgError{
				Code:       "23514",
				Message:    "new row for relation \"jobs\" violates check constraint",
				ColumnName: "",
				File:       "check.c",
				Line:       0,
			},
			wantIs: entities.ErrInvalidStatusTransition,
		},
		{
			name: "wrapped 23514 → ErrInvalidStatusTransition (errors.As path)",
			in: fmt.Errorf("soft_delete_job: %w", &pgconn.PgError{
				Code:    "23514",
				Message: "check violation",
			}),
			wantIs: entities.ErrInvalidStatusTransition,
		},
		{
			name: "unknown PgError Code → pass-through",
			in: &pgconn.PgError{
				Code:    "42P01",
				Message: "undefined_table",
			},
			wantPas: true,
		},
		{
			name:    "non-pg error → pass-through",
			in:      errors.New("kaboom"),
			wantPas: true,
		},
		{
			name:    "wrapped non-pg error → pass-through",
			in:      fmt.Errorf("soft_delete_job: kaboom"),
			wantPas: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mapSoftDeleteError(tt.in)
			if tt.wantNil {
				if got != nil {
					t.Errorf("mapSoftDeleteError(nil): want nil, got %v", got)
				}
				return
			}
			if tt.wantIs != nil {
				if !errors.Is(got, tt.wantIs) {
					t.Errorf("mapSoftDeleteError(%v): want errors.Is(., %v), got %v", tt.in, tt.wantIs, got)
				}
				// The mapped sentinel MUST NOT be wrapped: the use case
				// dispatches on errors.Is, and the handler dispatches on
				// errors.Is inside classifyError.
				if got != tt.wantIs {
					t.Errorf("mapSoftDeleteError: want bare sentinel %v, got wrapped %v", tt.wantIs, got)
				}
				return
			}
			if tt.wantPas {
				// Pass-through: errors.Is(got, in) holds AND the chain is
				// preserved so callers can log the original.
				if !errors.Is(got, tt.in) {
					t.Errorf("pass-through: want errors.Is(., %v), got %v", tt.in, got)
				}
				return
			}
			t.Fatalf("test case %q: no assertion branch picked (got %v)", tt.name, got)
		})
	}
}

// TestMapSoftDeleteError_NoForeignKeyBranch pins the D3 contract that
// soft-delete never maps 23503 (FK violation on jobs.company_id): the
// minimal SET list does not insert or reassign company_id, so a FK
// violation is impossible on this path. If a future refactor adds a
// 23503 mapping here, this test fails — forcing the author to justify
// the change rather than silently widening the surface.
func TestMapSoftDeleteError_NoForeignKeyBranch(t *testing.T) {
	in := &pgconn.PgError{
		Code:    "23503",
		Message: "insert or update on table \"jobs\" violates foreign key constraint",
	}
	got := mapSoftDeleteError(in)
	if errors.Is(got, entities.ErrCompanyGone) {
		t.Errorf("mapSoftDeleteError must NOT map 23503 → ErrCompanyGone (D3: soft-delete never reassigns company_id), got %v", got)
	}
	if !errors.Is(got, in) {
		t.Errorf("mapSoftDeleteError must pass through 23503 unchanged, got %v", got)
	}
}

// --- TestBuildSoftDeleteJobParams --------------------------------------

// TestBuildSoftDeleteJobParams pins the D1 arg-order contract: the
// adapter MUST emit a SoftDeleteJobParams whose fields match the sqlc
// first-textual-appearance order (company_id, id, cas_token). The
// generated sqlc field names are pinned by the SQL aliases, so a
// drift in either the helper or the SQL aliases surfaces as a compile
// error — but the runtime shape MUST still be exact (UUID vs UUID,
// Timestamptz with Valid=true and the Time lifted from casUpdatedAt).
func TestBuildSoftDeleteJobParams(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-0000000000aa")
	companyID := uuid.MustParse("018f0000-0000-7000-8000-000000000001")
	casUpdatedAt := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	got := buildSoftDeleteJobParams(id, companyID, casUpdatedAt)

	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, got.CompanyID)
	}
	if !got.CasToken.Valid {
		t.Errorf("CasToken.Valid: want true, got false")
	}
	if !got.CasToken.Time.Equal(casUpdatedAt) {
		t.Errorf("CasToken.Time: want %v, got %v", casUpdatedAt, got.CasToken.Time)
	}
}

// TestBuildSoftDeleteJobParams_ZeroTimeStillValid pins the contract
// that the helper wraps casUpdatedAt unconditionally as Valid=true
// (even at the zero time) — the SQL WHERE treats the cas_token as a
// real timestamptz and returns 0 rows on mismatch. The adapter never
// produces a Valid=false CasToken on this path (the use case's CAS
// compare would have caught the zero token earlier as a 409, but the
// adapter must not silently substitute NULL if it ever falls through).
func TestBuildSoftDeleteJobParams_ZeroTimeStillValid(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()

	got := buildSoftDeleteJobParams(id, companyID, time.Time{})

	if !got.CasToken.Valid {
		t.Errorf("CasToken.Valid: want true even for zero time, got false")
	}
	if !got.CasToken.Time.IsZero() {
		t.Errorf("CasToken.Time: want zero, got %v", got.CasToken.Time)
	}
}
