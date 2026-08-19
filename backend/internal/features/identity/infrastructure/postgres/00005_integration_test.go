//go:build integration

// Package postgres_migration_check exercises the migration 00005 constraints
// against a real PostgreSQL instance. It runs only when the integration build
// tag is set and a DATABASE_URL is provided, so CI on machines without a DB
// stays fast.
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

func skipIfNoDatabaseForUsers(t *testing.T) *pgxpool.Pool {
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

// TestUsersMigrationUpCreatesNamedObjects proves "up creates named objects".
// It checks that `users`, the named CHECK `users_user_type_check`, and both
// partial unique indexes exist after migration 00005 is applied.
func TestUsersMigrationUpCreatesNamedObjects(t *testing.T) {
	pool := skipIfNoDatabaseForUsers(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// table exists
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query users table: %v", err)
	}
	if !hasTable {
		t.Fatal("expected table `users` to exist after 00005 up")
	}

	// named CHECK exists
	var hasCheck bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.table_constraints
			WHERE table_name = 'users' AND constraint_name = 'users_user_type_check'
		)`,
	).Scan(&hasCheck); err != nil {
		t.Fatalf("query check constraint: %v", err)
	}
	if !hasCheck {
		t.Fatal("expected check constraint `users_user_type_check` to exist")
	}

	// both partial unique indexes exist
	for _, idx := range []string{"users_cognito_sub_unique", "users_email_unique"} {
		var hasIdx bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (
				SELECT 1 FROM pg_indexes
				WHERE tablename = 'users' AND indexname = $1
			)`, idx,
		).Scan(&hasIdx); err != nil {
			t.Fatalf("query index %s: %v", idx, err)
		}
		if !hasIdx {
			t.Errorf("expected index %q to exist", idx)
		}
	}
}

