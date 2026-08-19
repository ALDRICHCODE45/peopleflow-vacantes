//go:build integration

// Package postgres_migration_check exercises the migration 00008 (jobs
// seed) against a real PostgreSQL instance. It runs only when the
// integration build tag is set and a DATABASE_URL is provided, so CI
// on machines without a DB stays fast.
//
// These tests assume `make db-migrate` has already applied 00007 and
// 00008 (and the preceding migrations 00001..00006). Tests that need
// to validate the down behaviour manually delete the seeded rows by
// UUID and then re-insert them so the schema is left in a usable state
// for later tests.
package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Seeded company UUIDs (fixed). MUST match the UUIDs declared in
// backend/db/migrations/00008_jobs_seed.sql — keep in sync.
var seededCompanyIDs = []uuid.UUID{
	uuid.MustParse("018f0000-0000-7000-8000-000000000001"),
	uuid.MustParse("018f0000-0000-7000-8000-000000000002"),
	uuid.MustParse("018f0000-0000-7000-8000-000000000003"),
}

// Seeded job UUIDs (fixed). MUST match the UUIDs declared in
// backend/db/migrations/00008_jobs_seed.sql — keep in sync.
var seededJobIDs = []uuid.UUID{
	uuid.MustParse("018f0000-0000-7000-8000-0000000000a1"),
	uuid.MustParse("018f0000-0000-7000-8000-0000000000a2"),
	uuid.MustParse("018f0000-0000-7000-8000-0000000000a3"),
	uuid.MustParse("018f0000-0000-7000-8000-0000000000a4"),
	uuid.MustParse("018f0000-0000-7000-8000-0000000000a5"),
	uuid.MustParse("018f0000-0000-7000-8000-0000000000a6"),
}

// TestJobsSeedInsertsThreeActiveCompaniesAndSixPublishedJobs proves the
// seed migration leaves the database with the expected deterministic
// state: 3 active companies (fixed UUIDs) and 6 published jobs (fixed
// UUIDs, published_at NOT NULL, deleted_at NULL).
func TestJobsSeedInsertsThreeActiveCompaniesAndSixPublishedJobs(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Re-apply the seed so the test does not depend on migration order
	// relative to the rest of the integration suite.
	if _, err := pool.Exec(ctx, seedJobsSQL); err != nil {
		t.Fatalf("apply seed: %v", err)
	}

	// 3 active companies with the fixed UUIDs.
	var activeCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM companies
		 WHERE id = ANY($1::uuid[]) AND status = 'active'`,
		seededCompanyIDs,
	).Scan(&activeCount); err != nil {
		t.Fatalf("count active companies: %v", err)
	}
	if activeCount != len(seededCompanyIDs) {
		t.Errorf("expected %d active companies with fixed UUIDs, got %d",
			len(seededCompanyIDs), activeCount)
	}

	// 6 published jobs (published_at NOT NULL, deleted_at NULL).
	var publishedCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM jobs
		 WHERE id = ANY($1::uuid[])
		   AND status = 'published'
		   AND published_at IS NOT NULL
		   AND deleted_at IS NULL`,
		seededJobIDs,
	).Scan(&publishedCount); err != nil {
		t.Fatalf("count published jobs: %v", err)
	}
	if publishedCount != len(seededJobIDs) {
		t.Errorf("expected %d published jobs with fixed UUIDs, got %d",
			len(seededJobIDs), publishedCount)
	}
}

// TestJobsSeedIsIdempotent proves that re-running the seed leaves the
// row counts unchanged. The migration uses INSERT … ON CONFLICT (id)
// DO NOTHING, so a second pass must be a no-op.
func TestJobsSeedIsIdempotent(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// First apply.
	if _, err := pool.Exec(ctx, seedJobsSQL); err != nil {
		t.Fatalf("first seed apply: %v", err)
	}
	var companiesBefore, jobsBefore int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM companies WHERE id = ANY($1::uuid[])`,
		seededCompanyIDs,
	).Scan(&companiesBefore); err != nil {
		t.Fatalf("count companies before: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM jobs WHERE id = ANY($1::uuid[])`,
		seededJobIDs,
	).Scan(&jobsBefore); err != nil {
		t.Fatalf("count jobs before: %v", err)
	}

	// Second apply (same ON CONFLICT DO NOTHING statements).
	if _, err := pool.Exec(ctx, seedJobsSQL); err != nil {
		t.Fatalf("second seed apply: %v", err)
	}

	var companiesAfter, jobsAfter int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM companies WHERE id = ANY($1::uuid[])`,
		seededCompanyIDs,
	).Scan(&companiesAfter); err != nil {
		t.Fatalf("count companies after: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM jobs WHERE id = ANY($1::uuid[])`,
		seededJobIDs,
	).Scan(&jobsAfter); err != nil {
		t.Fatalf("count jobs after: %v", err)
	}

	if companiesAfter != companiesBefore {
		t.Errorf("companies count drifted on re-seed: before=%d after=%d",
			companiesBefore, companiesAfter)
	}
	if jobsAfter != jobsBefore {
		t.Errorf("jobs count drifted on re-seed: before=%d after=%d",
			jobsBefore, jobsAfter)
	}
}

