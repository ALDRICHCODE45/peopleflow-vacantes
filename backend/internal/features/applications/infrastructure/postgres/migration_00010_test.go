//go:build integration

// Package postgres exercises migration 00010 (applications schema) and
// the SQL guard surfaces against a real PostgreSQL instance. It runs
// only when the integration build tag is set AND a DATABASE_URL is
// provided, so CI on machines without a DB stays fast.
//
// These tests assume `make db-migrate` has already applied 00010 (and
// the preceding migrations 00001..00009). Tests that validate the
// down migration DROP the table manually and recreate it with an
// inline DDL constant so the schema is left in a usable state for
// later tests.
//
// The 8 tests below mirror the design §7 inventory (items 6–13) and
// the spec scenario set (S1–S10). They are the DEFERRED RED for the
// migration 00010 DDL authored in Commit B (jobs-soft-delete 3.1
// precedent) — the live Postgres executes them; the CI on machines
// without DATABASE_URL skips them via `t.Skip`.
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

// skipIfNoDatabaseForApplications mirrors the helper used by the jobs /
// candidates / identity integration suites. Kept package-local so each
// suite evolves independently.
func skipIfNoDatabaseForApplications(t *testing.T) *pgxpool.Pool {
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

// TestMigration00010_UpCreatesNamedObjects — spec scenario S1: after
// `goose up`, `applications`, both CHECKs, the UNIQUE, and both indexes
// must exist.
func TestMigration00010_UpCreatesNamedObjects(t *testing.T) {
	pool := skipIfNoDatabaseForApplications(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// table exists
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'applications')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query applications table: %v", err)
	}
	if !hasTable {
		t.Fatal("expected table `applications` to exist after 00010 up")
	}

	// named CHECK constraints exist
	for _, ck := range []string{
		"applications_status_check",
		"applications_source_check",
	} {
		var hasCheck bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (
				SELECT 1 FROM information_schema.table_constraints
				WHERE table_name = 'applications' AND constraint_name = $1
			)`, ck,
		).Scan(&hasCheck); err != nil {
			t.Fatalf("query check constraint %s: %v", ck, err)
		}
		if !hasCheck {
			t.Errorf("expected check constraint %q to exist", ck)
		}
	}

	// UNIQUE constraint exists
	var hasUnique bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.table_constraints
			WHERE table_name = 'applications'
			  AND constraint_name = 'applications_job_candidate_unique'
		)`,
	).Scan(&hasUnique); err != nil {
		t.Fatalf("query UNIQUE constraint: %v", err)
	}
	if !hasUnique {
		t.Error("expected UNIQUE constraint applications_job_candidate_unique to exist")
	}

	// both indexes exist
	for _, idx := range []string{
		"applications_by_job_idx",
		"applications_by_candidate_idx",
	} {
		var hasIdx bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (
				SELECT 1 FROM pg_indexes
				WHERE tablename = 'applications' AND indexname = $1
			)`, idx,
		).Scan(&hasIdx); err != nil {
			t.Fatalf("query index %s: %v", idx, err)
		}
		if !hasIdx {
			t.Errorf("expected index %q to exist", idx)
		}
	}
}

// TestMigration00010_DownDropsTableAndIndexes — spec scenario S2.
func TestMigration00010_DownDropsTableAndIndexes(t *testing.T) {
	pool := skipIfNoDatabaseForApplications(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS applications`); err != nil {
		t.Fatalf("drop applications table: %v", err)
	}
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'applications')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query applications table: %v", err)
	}
	if hasTable {
		t.Fatal("expected table `applications` to be gone after DROP")
	}

	// Re-apply the up so the schema is left in a state usable by later tests.
	if _, err := pool.Exec(ctx, createApplicationsTableDDL); err != nil {
		t.Fatalf("re-create applications table: %v", err)
	}
}

