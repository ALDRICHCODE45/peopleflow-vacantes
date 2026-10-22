//go:build integration

// Package migrations_test exercises migration 00009 (`company_members`) against
// a real PostgreSQL instance. With the integration build tag and a guarded
// DRAFT_TEST_DATABASE_URL, each test gets a fresh draft_test_mig_* database.
// CREATEDB is required; ambient DATABASE_URL is never migrated.
//
// These tests cover the four scenarios from the spec requirement
// `company_members Schema Migration`:
//
//   - "up creates named objects": `company_members`, the UNIQUE on `user_id`,
//     and the named CHECK `company_members_role_check` all exist after
//     `goose up` applies 00009.
//   - "down drops the table": after `goose down` reverts 00009 the table is
//     gone.
//   - "invalid role is rejected by the DB": inserting `role='admin'` returns
//     SQLSTATE 23514 (check_violation).
//   - "second membership for same user is rejected": inserting a second row
//     with a duplicate `user_id` returns SQLSTATE 23505 (unique_violation).
//
// Each test owns its schema history and drops its database at cleanup.
package migrations_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
)

// version9Database gives historical constraint tests their own database too;
// never roll an ambient DATABASE_URL or the shared draft harness backward.
func version9Database(t *testing.T) (*sql.DB, *pgxpool.Pool) {
	t.Helper()
	db, pool, _ := isolatedMigrationDB(t)
	gooseDownTo(t, db, 9)
	return db, pool
}

// gooseUpTo applies every migration from 00001 through `version` (inclusive).
// The working directory of `go test` is the package directory, which is the
// migrations directory — so "." resolves to `backend/db/migrations/`.
func gooseUpTo(t *testing.T, db *sql.DB, version int64) {
	t.Helper()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose SetDialect: %v", err)
	}
	if err := goose.UpTo(db, ".", version); err != nil {
		t.Fatalf("goose UpTo(%d): %v", version, err)
	}
}

// gooseUpAll applies every pending migration, restoring the schema to its
// highest applied version. Used before fixture cleanup that needs current tables.
func gooseUpAll(t *testing.T, db *sql.DB) {
	t.Helper()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose SetDialect: %v", err)
	}
	if err := goose.Up(db, "."); err != nil {
		t.Fatalf("goose Up(all): %v", err)
	}
}

// gooseDownTo reverts migrations down to `version` (inclusive stays applied).
func gooseDownTo(t *testing.T, db *sql.DB, version int64) {
	t.Helper()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose SetDialect: %v", err)
	}
	if err := goose.DownTo(db, ".", version); err != nil {
		t.Fatalf("goose DownTo(%d): %v", version, err)
	}
}

// requireUsersAndCompaniesTables exists because every test inserts FK
// targets into `users` and `companies`; if migrations 00001..00005 are not
// applied yet, those inserts will fail in a way that obscures the real
// 00009 contract. Failing loudly here is friendlier than chasing a
// confusing FK error.
func requireUsersAndCompaniesTables(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, tbl := range []string{"users", "companies", "industries"} {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`,
			tbl,
		).Scan(&exists); err != nil {
			t.Fatalf("probe %s: %v", tbl, err)
		}
		if !exists {
			t.Fatalf("prerequisite table %q missing — run `make db-migrate` (at least up to 00005) before this suite", tbl)
		}
	}
}

// seedPrereqs inserts an industry, a company, and a user with fixed UUIDs,
// using ON CONFLICT DO NOTHING so repeated test runs are idempotent.
func seedPrereqs(ctx context.Context, t *testing.T, pool *pgxpool.Pool) (industryID string, companyID, userID uuid.UUID) {
	t.Helper()

	industryID = "company-members-test-industry"
	if _, err := pool.Exec(ctx,
		`INSERT INTO industries (id, label_es, label_en, sort_order, active)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO NOTHING`,
		industryID, "T9", "T9", 0, true,
	); err != nil {
		t.Fatalf("seed industry: %v", err)
	}

	companyID = uuid.MustParse("018f0000-0000-7000-8000-000000000099")
	if _, err := pool.Exec(ctx,
		`INSERT INTO companies (id, name, rfc, industry_id, status)
		 VALUES ($1, $2, $3, $4, 'active')
		 ON CONFLICT (id) DO NOTHING`,
		companyID, "Members Test Co", "MEMB090101AAA", industryID,
	); err != nil {
		t.Fatalf("seed company: %v", err)
	}

	userID = uuid.MustParse("018f0000-0000-7000-8000-00000000009a")
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, 'recruiter')
		 ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING`,
		userID, "members-test-sub", "members-test@example.com", "Members Test",
	); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return industryID, companyID, userID
}

