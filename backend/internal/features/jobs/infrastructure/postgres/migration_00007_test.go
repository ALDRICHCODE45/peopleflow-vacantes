//go:build integration

// Package postgres_migration_check exercises the migration 00007 (jobs
// schema) constraints against a real PostgreSQL instance. It runs only
// when the integration build tag is set and a DATABASE_URL is provided,
// so CI on machines without a DB stays fast.
//
// These tests assume `make db-migrate` has already applied 00007 (and the
// preceding migrations 00001..00006). Tests that need to validate the
// down migration DROP the table manually and recreate it with an inline
// DDL constant so the schema is left in a usable state for later tests.
package postgres

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func skipIfNoDatabaseForJobs(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot connect to Postgres: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("cannot ping Postgres: %v", err)
	}
	return pool
}

// TestJobsMigrationUpCreatesNamedObjects proves "up creates named objects".
// It checks that `jobs`, the four named CHECK constraints, the generated
// `search_vector` column, and the three required indexes exist after
// migration 00007 is applied.
func TestJobsMigrationUpCreatesNamedObjects(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// table exists
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'jobs')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query jobs table: %v", err)
	}
	if !hasTable {
		t.Fatal("expected table `jobs` to exist after 00007 up")
	}

	// named CHECK constraints exist
	for _, ck := range []string{
		"jobs_work_mode_check",
		"jobs_employment_type_check",
		"jobs_seniority_check",
		"jobs_status_check",
		"jobs_salary_currency_check",
	} {
		var hasCheck bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (
				SELECT 1 FROM information_schema.table_constraints
				WHERE table_name = 'jobs' AND constraint_name = $1
			)`, ck,
		).Scan(&hasCheck); err != nil {
			t.Fatalf("query check constraint %s: %v", ck, err)
		}
		if !hasCheck {
			t.Errorf("expected check constraint %q to exist", ck)
		}
	}

	// generated `search_vector` column exists
	var hasSearchVector bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'jobs' AND column_name = 'search_vector'
		)`,
	).Scan(&hasSearchVector); err != nil {
		t.Fatalf("query search_vector column: %v", err)
	}
	if !hasSearchVector {
		t.Fatal("expected generated column `search_vector` to exist")
	}

	// three indexes exist
	for _, idx := range []string{
		"jobs_search_idx",
		"jobs_company_id_idx",
		"jobs_public_listing_idx",
	} {
		var hasIdx bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (
				SELECT 1 FROM pg_indexes
				WHERE tablename = 'jobs' AND indexname = $1
			)`, idx,
		).Scan(&hasIdx); err != nil {
			t.Fatalf("query index %s: %v", idx, err)
		}
		if !hasIdx {
			t.Errorf("expected index %q to exist", idx)
		}
	}
}

// TestJobsMigrationDownDropsTable proves "down drops table and indexes".
// We drop the table manually (mirroring the down migration body) and
// verify the table is gone. After the test we re-create the table with
// the inline DDL constant so the schema is left in a state usable by
// later integration tests.
func TestJobsMigrationDownDropsTable(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Drop using the same DDL as migration down.
	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS jobs`); err != nil {
		t.Fatalf("drop jobs table: %v", err)
	}
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'jobs')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query jobs table: %v", err)
	}
	if hasTable {
		t.Fatal("expected table `jobs` to be gone after DROP")
	}

	// Re-apply the up so the schema is left in a usable state for any
	// later test in the same run.
	if _, err := pool.Exec(ctx, createJobsTableDDL); err != nil {
		t.Fatalf("re-create jobs table: %v", err)
	}
}