// createApplicationsTableDDL mirrors the up migration body so the down
// test can restore the schema after dropping it. Kept in sync by hand.
const createApplicationsTableDDL = `
CREATE TABLE applications (
    id            UUID PRIMARY KEY,
    job_id        UUID NOT NULL REFERENCES jobs (id),
    candidate_id  UUID NOT NULL REFERENCES users (id),
    status        TEXT NOT NULL DEFAULT 'submitted'
        CONSTRAINT applications_status_check
        CHECK (status IN ('submitted', 'in_review', 'rejected', 'hired')),
    source        TEXT
        CONSTRAINT applications_source_check
        CHECK (source IN ('referral', 'linkedin', 'job_board', 'direct', 'other')),
    cover_letter  TEXT,
    cv_s3_key     TEXT,
    anonymized_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT applications_job_candidate_unique UNIQUE (job_id, candidate_id)
);

CREATE INDEX applications_by_job_idx
    ON applications (job_id, status, created_at DESC);
CREATE INDEX applications_by_candidate_idx
    ON applications (candidate_id, created_at DESC);
`

// TestApplications_RequiredFieldsRejectNull — spec scenario S3.
func TestApplications_RequiredFieldsRejectNull(t *testing.T) {
	pool := skipIfNoDatabaseForApplications(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearApplications(ctx, t, pool)

	// Need a real job + user to satisfy the FKs; skip if the seed didn't run.
	jobID, err := pickFirstJobID(ctx, pool)
	if err != nil {
		t.Skipf("no jobs row to satisfy FK: %v", err)
	}
	candidateID, err := pickFirstUserID(ctx, pool)
	if err != nil {
		t.Skipf("no users row to satisfy FK: %v", err)
	}

	cases := []struct {
		name    string
		sql     string
		buildFn func(id uuid.UUID) []any
	}{
		{
			"job_id NULL",
			`INSERT INTO applications (id, job_id, candidate_id) VALUES ($1, NULL, $2)`,
			func(id uuid.UUID) []any { return []any{id, candidateID} },
		},
		{
			"candidate_id NULL",
			`INSERT INTO applications (id, job_id, candidate_id) VALUES ($1, $2, NULL)`,
			func(id uuid.UUID) []any { return []any{id, jobID} },
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id := uuid.New()
			_, err := pool.Exec(ctx, tc.sql, tc.buildFn(id)...)
			if err == nil {
				_, _ = pool.Exec(ctx, `DELETE FROM applications WHERE id = $1`, id)
				t.Fatalf("expected NOT NULL violation, got nil")
			}
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) {
				t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
			}
			if pgErr.Code != "23502" {
				t.Errorf("expected SQLSTATE 23502, got %q", pgErr.Code)
			}
		})
	}
}

// TestApplications_StatusDefaultsSubmitted — spec scenario S4.
func TestApplications_StatusDefaultsSubmitted(t *testing.T) {
	pool := skipIfNoDatabaseForApplications(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearApplications(ctx, t, pool)

	jobID, err := pickFirstJobID(ctx, pool)
	if err != nil {
		t.Skipf("no jobs row: %v", err)
	}
	candidateID, err := pickFirstUserID(ctx, pool)
	if err != nil {
		t.Skipf("no users row: %v", err)
	}

	id := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id) VALUES ($1, $2, $3)`,
		id, jobID, candidateID,
	); err != nil {
		t.Fatalf("insert row: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM applications WHERE id = $1`, id)
	})

	var status string
	var createdAt, updatedAt time.Time
	if err := pool.QueryRow(ctx,
		`SELECT status, created_at, updated_at FROM applications WHERE id = $1`, id,
	).Scan(&status, &createdAt, &updatedAt); err != nil {
		t.Fatalf("read status/timestamps: %v", err)
	}
	if status != "submitted" {
		t.Errorf("status: want %q, got %q", "submitted", status)
	}
	if createdAt.IsZero() {
		t.Error("created_at: want server timestamp, got zero")
	}
	if updatedAt.IsZero() {
		t.Error("updated_at: want server timestamp, got zero")
	}
}

// TestApplications_StatusCheckRejectsUnknown — spec scenario S5.
func TestApplications_StatusCheckRejectsUnknown(t *testing.T) {
	pool := skipIfNoDatabaseForApplications(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearApplications(ctx, t, pool)

	jobID, err := pickFirstJobID(ctx, pool)
	if err != nil {
		t.Skipf("no jobs row: %v", err)
	}
	candidateID, err := pickFirstUserID(ctx, pool)
	if err != nil {
		t.Skipf("no users row: %v", err)
	}

	id := uuid.New()
	_, err = pool.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id, status) VALUES ($1, $2, $3, 'withdrawn')`,
		id, jobID, candidateID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM applications WHERE id = $1`, id)
		t.Fatal("expected CHECK violation, got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514, got %q", pgErr.Code)
	}
}