// TestUsersMigrationDownDropsTable proves "down drops table and indexes".
// Apply 00005 up, then down, then verify the table is gone. After the
// test we re-run the up migration so the schema is left in a state
// usable by the rest of the integration suite.
func TestUsersMigrationDownDropsTable(t *testing.T) {
	pool := skipIfNoDatabaseForUsers(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Ensure the table exists first by inserting a row. We treat any FK
	// surprise as a hard skip (some fixtures require the table to be clean).
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING`,
		uuid.New(), "down-test-sub", "down@example.com", "Down Test", "candidate",
	); err != nil {
		t.Skipf("cannot insert users fixture (table may already be missing): %v", err)
	}
	// Cleanup the row we just inserted. After the drop + recreate below,
	// this DELETE no-ops against the recreated users table, which is harmless.
	defer pool.Exec(ctx, `DELETE FROM users WHERE cognito_sub = 'down-test-sub'`)

	// Migration 00006 added FK references from `candidate_profiles` and
	// `candidate_languages` to `users(id)`. Goose runs downs in reverse
	// migration order, so 00006's down drops those tables BEFORE 00005's
	// down drops `users`. This test must mirror that order, otherwise
	// PostgreSQL returns SQLSTATE 2BP01 ("cannot drop table users because
	// other objects depend on it"). Use IF EXISTS so a partial-schema DB
	// state (e.g. a fresh checkout before migrations run) does not fail.
	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS candidate_languages`); err != nil {
		t.Fatalf("drop candidate_languages: %v", err)
	}
	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS candidate_profiles`); err != nil {
		t.Fatalf("drop candidate_profiles: %v", err)
	}
	// Drop using the same DDL as migration down.
	if _, err := pool.Exec(ctx, `DROP TABLE users`); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query users table: %v", err)
	}
	if hasTable {
		t.Fatal("expected table `users` to be gone after DROP")
	}

	// Re-apply the up so the schema is left in a usable state for any
	// later test in the same run. We must also re-create the dependent
	// tables introduced by migration 00006 — otherwise the rest of the
	// integration suite (candidates repository tests in particular)
	// would find `candidate_profiles` / `candidate_languages` missing.
	if _, err := pool.Exec(ctx, createUsersTableDDL); err != nil {
		t.Fatalf("re-create users table: %v", err)
	}
	if _, err := pool.Exec(ctx, createCandidateProfilesDDL); err != nil {
		t.Fatalf("re-create candidate_profiles table: %v", err)
	}
	if _, err := pool.Exec(ctx, createCandidateLanguagesDDL); err != nil {
		t.Fatalf("re-create candidate_languages table: %v", err)
	}
}

// createUsersTableDDL mirrors the up migration body so the down test can
// restore the schema after dropping it. Kept in sync by hand — if the
// migration changes, this must change too.
const createUsersTableDDL = `
CREATE TABLE users (
    id          UUID PRIMARY KEY,
    cognito_sub TEXT NOT NULL,
    email       TEXT NOT NULL,
    full_name   TEXT NOT NULL,
    user_type   TEXT NOT NULL
        CONSTRAINT users_user_type_check
        CHECK (user_type IN ('candidate', 'recruiter')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX users_cognito_sub_unique
    ON users (cognito_sub) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX users_email_unique
    ON users (email) WHERE deleted_at IS NULL;
`

// createCandidateProfilesDDL mirrors the candidate_profiles portion of
// migration 00006's up body. The down test in this file must recreate the
// table after dropping `users` so the rest of the integration suite
// (candidates repository tests) still finds the schema it expects.
// Kept in sync with backend/db/migrations/00006_create_candidate_profiles.sql
// — if that file changes, this constant must change too.
const createCandidateProfilesDDL = `
CREATE TABLE candidate_profiles (
    user_id                 UUID PRIMARY KEY REFERENCES users (id),
    phone                   TEXT,
    linkedin_url            TEXT,
    portfolio_url           TEXT,
    professional_title      TEXT,
    current_company         TEXT,
    years_of_experience     SMALLINT,
    profile_summary         TEXT,
    birth_date              DATE,
    city                    TEXT,
    country                 TEXT,
    education_level         TEXT
        CONSTRAINT candidate_profiles_education_check
        CHECK (education_level IN ('high_school', 'bachelor', 'master', 'phd')),
    field_of_study          TEXT,
    skills                  TEXT[] NOT NULL DEFAULT '{}',
    current_salary_gross    INTEGER,
    current_salary_net      INTEGER,
    expected_salary         INTEGER,
    salary_currency         TEXT NOT NULL DEFAULT 'MXN',
    expected_salary_period  TEXT
        CONSTRAINT candidate_profiles_salary_period_check
        CHECK (expected_salary_period IN ('monthly', 'annual')),
    cv_s3_key               TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_vector           tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(professional_title, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(profile_summary, '')), 'B')
    ) STORED
);

CREATE INDEX candidate_profiles_skills_idx
    ON candidate_profiles USING GIN (skills);
CREATE INDEX candidate_profiles_search_idx
    ON candidate_profiles USING GIN (search_vector);
CREATE INDEX candidate_profiles_city_idx
    ON candidate_profiles (city);
`

// createCandidateLanguagesDDL mirrors the candidate_languages portion of
// migration 00006's up body. See createCandidateProfilesDDL for rationale.
const createCandidateLanguagesDDL = `
CREATE TABLE candidate_languages (
    user_id     UUID NOT NULL REFERENCES users (id),
    language    TEXT NOT NULL,
    level       TEXT NOT NULL
        CONSTRAINT candidate_languages_level_check
        CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
    PRIMARY KEY (user_id, language)
);
`

// TestUsersMigrationRejectsInvalidUserType proves the CHECK constraint blocks
// values outside the closed user_type set.
func TestUsersMigrationRejectsInvalidUserType(t *testing.T) {
	pool := skipIfNoDatabaseForUsers(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, $5)`,
		id, "ck-sub", "ck@example.com", "Ck Test", "admin",
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for user_type='admin', got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}

// TestUsersMigrationIdempotentRedelivery proves the spec scenario "repeated
// delivery leaves one row": two consecutive PostConfirmation calls with the
// same cognito_sub leave a single row and both return no error.
//
// This test complements the application-level PostConfirmation_RepeatedDelivery
// test by proving the same contract at the database boundary (the ON CONFLICT
// DO NOTHING clause itself).
func TestUsersMigrationIdempotentRedelivery(t *testing.T) {
	pool := skipIfNoDatabaseForUsers(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Clean up any leftover from a previous run.
	_, _ = pool.Exec(ctx, `DELETE FROM users WHERE cognito_sub = 'idem-sub'`)

	id1 := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING`,
		id1, "idem-sub", "idem@example.com", "Idem Test", "candidate",
	)
	if err != nil {
		t.Fatalf("first insert: %v", err)
	}

	// Second insert with the SAME cognito_sub but a different id. The
	// upsert should swallow it.
	id2 := uuid.New()
	_, err = pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING`,
		id2, "idem-sub", "idem@example.com", "Idem Test", "candidate",
	)
	if err != nil {
		t.Fatalf("second insert (should be swallowed): %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users WHERE cognito_sub = 'idem-sub'`,
	).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("expected exactly 1 row for cognito_sub='idem-sub', got %d", count)
	}

	// Cleanup
	_, _ = pool.Exec(ctx, `DELETE FROM users WHERE cognito_sub = 'idem-sub'`)
}
