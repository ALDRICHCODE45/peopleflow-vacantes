package postgres

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/jackc/pgx/v5/pgconn"
)

// TestMapCreateError_NilReturnsNil is the entry guard: a nil input MUST
// pass through (the caller already chained this behind an `if err != nil`
// check, but the guard is documented so the call site is obvious).
func TestMapCreateError_NilReturnsNil(t *testing.T) {
	if got := mapCreateError(nil); got != nil {
		t.Errorf("expected nil for nil input, got: %v", got)
	}
}

// TestMapCreateError_23505MapsToErrMemberExists locks the design error
// table row "ErrMemberExists ← 23505 company_members_user_id_unique".
// The SQLSTATE assignment is the contract — the adapter's only job is to
// translate it. The DB CHECK on `role` produces 23514, not 23505, so the
// 23505 branch is UNIQUE-only.
func TestMapCreateError_23505MapsToErrMemberExists(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23505",
		Message:        `duplicate key value violates unique constraint "company_members_user_id_unique"`,
		ConstraintName: "company_members_user_id_unique",
	}
	got := mapCreateError(pgErr)
	if !errors.Is(got, entities.ErrMemberExists) {
		t.Errorf("expected ErrMemberExists for 23505, got: %v", got)
	}
}

// TestMapCreateError_23503MapsToErrUserNotFound locks the design error
// table row "ErrUserNotFound ← 23503 user_id". A 23503 on a different FK
// (e.g. company_id) would also surface as 23503, but the same sentinel
// is correct in that case too — both are "reference target missing" at
// the HTTP layer, and the spec maps both to 404.
func TestMapCreateError_23503MapsToErrUserNotFound(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23503",
		Message:        `insert or update on table "company_members" violates foreign key constraint "company_members_user_id_fkey"`,
		ConstraintName: "company_members_user_id_fkey",
	}
	got := mapCreateError(pgErr)
	if !errors.Is(got, entities.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound for 23503, got: %v", got)
	}
}

// TestMapCreateError_23503OnCompanyIDAlsoMapsToErrUserNotFound covers
// the "different FK, same sentinel" case described above. The HTTP layer
// cannot meaningfully distinguish "user X not found" from "company Y not
// found" — both are 404 — so collapsing both into ErrUserNotFound is
// the right granularity. If a future caller needs finer detail, a
// ConstraintName-aware switch is the place to add it.
func TestMapCreateError_23503OnCompanyIDAlsoMapsToErrUserNotFound(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23503",
		Message:        `insert or update on table "company_members" violates foreign key constraint "company_members_company_id_fkey"`,
		ConstraintName: "company_members_company_id_fkey",
	}
	got := mapCreateError(pgErr)
	if !errors.Is(got, entities.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound for 23503 on company_id, got: %v", got)
	}
}

// TestMapCreateError_Wrapped23505StillResolves is the wrapping safety
// net: the goroutine boundary, the use-case layer, and the HTTP layer
// all wrap errors with `fmt.Errorf("...: %w", err)`. The adapter MUST
// unwrap the pgError via errors.As so the 23505 branch still fires.
func TestMapCreateError_Wrapped23505StillResolves(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23505",
		ConstraintName: "company_members_user_id_unique",
	}
	wrapped := fmt.Errorf("Create: %w", pgErr)
	got := mapCreateError(wrapped)
	if !errors.Is(got, entities.ErrMemberExists) {
		t.Errorf("expected ErrMemberExists via wrapped pgErr, got: %v", got)
	}
}

// TestMapCreateError_Wrapped23503StillResolves is the FK companion to
// the wrapped 23505 test above.
func TestMapCreateError_Wrapped23503StillResolves(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23503",
		ConstraintName: "company_members_user_id_fkey",
	}
	wrapped := fmt.Errorf("Create: %w", pgErr)
	got := mapCreateError(wrapped)
	if !errors.Is(got, entities.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound via wrapped pgErr, got: %v", got)
	}
}

// TestMapCreateError_UnrelatedPgCodePassesThrough proves the function
// does NOT coerce unknown SQLSTATE codes to a domain sentinel. A
// 42P01 (undefined_table) leak would otherwise turn into a 404/409 from
// the HTTP layer — a silent outage class.
func TestMapCreateError_UnrelatedPgCodePassesThrough(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:    "42P01",
		Message: `relation "missing" does not exist`,
	}
	got := mapCreateError(pgErr)
	if !errors.Is(got, pgErr) {
		t.Errorf("expected pass-through of pgErr, got: %v", got)
	}
}

// TestMapCreateError_NonPgErrorPassesThrough is the "no pg error at all"
// case: a connection failure, a context cancellation, or a driver bug
// must NOT be coerced into a domain sentinel. The HTTP layer logs the
// real error and returns 500 with a generic message.
func TestMapCreateError_NonPgErrorPassesThrough(t *testing.T) {
	original := errors.New("dial tcp: connection refused")
	got := mapCreateError(original)
	if got != original {
		t.Errorf("expected original error back, got: %v", got)
	}
	if errors.Is(got, entities.ErrMemberExists) || errors.Is(got, entities.ErrUserNotFound) {
		t.Errorf("non-pg error must not be coerced to a domain sentinel, got: %v", got)
	}
}

// TestMapCreateError_NonPgErrorMessagePreserved is the regression guard
// against a refactor that accidentally wraps the original error and
// loses the message. The original message is what operators see in
// logs — collapsing it to a generic "internal error" hides the real
// failure.
func TestMapCreateError_NonPgErrorMessagePreserved(t *testing.T) {
	original := errors.New("driver: connection reset by peer")
	got := mapCreateError(original)
	if !strings.Contains(got.Error(), "driver: connection reset by peer") {
		t.Errorf("expected original message preserved, got %q", got.Error())
	}
}