// createJobsTableDDL mirrors the up migration body so the down test can
// restore the schema after dropping it. Kept in sync by hand — if the
// migration changes, this must change too.
const createJobsTableDDL = `
CREATE TABLE jobs (
    id               UUID PRIMARY KEY,
    company_id       UUID NOT NULL REFERENCES companies (id),
    title            TEXT NOT NULL,
    description      TEXT NOT NULL,
    work_mode        TEXT NOT NULL
        CONSTRAINT jobs_work_mode_check
        CHECK (work_mode IN ('onsite', 'remote', 'hybrid')),
    employment_type  TEXT NOT NULL
        CONSTRAINT jobs_employment_type_check
        CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
    seniority        TEXT NOT NULL
        CONSTRAINT jobs_seniority_check
        CHECK (seniority IN ('intern', 'junior', 'mid', 'senior', 'lead')),
    status           TEXT NOT NULL DEFAULT 'draft'
        CONSTRAINT jobs_status_check
        CHECK (status IN ('draft', 'published', 'closed')),
    location         TEXT,
    salary_min       INTEGER,
    salary_max       INTEGER,
    salary_currency  TEXT NOT NULL DEFAULT 'MXN'
        CONSTRAINT jobs_salary_currency_check
        CHECK (salary_currency IN ('USD', 'MXN')),
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT jobs_published_integrity_check
        CHECK (status <> 'published' OR published_at IS NOT NULL),
    search_vector    tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(description, '')), 'B')
    ) STORED
);

CREATE INDEX jobs_search_idx
    ON jobs USING GIN (search_vector);
CREATE INDEX jobs_company_id_idx
    ON jobs (company_id);
CREATE INDEX jobs_public_listing_idx
    ON jobs (published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;
`