// ---------------------------------------------------------------------------
// 1.1 — up creates named objects
// ---------------------------------------------------------------------------

// TestMigration00009UpCreatesNamedObjects proves the spec scenario
// "up creates named objects": after `goose up` applies migration 00009,
// the table `company_members`, the named CHECK `company_members_role_check`,
// and the UNIQUE on `user_id` all exist in `information_schema` /
// `pg_indexes`.
func TestMigration00009UpCreatesNamedObjects(t *testing.T) {
	db, pool := version9Database(t)

	// Apply 00009 (idempotent — earlier migrations may already be applied).
	// In the RED phase this fails because migration 00009 does not yet
	// exist on disk; that failure is the spec's "production code does not
	// exist yet" signal.
	gooseUpTo(t, db, 9)

	ctx := context.Background()

	// 1. The table itself.
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_name = 'company_members')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("probe company_members: %v", err)
	}
	if !hasTable {
		t.Fatal("expected table `company_members` to exist after 00009 up")
	}

	// 2. The named CHECK on `role`.
	var hasCheck bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
		    SELECT 1 FROM information_schema.table_constraints
		    WHERE table_name = 'company_members'
		      AND constraint_name = 'company_members_role_check'
		)`,
	).Scan(&hasCheck); err != nil {
		t.Fatalf("probe role check: %v", err)
	}
	if !hasCheck {
		t.Fatal("expected named CHECK `company_members_role_check` to exist")
	}

	// 3. The UNIQUE on `user_id`. Postgres auto-names a UNIQUE constraint
	// `<table>_<col>_key`; either an explicit index OR a UNIQUE constraint
	// satisfies "UNIQUE(user_id)".
	var hasUnique bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
		    SELECT 1 FROM pg_indexes
		    WHERE tablename = 'company_members'
		      AND (indexname = 'company_members_user_id_key'
		           OR indexdef LIKE '%UNIQUE%user_id%')
		)`,
	).Scan(&hasUnique); err != nil {
		t.Fatalf("probe user_id unique: %v", err)
	}
	if !hasUnique {
		t.Fatal("expected UNIQUE on user_id (constraint or index) to exist")
	}
}

// ---------------------------------------------------------------------------
// 1.2 — down drops the table
// ---------------------------------------------------------------------------

// TestMigration00009DownDropsTable proves the spec scenario "down drops
// the table": after `goose down` reverts 00009, the table `company_members`
// is gone.
//
// A precondition assertion verifies the table EXISTS after `goose up`
// applied 00009 — otherwise the negative assertion below could pass
// vacuously (the table was never created in the first place, which is
// exactly what the up test catches). Both halves must be exercised for
// the contract "down drops the table" to mean anything.
func TestMigration00009DownDropsTable(t *testing.T) {
	db, pool := version9Database(t)

	// Make sure 00009 is applied before we test down.
	gooseUpTo(t, db, 9)

	ctx := context.Background()

	// Precondition: 00009 up must have created the table.
	var hasTableAfterUp bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_name = 'company_members')`,
	).Scan(&hasTableAfterUp); err != nil {
		t.Fatalf("probe company_members (after up): %v", err)
	}
	if !hasTableAfterUp {
		t.Fatal("precondition failed: 00009 up did not create `company_members`; cannot exercise down")
	}

	// Run the down half of 00009 only — land at version 8.
	gooseDownTo(t, db, 8)
	// The owned database is dropped at cleanup; no shared schema needs restoration.

	var hasTableAfterDown bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_name = 'company_members')`,
	).Scan(&hasTableAfterDown); err != nil {
		t.Fatalf("probe company_members (after down): %v", err)
	}
	if hasTableAfterDown {
		t.Fatal("expected table `company_members` to be gone after 00009 down")
	}
}

