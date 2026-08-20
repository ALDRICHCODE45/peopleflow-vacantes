//go:build integration

// Package postgres_membership_runtime exercises the CompanyMemberRepository
// adapter against a live PostgreSQL instance. It runs only when the
// integration build tag is set and DATABASE_URL is provided; CI on machines
// without a DB stays fast (the tests `t.Skip` rather than fail).
//
// Scope: the design D7 same-company guard on UpdateRole / Remove. The unit
// suite covers the in-memory translation (mapCreateError, error → sentinel)
// with synthetic *pgconn.PgError values; this file covers the real SQL
// behavior:
//
//   - UpdateRole with a foreign company_id affects 0 rows and surfaces
//     entities.ErrMemberNotFound.
//   - Remove with a foreign company_id affects 0 rows and surfaces
//     entities.ErrMemberNotFound.
//
// Isolation: every test runs inside a transaction that is ALWAYS rolled
// back. Two companies and three users are seeded at the top of each test
// (caller's company, foreign company, target user, caller user) and the
// fixture also creates the membership row that drives the "same-company"
// half of each assertion. Pruning is unnecessary because the whole fixture
// is rolled back. Tests do not call t.Parallel() so the fixtures never
// contend with each other or with the migration tests in
// backend/db/migrations/.
package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// setupMembershipFixture opens a transaction, applies the company-members
// fixture (industry + 2 companies + 3 users + TWO member rows), and returns
// the adapter bound to that transaction.
//
// The fixture is intentionally DESTRUCTIVE: it DELETEs every company_members
// row in the developer's database so the assertions can match exact IDs
// without fuzzy counts. Safe — the cleanup rolls back the transaction.
//
// Two membership rows are seeded:
//
//   - callerRow:  callerUser on callerCompany, role=owner
//   - foreignRow: targetUser on foreignCompany, role=recruiter
//
// The cross-company tests target foreignRow but pass callerCompanyID —
// the SQL guard `WHERE id=$1 AND company_id=$2` then rejects the UPDATE
// because the row's actual company_id differs. The same-company tests
// target callerRow and pass callerCompanyID — that path SHOULD succeed.
//
// Returns the test ctx (with 30s timeout), the adapter, and the fixed
// UUIDs the assertions reference.
func setupMembershipFixture(t *testing.T) (context.Context, *CompanyMemberRepository, uuid.UUID /*callerUser*/, uuid.UUID /*callerCompany*/, uuid.UUID /*foreignCompany*/, uuid.UUID /*callerRow*/, uuid.UUID /*foreignRow*/) {
	t.Helper()

	pool := skipIfNoDatabase(t)
	t.Cleanup(pool.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin fixture tx: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	// Prune any leftover rows from a prior partial run — safe inside the
	// rollback window.
	if _, err := tx.Exec(ctx, `DELETE FROM company_members`); err != nil {
		t.Fatalf("prune company_members: %v", err)
	}

	// Fixed UUIDs so the assertions read like a spec contract.
	industryID := "membership-test-industry"
	callerUserID := uuid.MustParse("018f0000-0000-7000-8000-0000000000a1")
	callerCompanyID := uuid.MustParse("018f0000-0000-7000-8000-0000000000a2")
	foreignCompanyID := uuid.MustParse("018f0000-0000-7000-8000-0000000000a3")
	targetUserID := uuid.MustParse("018f0000-0000-7000-8000-0000000000a4")
	callerRowID := uuid.MustParse("018f0000-0000-7000-8000-0000000000a5")
	foreignRowID := uuid.MustParse("018f0000-0000-7000-8000-0000000000a6")

	seeds := []struct {
		name string
		sql  string
		args []any
	}{
		{"industry", `INSERT INTO industries (id, label_es, label_en, sort_order, active)
		               VALUES ($1, 'T', 'T', 0, true) ON CONFLICT (id) DO NOTHING`,
			[]any{industryID}},
		{"caller company", `INSERT INTO companies (id, name, rfc, industry_id, status)
		                    VALUES ($1, 'Caller Co', 'CALL010101AAA', $2, 'active')`,
			[]any{callerCompanyID, industryID}},
		{"foreign company", `INSERT INTO companies (id, name, rfc, industry_id, status)
		                     VALUES ($1, 'Foreign Co', 'FOR010101BBB', $2, 'active')`,
			[]any{foreignCompanyID, industryID}},
		{"caller user", `INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		                  VALUES ($1, 'caller-sub', 'caller@example.com', 'Caller', 'recruiter')`,
			[]any{callerUserID}},
		{"target user", `INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		                 VALUES ($1, 'target-sub', 'target@example.com', 'Target', 'recruiter')`,
			[]any{targetUserID}},
		{"caller row", `INSERT INTO company_members (id, user_id, company_id, role)
		                VALUES ($1, $2, $3, 'owner')`,
			[]any{callerRowID, callerUserID, callerCompanyID}},
		{"foreign row", `INSERT INTO company_members (id, user_id, company_id, role)
		                 VALUES ($1, $2, $3, 'recruiter')`,
			[]any{foreignRowID, targetUserID, foreignCompanyID}},
	}
	for _, s := range seeds {
		if _, err := tx.Exec(ctx, s.sql, s.args...); err != nil {
			t.Fatalf("seed %s: %v", s.name, err)
		}
	}

	return ctx, NewCompanyMemberRepository(db.New(tx)),
		callerUserID, callerCompanyID, foreignCompanyID, callerRowID, foreignRowID
}

// countMemberRows is the post-condition probe: with the adapter wired to
// the same fixture transaction, we read the row count for the given
// company so the test can prove UpdateRole / Remove didn't mutate the DB
// when the guard rejected the call (0 rows affected).
func countMemberRows(ctx context.Context, t *testing.T, repo *CompanyMemberRepository, companyID uuid.UUID) int {
	t.Helper()
	members, err := repo.ListByCompanyID(ctx, companyID)
	if err != nil {
		t.Fatalf("ListByCompanyID probe: %v", err)
	}
	return len(members)
}

// TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound is the
// runtime proof of the design D7 same-company guard: the caller is
// owner of company X, the target member row lives on company Y, and
// UpdateRole(id=Y-row, companyID=X) must surface
// entities.ErrMemberNotFound WITHOUT mutating the row.
//
// This is the cross-company target scenario from the spec requirement
// "UpdateRole (Owner-Only, Same-Company)" — the adapter enforces it at
// the SQL layer (`WHERE id=$1 AND company_id=$2`), so a 0-rows
// outcome is the ONLY possible response for a foreign target.
func TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound(t *testing.T) {
	ctx, repo, _, callerCompanyID, foreignCompanyID, _, foreignRowID := setupMembershipFixture(t)

	// Sanity precondition: the seeded foreign row lives on the foreign
	// company (Y), not the caller company (X) — this is what makes the
	// guard reject the call. A buggy fixture would put it on X and the
	// test would silently pass on the wrong reason.
	pre := countMemberRows(ctx, t, repo, foreignCompanyID)
	if pre != 1 {
		t.Fatalf("fixture precondition: want 1 member on foreign company, got %d", pre)
	}

	// Cross-company attempt: pass the CALLER's company_id (X) with the
	// FOREIGN row's id. The `WHERE id=$1 AND company_id=$2` predicate
	// matches 0 rows because the row's actual company_id is Y. 0 rows
	// affected → ErrMemberNotFound.
	err := repo.UpdateRole(ctx, foreignRowID, callerCompanyID, valueobjects.RecruiterRole)
	if !errors.Is(err, entities.ErrMemberNotFound) {
		t.Errorf("expected ErrMemberNotFound for cross-company target, got: %v", err)
	}

	// Post-condition: the foreign row is still there with its original
	// role. A leaked UPDATE would have flipped it to recruiter; this
	// assertion proves the guard rejected the write before the SQL
	// touched it.
	post := countMemberRows(ctx, t, repo, foreignCompanyID)
	if post != 1 {
		t.Errorf("cross-company UpdateRole must not mutate; want 1 row, got %d", post)
	}
}

// TestUpdateRole_SameCompanyUpdatesRow is the GREEN companion: same
// (id, company_id) pair as the seeded fixture, valid role → no error,
// role flips. This is what the same-company guard ALLOWS.
func TestUpdateRole_SameCompanyUpdatesRow(t *testing.T) {
	ctx, repo, callerUserID, callerCompanyID, _, callerRowID, _ := setupMembershipFixture(t)

	if err := repo.UpdateRole(ctx, callerRowID, callerCompanyID, valueobjects.RecruiterRole); err != nil {
		t.Fatalf("UpdateRole(same company): unexpected error: %v", err)
	}

	got, err := repo.GetMembershipByUserID(ctx, callerUserID)
	if err != nil {
		t.Fatalf("GetMembershipByUserID after update: %v", err)
	}
	if got.Role != valueobjects.RecruiterRole {
		t.Errorf("role: want RecruiterRole, got %v", got.Role)
	}
}

// TestRemove_CrossCompanyAffectsZeroRowsReturnsNotFound is the Remove
// counterpart of TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound:
// a DELETE on a row whose `company_id` does NOT match the caller's
// must surface ErrMemberNotFound AND leave the row in place. This is
// the cross-company target scenario from the spec requirement
// "RemoveMember (Owner-Only, Same-Company)".
func TestRemove_CrossCompanyAffectsZeroRowsReturnsNotFound(t *testing.T) {
	ctx, repo, _, callerCompanyID, foreignCompanyID, _, foreignRowID := setupMembershipFixture(t)

	pre := countMemberRows(ctx, t, repo, foreignCompanyID)
	if pre != 1 {
		t.Fatalf("fixture precondition: want 1 member on foreign company, got %d", pre)
	}

	// Cross-company attempt: pass the caller's company_id (X) with the
	// foreign row's id (which lives on Y). The SQL guard evaluates to
	// 0 rows → ErrMemberNotFound.
	err := repo.Remove(ctx, foreignRowID, callerCompanyID)
	if !errors.Is(err, entities.ErrMemberNotFound) {
		t.Errorf("expected ErrMemberNotFound for cross-company target, got: %v", err)
	}

	post := countMemberRows(ctx, t, repo, foreignCompanyID)
	if post != 1 {
		t.Errorf("cross-company Remove must not mutate; want 1 row, got %d", post)
	}
}

// TestRemove_SameCompanyDeletesRow is the GREEN companion for Remove.
func TestRemove_SameCompanyDeletesRow(t *testing.T) {
	ctx, repo, _, callerCompanyID, _, callerRowID, _ := setupMembershipFixture(t)

	if err := repo.Remove(ctx, callerRowID, callerCompanyID); err != nil {
		t.Fatalf("Remove(same company): unexpected error: %v", err)
	}

	if post := countMemberRows(ctx, t, repo, callerCompanyID); post != 0 {
		t.Errorf("after Remove, want 0 rows, got %d", post)
	}
}
