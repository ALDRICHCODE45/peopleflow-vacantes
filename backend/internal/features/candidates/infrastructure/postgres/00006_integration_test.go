//go:build integration

// Package postgres_migration_check exercises the migration 00006 schema
// invariants against a real PostgreSQL instance. It runs only when the
// integration build tag is set and a DATABASE_URL is provided, so CI on
// machines without a DB stays fast.
//
// Scope: a thin characterization/guard layer for the spec scenario REQ-05
// "new profile has no status column". The migration SQL is the system of
// record, but the application layer can only rely on that invariant if a
// runtime test asserts it. This file is that assertion.
package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// skipIfNoDatabaseForCandidates mirrors the helper used by the identity
// integration test. Kept package-local so the two suites can evolve
// independently.
func skipIfNoDatabaseForCandidates(t *testing.T) *pgxpool.Pool {
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

// TestCandidateProfilesHasNoStatusColumn closes the spec scenario
// REQ-05 "new profile has no status column". The slice explicitly SHALL NOT
// add `status`, `suspended`, or `hidden` on `candidate_profiles`; this
// test queries information_schema to prove the schema honors that
// invariant at runtime, not only in source.
//
// If a future migration reintroduces any of these columns (e.g. for
// moderation workflows), this test fails and surfaces the regression
// during CI rather than after deploy.
func TestCandidateProfilesHasNoStatusColumn(t *testing.T) {
	pool := skipIfNoDatabaseForCandidates(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Precondition: candidate_profiles must exist (migration 00006 up applied).
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_name = 'candidate_profiles')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query candidate_profiles table existence: %v", err)
	}
	if !hasTable {
		t.Fatal("expected table `candidate_profiles` to exist after migration 00006 up")
	}

	// Collect the column names actually present on candidate_profiles.
	rows, err := pool.Query(ctx,
		`SELECT column_name FROM information_schema.columns
		 WHERE table_name = 'candidate_profiles'
		 ORDER BY column_name`,
	)
	if err != nil {
		t.Fatalf("query information_schema.columns: %v", err)
	}
	defer rows.Close()

	got := make(map[string]struct{})
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan column_name: %v", err)
		}
		got[name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate columns: %v", err)
	}

	// Spec scenario REQ-05: none of these may exist on candidate_profiles.
	forbidden := []string{"status", "suspended", "hidden"}
	for _, name := range forbidden {
		if _, present := got[name]; present {
			t.Errorf("candidate_profiles MUST NOT have a %q column (REQ-05); columns present: %v",
				name, sortedKeys(got))
		}
	}
}

// sortedKeys returns the keys of m in lexicographic order. It exists only
// to keep the test failure messages deterministic; it is not a general
// utility.
func sortedKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	// Insertion sort — the slice is tiny (≈25 entries).
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1] > out[j]; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}