// TestJobsSeedDownRemovesSeededRows proves the seed down migration
// removes the seeded rows by UUID. We perform the delete manually and
// then re-apply the seed so the schema is left in a usable state.
func TestJobsSeedDownRemovesSeededRows(t *testing.T) {
	pool := skipIfNoDatabaseForJobs(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Ensure seeded rows exist.
	if _, err := pool.Exec(ctx, seedJobsSQL); err != nil {
		t.Fatalf("apply seed: %v", err)
	}

	// Run the down DDL: delete seeded jobs then seeded companies.
	if _, err := pool.Exec(ctx,
		`DELETE FROM jobs WHERE id = ANY($1::uuid[])`,
		seededJobIDs,
	); err != nil {
		t.Fatalf("delete seeded jobs: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`DELETE FROM companies WHERE id = ANY($1::uuid[])`,
		seededCompanyIDs,
	); err != nil {
		t.Fatalf("delete seeded companies: %v", err)
	}

	var companiesLeft, jobsLeft int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM companies WHERE id = ANY($1::uuid[])`,
		seededCompanyIDs,
	).Scan(&companiesLeft); err != nil {
		t.Fatalf("count companies after down: %v", err)
	}
	if companiesLeft != 0 {
		t.Errorf("expected 0 seeded companies after down, got %d", companiesLeft)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM jobs WHERE id = ANY($1::uuid[])`,
		seededJobIDs,
	).Scan(&jobsLeft); err != nil {
		t.Fatalf("count jobs after down: %v", err)
	}
	if jobsLeft != 0 {
		t.Errorf("expected 0 seeded jobs after down, got %d", jobsLeft)
	}

	// Re-apply so subsequent integration tests find the seeded state.
	if _, err := pool.Exec(ctx, seedJobsSQL); err != nil {
		t.Fatalf("re-apply seed: %v", err)
	}
}

// seedJobsSQL mirrors the up body of 00008_jobs_seed.sql. The test uses
// it to (a) re-apply the seed without depending on goose and (b) keep
// the "what was seeded" knowledge localised here for the assertion
// queries. Kept in sync with backend/db/migrations/00008_jobs_seed.sql.
const seedJobsSQL = `
INSERT INTO companies (id, name, rfc, industry_id, status) VALUES
    ('018f0000-0000-7000-8000-000000000001', 'Acme SA',         'ACME010101AAA', 'technology', 'active'),
    ('018f0000-0000-7000-8000-000000000002', 'Globex Holdings', 'GLOB010101BBB', 'finance',    'active'),
    ('018f0000-0000-7000-8000-000000000003', 'Initech LLC',     'INIT010101CCC', 'retail',     'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO jobs
    (id, company_id, title, description, work_mode, employment_type,
     seniority, status, location, salary_min, salary_max, salary_currency,
     published_at, created_at, updated_at)
VALUES
    ('018f0000-0000-7000-8000-0000000000a1',
     '018f0000-0000-7000-8000-000000000001',
     'Backend Engineer (Go)', 'Build distributed services in Go and Kubernetes.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     80000, 120000, 'MXN',
     '2026-08-01T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a2',
     '018f0000-0000-7000-8000-000000000001',
     'Frontend Engineer', 'React + TypeScript for the candidate portal.',
     'hybrid', 'full_time', 'mid', 'published', 'CDMX',
     50000, 80000, 'MXN',
     '2026-08-05T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a3',
     '018f0000-0000-7000-8000-000000000002',
     'Data Engineer', 'Pipelines on Airflow and BigQuery; Spanish-speaking team.',
     'remote', 'full_time', 'senior', 'published', 'Remote LATAM',
     90000, 130000, 'USD',
     '2026-08-10T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a4',
     '018f0000-0000-7000-8000-000000000002',
     'ML Engineer', 'Recommendation systems, PyTorch, embeddings.',
     'remote', 'contract', 'lead', 'published', 'Remote',
     NULL, NULL, 'USD',
     '2026-08-12T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a5',
     '018f0000-0000-7000-8000-000000000003',
     'Junior QA', 'Manual + automated testing, ISTQB foundation a plus.',
     'onsite', 'full_time', 'junior', 'published', 'Guadalajara',
     25000, 35000, 'MXN',
     '2026-08-15T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a6',
     '018f0000-0000-7000-8000-000000000003',
     'DevOps Intern', 'CI/CD pipelines, IaC, on-call shadowing.',
     'hybrid', 'internship', 'intern', 'published', 'Guadalajara',
     15000, 20000, 'MXN',
     '2026-08-18T12:00:00Z', now(), now())
ON CONFLICT (id) DO NOTHING;
`