// ---------------------------------------------------------------------------
// 1.3 — invalid role and duplicate user_id are both rejected by the DB
// ---------------------------------------------------------------------------

// TestMigration00009RejectsInvalidRole proves the spec scenario "invalid
// role is rejected by the DB": inserting role='admin' returns SQLSTATE
// 23514 (check_violation) because the named CHECK only allows
// 'owner' | 'recruiter'.
func TestMigration00009RejectsInvalidRole(t *testing.T) {
	db, pool := version9Database(t)

	// Make sure 00009 is applied before we test the constraint.
	gooseUpTo(t, db, 9)

	ctx := context.Background()
	requireUsersAndCompaniesTables(ctx, t, pool)
	_, companyID, userID := seedPrereqs(ctx, t, pool)

	_, err := pool.Exec(ctx,
		`INSERT INTO company_members (id, user_id, company_id, role)
		 VALUES ($1, $2, $3, $4)`,
		uuid.New(), userID, companyID, "admin",
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM company_members WHERE user_id = $1`, userID)
		t.Fatal("expected CHECK violation for role='admin', got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected *pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q (full: %v)", pgErr.Code, err)
	}
}

// TestMigration00009RejectsDuplicateUserID proves the spec scenario
// "second membership for same user is rejected": inserting a second row
// with the same `user_id` returns SQLSTATE 23505 (unique_violation).
//
// To exercise the UNIQUE constraint specifically (and not, e.g., the role
// CHECK), the second insert uses a valid role but a DIFFERENT company_id —
// the only thing that can collide is the UNIQUE(user_id) constraint.
func TestMigration00009RejectsDuplicateUserID(t *testing.T) {
	db, pool := version9Database(t)
	gooseUpTo(t, db, 9)

	ctx := context.Background()
	requireUsersAndCompaniesTables(ctx, t, pool)
	industryID, companyID, userID := seedPrereqs(ctx, t, pool)

	// Cleanup the rows this test inserts so subsequent runs are idempotent.
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM company_members WHERE user_id = $1`, userID)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM companies WHERE id IN ($1, $2)`, companyID,
			uuid.MustParse("018f0000-0000-7000-8000-00000000009b"))
	})

	// First insert (valid role) MUST succeed — otherwise the negative
	// assertion below could pass on the wrong reason (relation missing).
	if _, err := pool.Exec(ctx,
		`INSERT INTO company_members (id, user_id, company_id, role)
		 VALUES ($1, $2, $3, 'recruiter')`,
		uuid.New(), userID, companyID,
	); err != nil {
		t.Fatalf("first insert should succeed: %v", err)
	}

	// A second company the duplicate insert will target.
	otherCompanyID := uuid.MustParse("018f0000-0000-7000-8000-00000000009b")
	if _, err := pool.Exec(ctx,
		`INSERT INTO companies (id, name, rfc, industry_id, status)
		 VALUES ($1, $2, $3, $4, 'active')
		 ON CONFLICT (id) DO NOTHING`,
		otherCompanyID, "Members Test Co 2", "MEMB090101BBB", industryID,
	); err != nil {
		t.Fatalf("seed other company: %v", err)
	}

	// Second insert: same user_id, DIFFERENT company_id, valid role.
	// Only the UNIQUE(user_id) constraint can reject this.
	_, err := pool.Exec(ctx,
		`INSERT INTO company_members (id, user_id, company_id, role)
		 VALUES ($1, $2, $3, 'recruiter')`,
		uuid.New(), userID, otherCompanyID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM company_members WHERE user_id = $1`, userID)
		t.Fatal("expected UNIQUE violation for duplicate user_id, got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected *pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23505" {
		t.Errorf("expected SQLSTATE 23505 (unique_violation), got %q (full: %v)", pgErr.Code, err)
	}
}