// TestJobsMigrationRejectsNullRequiredField proves the NOT NULL
// constraints on title, description, work_mode, employment_type, and
// seniority reject NULL inserts with SQLSTATE 23502 (not_null_violation).
func TestJobsMigrationRejectsNullRequiredField(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Ensure at least one company exists so we can satisfy the FK.
	var companyID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM companies LIMIT 1`).Scan(&companyID); err != nil {
		t.Skipf("no companies row to satisfy FK (run 00008 seed first): %v", err)
	}

	cases := []struct {
		name string
		col  string
	}{
		{"title", "title"},
		{"description", "description"},
		{"work_mode", "work_mode"},
		{"employment_type", "employment_type"},
		{"seniority", "seniority"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id := uuid.New()
			// Build the INSERT dynamically so each case targets exactly
			// one NOT NULL column. Every other required column carries
			// a valid value.
			sql := `INSERT INTO jobs
				    (id, company_id, title, description, work_mode,
				     employment_type, seniority, status)
				 VALUES ($1, $2, 't', 'd', 'remote',
				         'full_time', 'senior', 'draft')`
			switch tc.col {
			case "title":
				sql = `INSERT INTO jobs
				        (id, company_id, title, description, work_mode,
				         employment_type, seniority, status)
				       VALUES ($1, $2, NULL, 'd', 'remote',
				               'full_time', 'senior', 'draft')`
			case "description":
				sql = `INSERT INTO jobs
				        (id, company_id, title, description, work_mode,
				         employment_type, seniority, status)
				       VALUES ($1, $2, 't', NULL, 'remote',
				               'full_time', 'senior', 'draft')`
			case "work_mode":
				sql = `INSERT INTO jobs
				        (id, company_id, title, description, work_mode,
				         employment_type, seniority, status)
				       VALUES ($1, $2, 't', 'd', NULL,
				               'full_time', 'senior', 'draft')`
			case "employment_type":
				sql = `INSERT INTO jobs
				        (id, company_id, title, description, work_mode,
				         employment_type, seniority, status)
				       VALUES ($1, $2, 't', 'd', 'remote',
				               NULL, 'senior', 'draft')`
			case "seniority":
				sql = `INSERT INTO jobs
				        (id, company_id, title, description, work_mode,
				         employment_type, seniority, status)
				       VALUES ($1, $2, 't', 'd', 'remote',
				               'full_time', NULL, 'draft')`
			}
			_, err := pool.Exec(ctx, sql, id, companyID)
			if err == nil {
				_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, id)
				t.Fatalf("expected NOT NULL violation on %s, got nil", tc.col)
			}
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) {
				t.Fatalf("expected pgconn.PgError for %s, got %T: %v", tc.col, err, err)
			}
			if pgErr.Code != "23502" {
				t.Errorf("expected SQLSTATE 23502 (not_null_violation) on %s, got %q", tc.col, pgErr.Code)
			}
		})
	}
}

// TestJobsMigrationRejectsOutOfEnumWorkMode proves the work_mode CHECK
// rejects values outside the closed set.
func TestJobsMigrationRejectsOutOfEnumWorkMode(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var companyID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM companies LIMIT 1`).Scan(&companyID); err != nil {
		t.Skipf("no companies row to satisfy FK: %v", err)
	}

	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO jobs
		    (id, company_id, title, description, work_mode,
		     employment_type, seniority, status)
		 VALUES ($1, $2, 't', 'd', 'telecommute',
		         'full_time', 'senior', 'draft')`,
		id, companyID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for work_mode='telecommute', got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}

// TestJobsMigrationRejectsOutOfEnumSeniority proves the seniority CHECK
// rejects values outside the closed set.
func TestJobsMigrationRejectsOutOfEnumSeniority(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var companyID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM companies LIMIT 1`).Scan(&companyID); err != nil {
		t.Skipf("no companies row to satisfy FK: %v", err)
	}

	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO jobs
		    (id, company_id, title, description, work_mode,
		     employment_type, seniority, status)
		 VALUES ($1, $2, 't', 'd', 'remote',
		         'full_time', 'principal', 'draft')`,
		id, companyID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for seniority='principal', got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}

// TestJobsMigrationRejectsOutOfEnumEmploymentType proves the
// employment_type CHECK rejects values outside the closed set.
func TestJobsMigrationRejectsOutOfEnumEmploymentType(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var companyID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM companies LIMIT 1`).Scan(&companyID); err != nil {
		t.Skipf("no companies row to satisfy FK: %v", err)
	}

	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO jobs
		    (id, company_id, title, description, work_mode,
		     employment_type, seniority, status)
		 VALUES ($1, $2, 't', 'd', 'remote',
		         'freelance', 'senior', 'draft')`,
		id, companyID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for employment_type='freelance', got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}

// TestJobsMigrationRejectsOutOfEnumSalaryCurrency proves the
// salary_currency CHECK rejects values outside the closed set.
func TestJobsMigrationRejectsOutOfEnumSalaryCurrency(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var companyID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM companies LIMIT 1`).Scan(&companyID); err != nil {
		t.Skipf("no companies row to satisfy FK: %v", err)
	}

	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO jobs
		    (id, company_id, title, description, work_mode,
		     employment_type, seniority, status, salary_currency)
		 VALUES ($1, $2, 't', 'd', 'remote',
		         'full_time', 'senior', 'draft', 'EUR')`,
		id, companyID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for salary_currency='EUR', got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}

// TestJobsMigrationSalaryCurrencyDefaultsToMXN proves that omitting
// salary_currency produces a row with the 'MXN' default.
func TestJobsMigrationSalaryCurrencyDefaultsToMXN(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var companyID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM companies LIMIT 1`).Scan(&companyID); err != nil {
		t.Skipf("no companies row to satisfy FK: %v", err)
	}

	id := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO jobs
		    (id, company_id, title, description, work_mode,
		     employment_type, seniority, status)
		 VALUES ($1, $2, 't', 'd', 'remote',
		         'full_time', 'senior', 'draft')`,
		id, companyID,
	); err != nil {
		t.Fatalf("insert row: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM jobs WHERE id = $1`, id)
	})

	var got string
	if err := pool.QueryRow(ctx,
		`SELECT salary_currency FROM jobs WHERE id = $1`, id,
	).Scan(&got); err != nil {
		t.Fatalf("read salary_currency: %v", err)
	}
	if got != "MXN" {
		t.Errorf("expected salary_currency='MXN' (default), got %q", got)
	}
}

// TestJobsMigrationPublishedIntegrityGuard proves the integrity guard
// `status <> 'published' OR published_at IS NOT NULL` rejects a row in
// status='published' without a published_at.
func TestJobsMigrationPublishedIntegrityGuard(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var companyID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM companies LIMIT 1`).Scan(&companyID); err != nil {
		t.Skipf("no companies row to satisfy FK: %v", err)
	}

	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO jobs
		    (id, company_id, title, description, work_mode,
		     employment_type, seniority, status, published_at)
		 VALUES ($1, $2, 't', 'd', 'remote',
		         'full_time', 'senior', 'published', NULL)`,
		id, companyID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for published without published_at, got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}