// TestApplications_SourceCheckRejectsUnknown — spec scenario S6.
func TestApplications_SourceCheckRejectsUnknown(t *testing.T) {
	pool := skipIfNoDatabaseForApplications(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearApplications(ctx, t, pool)

	jobID, err := pickFirstJobID(ctx, pool)
	if err != nil {
		t.Skipf("no jobs row: %v", err)
	}
	candidateID, err := pickFirstUserID(ctx, pool)
	if err != nil {
		t.Skipf("no users row: %v", err)
	}

	id := uuid.New()
	_, err = pool.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id, source) VALUES ($1, $2, $3, 'newspaper')`,
		id, jobID, candidateID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM applications WHERE id = $1`, id)
		t.Fatal("expected CHECK violation, got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514, got %q", pgErr.Code)
	}
}

// TestApplications_UniqueJobCandidate — spec scenario S7.
func TestApplications_UniqueJobCandidate(t *testing.T) {
	pool := skipIfNoDatabaseForApplications(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearApplications(ctx, t, pool)

	jobID, err := pickFirstJobID(ctx, pool)
	if err != nil {
		t.Skipf("no jobs row: %v", err)
	}
	candidateID, err := pickFirstUserID(ctx, pool)
	if err != nil {
		t.Skipf("no users row: %v", err)
	}

	id1 := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id) VALUES ($1, $2, $3)`,
		id1, jobID, candidateID,
	); err != nil {
		t.Fatalf("insert first row: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM applications WHERE id = $1`, id1)
	})

	id2 := uuid.New()
	_, err = pool.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id) VALUES ($1, $2, $3)`,
		id2, jobID, candidateID,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM applications WHERE id = $1`, id2)
		t.Fatal("expected UNIQUE violation, got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23505" {
		t.Errorf("expected SQLSTATE 23505, got %q", pgErr.Code)
	}
}

// TestApplications_CvS3KeyAnonymizedAtNullable — spec scenarios S8, S9.
func TestApplications_CvS3KeyAnonymizedAtNullable(t *testing.T) {
	pool := skipIfNoDatabaseForApplications(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearApplications(ctx, t, pool)

	jobID, err := pickFirstJobID(ctx, pool)
	if err != nil {
		t.Skipf("no jobs row: %v", err)
	}
	candidateID, err := pickFirstUserID(ctx, pool)
	if err != nil {
		t.Skipf("no users row: %v", err)
	}

	id := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id) VALUES ($1, $2, $3)`,
		id, jobID, candidateID,
	); err != nil {
		t.Fatalf("insert row: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM applications WHERE id = $1`, id)
	})

	var cvS3Key *string
	var anonymizedAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT cv_s3_key, anonymized_at FROM applications WHERE id = $1`, id,
	).Scan(&cvS3Key, &anonymizedAt); err != nil {
		t.Fatalf("read reserved columns: %v", err)
	}
	if cvS3Key != nil {
		t.Errorf("cv_s3_key: want NULL (no write path in this slice), got %q", *cvS3Key)
	}
	if anonymizedAt != nil {
		t.Errorf("anonymized_at: want NULL (no write path in this slice), got %v", *anonymizedAt)
	}
}

// --- helpers -------------------------------------------------------------

// pickFirstJobID returns the first job id (any status) so the FK
// constraint can be satisfied. If no jobs row exists, returns an error
// so the test can t.Skip — this avoids flake when the test suite runs
// without the seed.
// clearApplications empties the applications table so the UNIQUE(job_id,
// candidate_id) guard in these schema tests never collides with a row left
// behind by a previous run or sibling test. The schema tests use the first
// job/user row (pickFirst*) and therefore share the same FK pair; a stale
// row would surface as an unrelated SQLSTATE 23505. Safe: applications has
// no FK dependents in this slice, and these tests only prove constraints.
func clearApplications(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(ctx, `DELETE FROM applications`); err != nil {
		t.Fatalf("clear applications: %v", err)
	}
}

func pickFirstJobID(ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM jobs LIMIT 1`).Scan(&id)
	return id, err
}

// pickFirstUserID returns the first users id (any) so the FK constraint
// can be satisfied.
func pickFirstUserID(ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM users LIMIT 1`).Scan(&id)
	return id, err
}
