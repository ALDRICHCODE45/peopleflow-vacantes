//go:build integration

// Runtime coverage for the applications ADAPTER against a live PostgreSQL.
//
// The unit tests in `applicationRepository_test.go` cover the deterministic
// Go helpers (`mapCreateError`, `mapTransitionError`, `mapGetError`, the
// builders, the `to*` mappers) — the old stub `Querier` seam was removed with
// the D5 pool-owning adapter; they cannot cover what
// actually decides the slice's behavior — the SQL in
// `db/queries/applications.sql` (design D1/D3/D5) plus the migrated schema
// (00010). Everything asserted here is what only Postgres can prove:
//
//   - Create atomic eligibility gate (D1): published + deleted_at IS NULL +
//     active company yields a row; draft / closed / soft-deleted /
//     suspended-company / pending_verification-company / tombstoned-company
//     (active status + deleted_at set) / non-existent job
//     yield ErrJobNotApplicable with NO row; the gate is atomic with the
//     INSERT (a company suspended in-transaction before the write still wins
//     the predicate); duplicate (job_id, candidate_id) surfaces
//     ErrAlreadyApplied via 23505; a non-existent candidate_id surfaces
//     ErrInvalidApplicationReference via 23503 (defense-in-depth); a
//     malformed source VO surfaces ErrInvalidStatusTransition via 23514
//     (defense-in-depth).
//   - GetByID same-company scope + D12 PII minimization: cross-company /
//     mismatched-job / non-existent ids all surface ErrApplicationNotFound;
//     the candidate snippet projects ONLY full_name + professional_title +
//     years_of_experience (the fixture stores salary + birth_date and the
//     round-trip proves they never surface); a candidate without a
//     candidate_profiles row renders nil snippet fields (LEFT JOIN); a
//     soft-deleted job's application stays retrievable.
//   - ListByJob two-step (D5): cross-company / non-existent job →
//     ErrApplicationNotFound (scope check); own-company empty → non-nil
//     empty slice; populated → created_at DESC; soft-deleted jobs' history
//     visible; LIMIT 100 caps the queue.
//   - ListByCandidate: only the caller's rows, created_at DESC, non-nil
//     empty, soft-deleted job history preserved, LIMIT 100 caps.
//   - Transition (D3): submitted→in_review / in_review→rejected /
//     in_review→hired succeed with a fresh updated_at; the WHERE status=from
//     lost-race guard surfaces ErrApplicationNotFound on a stale writer AND
//     the row stays readable (S99 re-fetch); cross-company →
//     ErrApplicationNotFound; soft-deleted jobs' applications remain
//     transitionable.
//
// The transition MATRIX 400s (submitted→rejected, terminal-state edges, …)
// are deliberately NOT asserted here: design D6 pins the matrix to the use
// case (`CanTransitionTo`), and the DB has no transition CHECK — the adapter
// is the dumb guarded UPDATE. Those 400s are pinned by
// `TestTransitionApplication_IllegalMatrix` (use-case layer) and the handler
// `_IllegalTransition400`.
//
// Isolation: every test runs against COMMITTED state (design D10 fixture
// migration). The fixture seeds its own companies/jobs/users/candidate_profiles
// universe (fixed UUIDs under 01900000-…, ON CONFLICT DO NOTHING) plus
// per-test rows with unique ids; each test registers the rows it created and
// t.Cleanup runs targeted DELETEs (applications + their audit_events rows,
// bulk users, bulk jobs) so sibling tests and re-runs never collide on
// UNIQUE(job_id, candidate_id) or leave audit residue. The pool-owning
// adapter opens its OWN transaction per write (pool.Begin), so a shared
// rollback fixture would be invisible to it — this is why the suite migrated
// to the committed-fixture pattern (companyBootstrapRepository precedent).
// Tests do not call t.Parallel(), so the committed writes never contend with
// each other or with the migration tests.
//
// Skips (never fails) when DATABASE_URL is unset, via the package helper
// `skipIfNoDatabaseForApplications` from migration_00010_test.go. Assumes
// `make db-migrate` has applied 00001..00011; the fixture re-applies its own
// seed so it also works right after a down/up migration test.
package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/repositories"
	applicationsvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// --- fixture identities ---------------------------------------------------
//
// Fixed UUIDs under the 01900000-… namespace, distinct from the jobs /
// membership fixtures (018f0000-…) so the suites never collide when run in
// the same database.
var (
	// Companies: two active, one suspended, one pending_verification.
	appCoActive1   = uuid.MustParse("01900000-0000-7000-8000-0000000000a1") // active
	appCoActive2   = uuid.MustParse("01900000-0000-7000-8000-0000000000a2") // active
	appCoSuspended = uuid.MustParse("01900000-0000-7000-8000-0000000000a3") // suspended
	appCoPending   = uuid.MustParse("01900000-0000-7000-8000-0000000000a4") // pending_verification
	appCoTombstone = uuid.MustParse("01900000-0000-7000-8000-0000000000a5") // active status + deleted_at set (tombstoned)

	// Jobs. All are published + deleted_at IS NULL unless the name says
	// otherwise; every job's owning company is appCoActive1 unless stated.
	appJobPublished   = uuid.MustParse("01900000-0000-7000-8000-0000000000b1") // published, active co
	appJobDraft       = uuid.MustParse("01900000-0000-7000-8000-0000000000b2") // draft
	appJobClosed      = uuid.MustParse("01900000-0000-7000-8000-0000000000b3") // closed
	appJobSoftDeleted = uuid.MustParse("01900000-0000-7000-8000-0000000000b4") // published + deleted_at
	appJobForeign     = uuid.MustParse("01900000-0000-7000-8000-0000000000b5") // published, appCoActive2
	appJobSuspendedCo = uuid.MustParse("01900000-0000-7000-8000-0000000000b6") // published, appCoSuspended
	appJobPendingCo   = uuid.MustParse("01900000-0000-7000-8000-0000000000b7") // published, appCoPending
	appJobTombCo      = uuid.MustParse("01900000-0000-7000-8000-0000000000ba") // published, appCoTombstone
	appJobPublished2  = uuid.MustParse("01900000-0000-7000-8000-0000000000b8") // published, active co
	appJobPublished3  = uuid.MustParse("01900000-0000-7000-8000-0000000000b9") // published, active co

	// Users (candidates).
	appUserC1 = uuid.MustParse("01900000-0000-7000-8000-0000000000c1") // HAS a candidate_profiles row (with PII)
	appUserC2 = uuid.MustParse("01900000-0000-7000-8000-0000000000c2") // no candidate_profiles row
	appUserC3 = uuid.MustParse("01900000-0000-7000-8000-0000000000c3") // no candidate_profiles row
)

// applicationFixtureSQL adds the applications adapter's fixture universe on
// top of the migrated schema. Companies/jobs/users mirror the 00008-seed
// conventions (fixed UUIDs, ON CONFLICT DO NOTHING) so the suite is
// self-contained and does not depend on the jobs feature's seed having run.
//
// PII note: appUserC1's candidate_profiles row stores a real salary and
// birth_date so the D12 PII-minimization assertion is non-vacuous — a leaky
// adapter query WOULD return them; TestGetByID_OwnCompany proves it does not.
const applicationFixtureSQL = `
INSERT INTO companies (id, name, rfc, industry_id, status) VALUES
    ('01900000-0000-7000-8000-0000000000a1', 'App Active One SA',  'APPA010101AAA', 'technology', 'active'),
    ('01900000-0000-7000-8000-0000000000a2', 'App Active Two SA',  'APPA010101BBB', 'finance',    'active'),
    ('01900000-0000-7000-8000-0000000000a3', 'App Suspended SA',   'APPA010101CCC', 'retail',     'suspended'),
    ('01900000-0000-7000-8000-0000000000a4', 'App Pending SA',     'APPA010101DDD', 'retail',     'pending_verification')
ON CONFLICT (id) DO NOTHING;

INSERT INTO companies (id, name, rfc, industry_id, status, deleted_at) VALUES
    ('01900000-0000-7000-8000-0000000000a5', 'App Tombstoned SA', 'APPA010101EEE', 'technology', 'active', '2026-07-01T00:00:00Z')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, deleted_at = EXCLUDED.deleted_at;

INSERT INTO jobs
    (id, company_id, title, description, work_mode, employment_type,
     seniority, status, location, salary_min, salary_max, salary_currency,
     published_at, deleted_at, created_at, updated_at)
VALUES
    ('01900000-0000-7000-8000-0000000000b1',
     '01900000-0000-7000-8000-0000000000a1',
     'App Published Engineer', 'published fixture row for the apply gate.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-01T12:00:00Z', NULL, now(), now()),

    ('01900000-0000-7000-8000-0000000000b2',
     '01900000-0000-7000-8000-0000000000a1',
     'App Draft Engineer', 'draft row for the apply gate.',
     'remote', 'full_time', 'senior', 'draft', 'CDMX',
     NULL, NULL, 'MXN', NULL, NULL, now(), now()),

    ('01900000-0000-7000-8000-0000000000b3',
     '01900000-0000-7000-8000-0000000000a1',
     'App Closed Engineer', 'closed row for the apply gate.',
     'remote', 'full_time', 'senior', 'closed', 'CDMX',
     NULL, NULL, 'MXN', '2026-06-15T12:00:00Z', NULL, now(), now()),

    ('01900000-0000-7000-8000-0000000000b4',
     '01900000-0000-7000-8000-0000000000a1',
     'App Deleted Engineer', 'soft-deleted row for the apply gate.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-02T12:00:00Z', '2026-07-03T12:00:00Z', now(), now()),

    ('01900000-0000-7000-8000-0000000000b5',
     '01900000-0000-7000-8000-0000000000a2',
     'App Foreign Engineer', 'foreign-company published row.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-04T12:00:00Z', NULL, now(), now()),

    ('01900000-0000-7000-8000-0000000000b6',
     '01900000-0000-7000-8000-0000000000a3',
     'App Suspended Co Engineer', 'published row owned by a suspended company.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-05T12:00:00Z', NULL, now(), now()),

    ('01900000-0000-7000-8000-0000000000b7',
     '01900000-0000-7000-8000-0000000000a4',
     'App Pending Co Engineer', 'published row owned by a pending_verification company.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-06T12:00:00Z', NULL, now(), now()),

    ('01900000-0000-7000-8000-0000000000b8',
     '01900000-0000-7000-8000-0000000000a1',
     'App Published Engineer Two', 'second published fixture row.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-07T12:00:00Z', NULL, now(), now()),

    ('01900000-0000-7000-8000-0000000000b9',
     '01900000-0000-7000-8000-0000000000a1',
     'App Published Engineer Three', 'third published fixture row.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-08T12:00:00Z', NULL, now(), now()),

    ('01900000-0000-7000-8000-0000000000ba',
     '01900000-0000-7000-8000-0000000000a5',
     'App Tombstoned Co Engineer', 'published row owned by an active-status soft-deleted company.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-09T12:00:00Z', NULL, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, cognito_sub, email, full_name, user_type) VALUES
    ('01900000-0000-7000-8000-0000000000c1', 'app-candidate-1-sub', 'app-candidate-1@example.com', 'App Candidate One',   'candidate'),
    ('01900000-0000-7000-8000-0000000000c2', 'app-candidate-2-sub', 'app-candidate-2@example.com', 'App Candidate Two',   'candidate'),
    ('01900000-0000-7000-8000-0000000000c3', 'app-candidate-3-sub', 'app-candidate-3@example.com', 'App Candidate Three', 'candidate')
ON CONFLICT (id) DO NOTHING;

INSERT INTO candidate_profiles
    (user_id, professional_title, years_of_experience, current_salary_gross, birth_date)
VALUES
    ('01900000-0000-7000-8000-0000000000c1', 'Senior Go Engineer', 7, 120000, '1990-01-01')
ON CONFLICT (user_id) DO NOTHING;
`

// applicationFixture is the per-test fixture handle: the pool-owning adapter
// (which opens its OWN co-write transaction per write) plus the fixed UUIDs
// the assertions reference. Every row the test creates is registered in the
// tracking slices so t.Cleanup can DELETE exactly what this test added — the
// committed-fixture contract (design D10): never touch sibling rows, never
// leave residue that breaks UNIQUE(job_id, candidate_id) or audit counts on
// re-runs.
type applicationFixture struct {
	pool *pgxpool.Pool
	repo *ApplicationRepository

	// Rows this test created, deleted by t.Cleanup (audit_events rows are
	// deleted together with their application via entity_id).
	createdAppIDs  []uuid.UUID
	createdUserIDs []uuid.UUID
	createdJobIDs  []uuid.UUID

	coActive1      uuid.UUID
	coActive2      uuid.UUID
	coSuspended    uuid.UUID
	coPending      uuid.UUID
	coTombstoned   uuid.UUID
	jobPublished   uuid.UUID
	jobDraft       uuid.UUID
	jobClosed      uuid.UUID
	jobSoftDeleted uuid.UUID
	jobForeign     uuid.UUID
	jobSuspendedCo uuid.UUID
	jobPendingCo   uuid.UUID
	jobTombCo      uuid.UUID
	jobPublished2  uuid.UUID
	jobPublished3  uuid.UUID
	userC1         uuid.UUID
	userC2         uuid.UUID
	userC3         uuid.UUID
}

// trackApp registers an application row (and its audit_events rows, which
// share the entity_id) for t.Cleanup deletion.
func (f *applicationFixture) trackApp(id uuid.UUID) { f.createdAppIDs = append(f.createdAppIDs, id) }

// setupApplicationFixture is the SetupTest-style helper every test here
// starts with. It skips without a database, probes the migrated schema,
// applies the fixture seed ON CONFLICT DO NOTHING (idempotent), and builds
// the pool-owning adapter with the stateless audit adapter (the co-write
// contract: Create/Transition open their own pool.Begin).
//
// Cleanup: t.Cleanup DELETEs exactly the rows this test registered — never a
// blanket table prune (the seed rows are shared/idempotent; sibling tests'
// committed rows must survive).
//
// Returns the test context (30s timeout) and the fixture handle.
func setupApplicationFixture(t *testing.T) (context.Context, *applicationFixture) {
	t.Helper()

	pool := skipIfNoDatabaseForApplications(t)
	t.Cleanup(pool.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	requireApplicationsSchema(ctx, t, pool)

	if _, err := pool.Exec(ctx, applicationFixtureSQL); err != nil {
		t.Fatalf("apply applications fixture: %v", err)
	}

	// D5 wiring: the pool-owning adapter + the stateless audit adapter; the
	// co-write transaction is opened inside the adapter, so the fixture seeds
	// through the pool directly (committed).
	repo := NewApplicationRepository(pool, auditpostgres.NewAuditEventRepository())

	f := &applicationFixture{
		pool:           pool,
		repo:           repo,
		coActive1:      appCoActive1,
		coActive2:      appCoActive2,
		coSuspended:    appCoSuspended,
		coPending:      appCoPending,
		coTombstoned:   appCoTombstone,
		jobPublished:   appJobPublished,
		jobDraft:       appJobDraft,
		jobClosed:      appJobClosed,
		jobSoftDeleted: appJobSoftDeleted,
		jobForeign:     appJobForeign,
		jobSuspendedCo: appJobSuspendedCo,
		jobPendingCo:   appJobPendingCo,
		jobTombCo:      appJobTombCo,
		jobPublished2:  appJobPublished2,
		jobPublished3:  appJobPublished3,
		userC1:         appUserC1,
		userC2:         appUserC2,
		userC3:         appUserC3,
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		for _, id := range f.createdAppIDs {
			// audit_events rows reference the application via entity_id (no FK,
			// by design) — delete them first so the count-based assertions in
			// sibling/re-run tests see only their own rows.
			if _, err := pool.Exec(cleanupCtx, `DELETE FROM audit_events WHERE entity_id = $1`, id); err != nil {
				t.Errorf("cleanup audit_events for %s: %v", id, err)
			}
			if _, err := pool.Exec(cleanupCtx, `DELETE FROM applications WHERE id = $1`, id); err != nil {
				t.Errorf("cleanup application %s: %v", id, err)
			}
		}
		for _, id := range f.createdUserIDs {
			// Bulk candidates may own untracked application rows (the Cap100
			// tests insert them inline) — remove those (and their audit rows)
			// before the user, satisfying applications_candidate_id_fkey.
			if _, err := pool.Exec(cleanupCtx,
				`DELETE FROM audit_events WHERE entity_id IN (SELECT id FROM applications WHERE candidate_id = $1)`, id); err != nil {
				t.Errorf("cleanup audit_events for candidate %s: %v", id, err)
			}
			if _, err := pool.Exec(cleanupCtx, `DELETE FROM applications WHERE candidate_id = $1`, id); err != nil {
				t.Errorf("cleanup applications for candidate %s: %v", id, err)
			}
			if _, err := pool.Exec(cleanupCtx, `DELETE FROM users WHERE id = $1`, id); err != nil {
				t.Errorf("cleanup user %s: %v", id, err)
			}
		}
		for _, id := range f.createdJobIDs {
			// Bulk jobs may own untracked application rows (the Cap100 tests
			// insert them inline) — remove those (and their audit rows) before
			// the job, satisfying applications_job_id_fkey.
			if _, err := pool.Exec(cleanupCtx,
				`DELETE FROM audit_events WHERE entity_id IN (SELECT id FROM applications WHERE job_id = $1)`, id); err != nil {
				t.Errorf("cleanup audit_events for job %s: %v", id, err)
			}
			if _, err := pool.Exec(cleanupCtx, `DELETE FROM applications WHERE job_id = $1`, id); err != nil {
				t.Errorf("cleanup applications for job %s: %v", id, err)
			}
			if _, err := pool.Exec(cleanupCtx, `DELETE FROM jobs WHERE id = $1`, id); err != nil {
				t.Errorf("cleanup job %s: %v", id, err)
			}
		}
	})
	return ctx, f
}

// requireApplicationsSchema fails loudly (rather than silently passing) when
// the migrations have not been applied — a green run against a missing table
// would be a false negative for every scenario in this file. audit_events is
// included because the co-write tests cannot pass without migration 00011.
func requireApplicationsSchema(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, table := range []string{"applications", "audit_events", "jobs", "companies", "users", "candidate_profiles"} {
		var hasTable bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`, table,
		).Scan(&hasTable); err != nil {
			t.Fatalf("probe %s table: %v", table, err)
		}
		if !hasTable {
			t.Fatalf("table `%s` is missing — run `make db-migrate` before the integration suite", table)
		}
	}
}

// --- seed helpers ---------------------------------------------------------

// seedApplication inserts an application row directly (status = DB default
// 'submitted', server timestamps), bypassing the atomic gate — the gate is
// the code under test, so seeding through Create would re-enter it. The row is
// committed immediately (pool) and registered for t.Cleanup deletion.
func seedApplication(ctx context.Context, t *testing.T, f *applicationFixture, id, jobID, candidateID uuid.UUID) {
	t.Helper()
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id) VALUES ($1, $2, $3)`,
		id, jobID, candidateID,
	); err != nil {
		t.Fatalf("seed application %s: %v", id, err)
	}
	f.trackApp(id)
}

// seedApplicationAt inserts an application row with an explicit status and
// explicit created_at/updated_at. The explicit timestamps let the ordering
// and updated_at-advance assertions be deterministic; the explicit status
// lets the transition tests start from in_review without going through the
// use case. The transition tests pass a deliberately OLD timestamp so the
// `updated_at = now()` write (transaction-time) is provably AFTER it.
func seedApplicationAt(ctx context.Context, t *testing.T, f *applicationFixture, id, jobID, candidateID uuid.UUID, status string, at time.Time) {
	t.Helper()
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $5)`,
		id, jobID, candidateID, status, at,
	); err != nil {
		t.Fatalf("seed application %s (status=%s): %v", id, status, err)
	}
	f.trackApp(id)
}

// seedBulkCandidates inserts n fresh candidate users and returns their ids.
// Used by the LIMIT-100 tests, which need more distinct (job, candidate)
// pairs than the fixed fixture universe provides. The users are registered
// for t.Cleanup deletion (their applications ride along via the app ids).
func seedBulkCandidates(ctx context.Context, t *testing.T, f *applicationFixture, prefix string, n int) []uuid.UUID {
	t.Helper()
	ids := make([]uuid.UUID, 0, n)
	for i := 0; i < n; i++ {
		id := uuid.New()
		sub := fmt.Sprintf("%s-%d", prefix, i)
		if _, err := f.pool.Exec(ctx,
			`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
			 VALUES ($1, $2, $3, $4, 'candidate')`,
			id, sub, sub+"@example.com", "Bulk Candidate",
		); err != nil {
			t.Fatalf("seed bulk candidate %d: %v", i, err)
		}
		f.createdUserIDs = append(f.createdUserIDs, id)
		ids = append(ids, id)
	}
	return ids
}

// seedBulkJobs inserts n published jobs owned by companyID and returns their
// ids in insertion order. published_at is required by
// jobs_published_integrity_check for status='published' rows. The jobs (and
// their applications, tracked by the caller) are cleaned up per-test.
func seedBulkJobs(ctx context.Context, t *testing.T, f *applicationFixture, companyID uuid.UUID, prefix string, n int) []uuid.UUID {
	t.Helper()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ids := make([]uuid.UUID, 0, n)
	for i := 0; i < n; i++ {
		jobID := uuid.New()
		if _, err := f.pool.Exec(ctx,
			`INSERT INTO jobs
			    (id, company_id, title, description, work_mode, employment_type,
			     seniority, status, location, salary_min, salary_max, salary_currency,
			     published_at, created_at, updated_at)
			 VALUES ($1, $2, $3, 'bulk fixture job', 'remote', 'full_time', 'mid',
			         'published', NULL, NULL, NULL, 'MXN', $4, now(), now())`,
			jobID, companyID, fmt.Sprintf("%s job %d", prefix, i),
			base.Add(time.Duration(i)*time.Minute),
		); err != nil {
			t.Fatalf("seed bulk job %d: %v", i, err)
		}
		f.createdJobIDs = append(f.createdJobIDs, jobID)
		ids = append(ids, jobID)
	}
	return ids
}

// countApplications probes the number of rows matching (job_id, candidate_id).
func countApplications(ctx context.Context, t *testing.T, f *applicationFixture, jobID, candidateID uuid.UUID) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM applications WHERE job_id = $1 AND candidate_id = $2`,
		jobID, candidateID,
	).Scan(&n); err != nil {
		t.Fatalf("count applications: %v", err)
	}
	return n
}

// rowExists probes whether an application row with the given id exists.
func rowExists(ctx context.Context, t *testing.T, f *applicationFixture, id uuid.UUID) bool {
	t.Helper()
	var exists bool
	if err := f.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM applications WHERE id = $1)`, id,
	).Scan(&exists); err != nil {
		t.Fatalf("probe application row %s: %v", id, err)
	}
	return exists
}

// countAuditRowsForEntity probes the number of audit_events rows pointing at
// the given entity_id — the co-write tests' exact-one-event-per-commit and
// no-event-on-non-write assertions.
func countAuditRowsForEntity(ctx context.Context, t *testing.T, f *applicationFixture, entityID uuid.UUID) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_events WHERE entity_id = $1`, entityID,
	).Scan(&n); err != nil {
		t.Fatalf("count audit_events for %s: %v", entityID, err)
	}
	return n
}

// submittedAuditEvent builds the ApplicationSubmitted event value the adapter
// appends (D6: the adapter is dumb — it appends whatever event it is given,
// so these tests construct the full shape the use cases build in production).
func submittedAuditEvent(eventID, entityID, actorID, jobID uuid.UUID, source *string) auditentities.AuditEvent {
	meta := map[string]string{"job_id": jobID.String()}
	if source != nil {
		meta["source"] = *source
	}
	actor := actorID
	return auditentities.AuditEvent{
		ID: eventID, ActorType: auditentities.ActorTypeUser, ActorID: &actor,
		EventType: auditentities.EventApplicationSubmitted, EntityType: auditentities.EntityApplication,
		EntityID: entityID, Metadata: meta,
	}
}

// transitionedAuditEvent builds the ApplicationTransitioned event value the
// adapter appends.
func transitionedAuditEvent(eventID, entityID, actorID, jobID uuid.UUID, from, to applicationsvalueobjects.ApplicationStatus) auditentities.AuditEvent {
	actor := actorID
	return auditentities.AuditEvent{
		ID: eventID, ActorType: auditentities.ActorTypeUser, ActorID: &actor,
		EventType: auditentities.EventApplicationTransitioned, EntityType: auditentities.EntityApplication,
		EntityID: entityID, Metadata: map[string]string{
			"job_id":      jobID.String(),
			"from_status": from.String(),
			"to_status":   to.String(),
		},
	}
}

// createAuditEventsTableDDL mirrors the 00011 up migration body so the
// audit-failure tests can DROP the table, force the co-write to fail, and
// restore it in t.Cleanup. Kept in sync by hand (createApplicationsTableDDL
// precedent).
const createAuditEventsTableDDL = `
CREATE TABLE audit_events (
    id           UUID PRIMARY KEY,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id     UUID,
    actor_type   TEXT NOT NULL
        CONSTRAINT audit_events_actor_type_check
        CHECK (actor_type IN ('user', 'system')),
    event_type   TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    UUID NOT NULL,
    metadata     JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_events_entity_idx
    ON audit_events (entity_type, entity_id, occurred_at DESC);
`

// --- Co-write (design D5 / D6 / D10) ----------------------------------------

// TestCreate_CoWritesApplicationAndAuditEvent pins the fail-closed co-write
// contract end to end: a successful Create commits exactly ONE audit_events
// row with event_type='ApplicationSubmitted', entity_type='application',
// entity_id=<appID>, actor_type='user', actor_id=<candidateID>, and the
// PII-free metadata {job_id} / {job_id, source}.
func TestCreate_CoWritesApplicationAndAuditEvent(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	// Part A — nil source: metadata is exactly {job_id}.
	appIDA := uuid.New()
	if _, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appIDA,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	}, submittedAuditEvent(uuid.New(), appIDA, f.userC1, f.jobPublished, nil)); err != nil {
		t.Fatalf("Create (no source): %v", err)
	}
	f.trackApp(appIDA)

	if n := countAuditRowsForEntity(ctx, t, f, appIDA); n != 1 {
		t.Fatalf("want exactly 1 audit row for entity_id %v, got %d", appIDA, n)
	}
	var (
		actorType, eventType, entityType string
		actorID                          uuid.UUID
		metadata                         []byte
	)
	if err := f.pool.QueryRow(ctx,
		`SELECT actor_type, actor_id, event_type, entity_type, metadata
		 FROM audit_events WHERE entity_id = $1`, appIDA,
	).Scan(&actorType, &actorID, &eventType, &entityType, &metadata); err != nil {
		t.Fatalf("read audit row: %v", err)
	}
	if actorType != "user" {
		t.Errorf("actor_type: want user, got %q", actorType)
	}
	if actorID != f.userC1 {
		t.Errorf("actor_id: want %v (candidate users.id), got %v", f.userC1, actorID)
	}
	if eventType != auditentities.EventApplicationSubmitted {
		t.Errorf("event_type: want %q, got %q", auditentities.EventApplicationSubmitted, eventType)
	}
	if entityType != auditentities.EntityApplication {
		t.Errorf("entity_type: want %q, got %q", auditentities.EntityApplication, entityType)
	}
	var metaA map[string]string
	if err := json.Unmarshal(metadata, &metaA); err != nil {
		t.Fatalf("unmarshal metadata: %v", err)
	}
	if want := map[string]string{"job_id": f.jobPublished.String()}; !reflect.DeepEqual(metaA, want) {
		t.Errorf("metadata (no source): want %v, got %v", want, metaA)
	}

	// Part B — sourced: metadata is {job_id, source}.
	src := applicationsvalueobjects.LinkedIn
	srcStr := "linkedin"
	appIDB := uuid.New()
	if _, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appIDB,
		JobID:       f.jobPublished2,
		CandidateID: f.userC2,
		Source:      &src,
	}, submittedAuditEvent(uuid.New(), appIDB, f.userC2, f.jobPublished2, &srcStr)); err != nil {
		t.Fatalf("Create (sourced): %v", err)
	}
	f.trackApp(appIDB)

	if n := countAuditRowsForEntity(ctx, t, f, appIDB); n != 1 {
		t.Fatalf("want exactly 1 audit row for entity_id %v, got %d", appIDB, n)
	}
	if err := f.pool.QueryRow(ctx,
		`SELECT metadata FROM audit_events WHERE entity_id = $1`, appIDB,
	).Scan(&metadata); err != nil {
		t.Fatalf("read audit metadata: %v", err)
	}
	var metaB map[string]string
	if err := json.Unmarshal(metadata, &metaB); err != nil {
		t.Fatalf("unmarshal metadata: %v", err)
	}
	if want := map[string]string{"job_id": f.jobPublished2.String(), "source": "linkedin"}; !reflect.DeepEqual(metaB, want) {
		t.Errorf("metadata (sourced): want %v, got %v", want, metaB)
	}
}

// TestCreate_AuditFailureRollsBackApplication pins the fail-closed guarantee:
// when the audit INSERT cannot run (the table is dropped), Create returns an
// error AND the already-inserted application row is rolled back — no orphan
// row, no event (the co-write is all-or-nothing).
func TestCreate_AuditFailureRollsBackApplication(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	// Sabotage the co-write: drop audit_events so the append INSERT fails
	// (undefined_table 42P01). Restore via t.Cleanup with the inline DDL.
	if _, err := f.pool.Exec(ctx, `DROP TABLE IF EXISTS audit_events`); err != nil {
		t.Fatalf("drop audit_events: %v", err)
	}
	t.Cleanup(func() {
		if _, err := f.pool.Exec(context.Background(), createAuditEventsTableDDL); err != nil {
			t.Errorf("recreate audit_events: %v", err)
		}
	})

	appID := uuid.New()
	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appID,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	}, submittedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished, nil))
	if err == nil {
		t.Fatal("expected co-write error when audit_events is missing, got nil")
	}
	if rowExists(ctx, t, f, appID) {
		t.Error("the application write must roll back when the audit append fails (fail-closed)")
	}
}

// TestCreate_NonWriteOutcomeNoEvent pins the ordering guarantee: a mapped
// non-write sentinel (gate miss / duplicate) is returned BEFORE any append,
// so zero audit rows exist for that entity_id.
func TestCreate_NonWriteOutcomeNoEvent(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	// Gate miss (draft job) → ErrJobNotApplicable, no row, no event.
	gateAppID := uuid.New()
	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          gateAppID,
		JobID:       f.jobDraft,
		CandidateID: f.userC2,
	}, submittedAuditEvent(uuid.New(), gateAppID, f.userC2, f.jobDraft, nil))
	if !errors.Is(err, entities.ErrJobNotApplicable) {
		t.Fatalf("gate miss: want ErrJobNotApplicable, got %v", err)
	}
	if n := countAuditRowsForEntity(ctx, t, f, gateAppID); n != 0 {
		t.Errorf("gate miss must append no event; got %d audit rows", n)
	}

	// Duplicate (jobPublished, userC1): first Create commits (and appends one
	// event); the second surfaces ErrAlreadyApplied with NO event of its own.
	firstID := uuid.New()
	if _, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          firstID,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	}, submittedAuditEvent(uuid.New(), firstID, f.userC1, f.jobPublished, nil)); err != nil {
		t.Fatalf("first create: %v", err)
	}
	f.trackApp(firstID)

	dupID := uuid.New()
	_, err = f.repo.Create(ctx, repositories.CreateParams{
		ID:          dupID,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	}, submittedAuditEvent(uuid.New(), dupID, f.userC1, f.jobPublished, nil))
	if !errors.Is(err, entities.ErrAlreadyApplied) {
		t.Fatalf("duplicate: want ErrAlreadyApplied, got %v", err)
	}
	if n := countAuditRowsForEntity(ctx, t, f, dupID); n != 0 {
		t.Errorf("duplicate Create must append no event; got %d audit rows", n)
	}
	// The first create's own event is present (exactly one).
	if n := countAuditRowsForEntity(ctx, t, f, firstID); n != 1 {
		t.Errorf("first create: want exactly 1 audit row, got %d", n)
	}
}

// TestTransition_CoWritesTransitionedEvent pins the transition co-write: a
// successful Transition commits exactly ONE ApplicationTransitioned row with
// actor_type='user', actor_id=<recruiterID>, entity_id=<appID>, and metadata
// {job_id, from_status, to_status}.
func TestTransition_CoWritesTransitionedEvent(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobPublished, f.userC1, "submitted", seedTime)
	recruiterID := uuid.New()

	got, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
		transitionedAuditEvent(uuid.New(), appID, recruiterID, f.jobPublished,
			applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview),
	)
	if err != nil {
		t.Fatalf("Transition: %v", err)
	}
	if got.Status != applicationsvalueobjects.InReview {
		t.Errorf("Status: want InReview, got %v", got.Status)
	}

	if n := countAuditRowsForEntity(ctx, t, f, appID); n != 1 {
		t.Fatalf("want exactly 1 audit row for entity_id %v, got %d", appID, n)
	}
	var (
		actorType, eventType string
		actorID              uuid.UUID
		metadata             []byte
	)
	if err := f.pool.QueryRow(ctx,
		`SELECT actor_type, actor_id, event_type, metadata
		 FROM audit_events WHERE entity_id = $1`, appID,
	).Scan(&actorType, &actorID, &eventType, &metadata); err != nil {
		t.Fatalf("read audit row: %v", err)
	}
	if actorType != "user" {
		t.Errorf("actor_type: want user, got %q", actorType)
	}
	if actorID != recruiterID {
		t.Errorf("actor_id: want %v (CompanyContext.UserID), got %v", recruiterID, actorID)
	}
	if eventType != auditentities.EventApplicationTransitioned {
		t.Errorf("event_type: want %q, got %q", auditentities.EventApplicationTransitioned, eventType)
	}
	var meta map[string]string
	if err := json.Unmarshal(metadata, &meta); err != nil {
		t.Fatalf("unmarshal metadata: %v", err)
	}
	want := map[string]string{
		"job_id":      f.jobPublished.String(),
		"from_status": "submitted",
		"to_status":   "in_review",
	}
	if !reflect.DeepEqual(meta, want) {
		t.Errorf("metadata: want %v, got %v", want, meta)
	}
}

// TestTransition_LostRaceNoEvent pins the no-event-on-non-write contract for
// the transition path: the loser of a lost race gets ErrApplicationNotFound
// and appends nothing (the winner's single event is the only row).
func TestTransition_LostRaceNoEvent(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobPublished, f.userC1, "submitted", seedTime)

	// Writer 1 wins: submitted → in_review, commits its event.
	if _, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
		transitionedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished,
			applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview),
	); err != nil {
		t.Fatalf("first transition: %v", err)
	}

	// Writer 2 holds the stale view (from_status='submitted') → 0 rows.
	_, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
		transitionedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished,
			applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview),
	)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound (lost race), got %v", err)
	}

	// Exactly the winner's one event — the loser appended nothing.
	if n := countAuditRowsForEntity(ctx, t, f, appID); n != 1 {
		t.Errorf("lost-race transition must append no event; want 1 audit row, got %d", n)
	}
}

// TestTransition_AuditFailureRollsBackStatus pins the fail-closed guarantee
// on the transition path: when the audit append fails, the status change is
// rolled back (the row stays at its previous status) and no event exists.
func TestTransition_AuditFailureRollsBackStatus(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	if _, err := f.pool.Exec(ctx, `DROP TABLE IF EXISTS audit_events`); err != nil {
		t.Fatalf("drop audit_events: %v", err)
	}
	t.Cleanup(func() {
		if _, err := f.pool.Exec(context.Background(), createAuditEventsTableDDL); err != nil {
			t.Errorf("recreate audit_events: %v", err)
		}
	})

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobPublished, f.userC1, "submitted", seedTime)

	_, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
		transitionedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished,
			applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview),
	)
	if err == nil {
		t.Fatal("expected co-write error when audit_events is missing, got nil")
	}

	var status string
	if err := f.pool.QueryRow(ctx,
		`SELECT status FROM applications WHERE id = $1`, appID,
	).Scan(&status); err != nil {
		t.Fatalf("raw read: %v", err)
	}
	if status != "submitted" {
		t.Errorf("status must be rolled back to submitted on audit failure, got %q", status)
	}
}

// --- Create (design D1 / D2) ----------------------------------------------

// TestCreate_PublishedActiveJobSuccess — spec scenario S20 (+ S24/S26).
// A published job from an active company accepts an application: the
// returned entity carries status='submitted', the server id and timestamps,
// and the optional source/cover_letter round-trip through the wire→SQL→
// entity path. Part A (nil optionals) proves absent source/cover_letter are
// stored as SQL NULL (S24/S26); Part B (present optionals) proves the stored
// values surface back (S20).
func TestCreate_PublishedActiveJobSuccess(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	// Part A — absent optionals → SQL NULL (S24/S26).
	appIDA := uuid.New()
	gotA, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appIDA,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	}, submittedAuditEvent(uuid.New(), appIDA, f.userC1, f.jobPublished, nil))
	if err != nil {
		t.Fatalf("Create(no optionals): %v", err)
	}
	f.trackApp(appIDA)
	if gotA.ID != appIDA {
		t.Errorf("ID: want %v, got %v", appIDA, gotA.ID)
	}
	if gotA.JobID != f.jobPublished {
		t.Errorf("JobID: want %v, got %v", f.jobPublished, gotA.JobID)
	}
	if gotA.CandidateID != f.userC1 {
		t.Errorf("CandidateID: want %v, got %v", f.userC1, gotA.CandidateID)
	}
	if gotA.Status != applicationsvalueobjects.Submitted {
		t.Errorf("Status: want Submitted, got %v", gotA.Status)
	}
	if gotA.Source != nil {
		t.Errorf("Source: want nil (absent on the wire), got %v", *gotA.Source)
	}
	if gotA.CoverLetter != nil {
		t.Errorf("CoverLetter: want nil (absent on the wire), got %q", *gotA.CoverLetter)
	}
	if gotA.CreatedAt.IsZero() || gotA.UpdatedAt.IsZero() {
		t.Errorf("timestamps: want server-supplied non-zero, got created=%v updated=%v",
			gotA.CreatedAt, gotA.UpdatedAt)
	}

	// Raw SQL round-trip: the persisted row is exactly what the adapter
	// returned — NULL source/cover_letter, DB-default status, and the
	// reserved columns stay NULL (S45 / D11).
	var status string
	var dbSource, dbCover, dbCVKey *string
	var dbAnonymizedAt *time.Time
	if err := f.pool.QueryRow(ctx,
		`SELECT status, source, cover_letter, cv_s3_key, anonymized_at
		 FROM applications WHERE id = $1`, appIDA,
	).Scan(&status, &dbSource, &dbCover, &dbCVKey, &dbAnonymizedAt); err != nil {
		t.Fatalf("raw read (part A): %v", err)
	}
	if status != "submitted" {
		t.Errorf("raw status: want submitted, got %q", status)
	}
	if dbSource != nil {
		t.Errorf("raw source: want NULL, got %q", *dbSource)
	}
	if dbCover != nil {
		t.Errorf("raw cover_letter: want NULL, got %q", *dbCover)
	}
	if dbCVKey != nil || dbAnonymizedAt != nil {
		t.Errorf("raw reserved columns: cv_s3_key=%v anonymized_at=%v, want both NULL", dbCVKey, dbAnonymizedAt)
	}

	// Part B — present optionals → stored + surfaced (S20).
	src := applicationsvalueobjects.Referral
	srcStr := "referral"
	cover := "I am a great fit for this role."
	appIDB := uuid.New()
	gotB, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appIDB,
		JobID:       f.jobPublished2,
		CandidateID: f.userC1,
		Source:      &src,
		CoverLetter: &cover,
	}, submittedAuditEvent(uuid.New(), appIDB, f.userC1, f.jobPublished2, &srcStr))
	if err != nil {
		t.Fatalf("Create(with optionals): %v", err)
	}
	f.trackApp(appIDB)
	if gotB.Status != applicationsvalueobjects.Submitted {
		t.Errorf("Status: want Submitted, got %v", gotB.Status)
	}
	if gotB.Source == nil || *gotB.Source != applicationsvalueobjects.Referral {
		t.Errorf("Source: want Referral, got %v", gotB.Source)
	}
	if gotB.CoverLetter == nil || *gotB.CoverLetter != cover {
		t.Errorf("CoverLetter: want %q, got %v", cover, gotB.CoverLetter)
	}

	var dbSourceB, dbCoverB *string
	if err := f.pool.QueryRow(ctx,
		`SELECT source, cover_letter FROM applications WHERE id = $1`, appIDB,
	).Scan(&dbSourceB, &dbCoverB); err != nil {
		t.Fatalf("raw read (part B): %v", err)
	}
	if dbSourceB == nil || *dbSourceB != "referral" {
		t.Errorf("raw source: want referral, got %v", dbSourceB)
	}
	if dbCoverB == nil || *dbCoverB != cover {
		t.Errorf("raw cover_letter: want %q, got %v", cover, dbCoverB)
	}
}

// TestCreate_NotApplicable — spec scenarios S31–S36 (table-driven: draft /
// closed / soft-deleted / suspended company / pending_verification company /
// non-existent job). Each must surface entities.ErrJobNotApplicable AND
// insert no row (the atomic gate produced 0 rows).
func TestCreate_NotApplicable(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	cases := []struct {
		name  string
		jobID uuid.UUID
	}{
		{"draft job", f.jobDraft},
		{"closed job", f.jobClosed},
		{"soft-deleted job", f.jobSoftDeleted},
		{"suspended company", f.jobSuspendedCo},
		{"pending_verification company", f.jobPendingCo},
		{"tombstoned company (active status, deleted_at set)", f.jobTombCo},
		{"non-existent job", uuid.New()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			appID := uuid.New()
			_, err := f.repo.Create(ctx, repositories.CreateParams{
				ID:          appID,
				JobID:       tc.jobID,
				CandidateID: f.userC2,
			}, submittedAuditEvent(uuid.New(), appID, f.userC2, tc.jobID, nil))
			// Track unconditionally: on a gate miss the cleanup DELETE is a
			// no-op; if a future regression lets the gate pass (the RED state
			// of the tombstoned-company case), the leaked row + its audit
			// event are still removed so re-runs never collide on
			// UNIQUE(job_id, candidate_id).
			f.trackApp(appID)
			if !errors.Is(err, entities.ErrJobNotApplicable) {
				t.Errorf("err: want ErrJobNotApplicable, got %v", err)
			}
			if rowExists(ctx, t, f, appID) {
				t.Error("gate miss must not insert a row")
			}
		})
	}
}

// TestCreate_DuplicateReturnsAlreadyApplied — spec scenario S38: the second
// Create on the same (job_id, candidate_id) surfaces ErrAlreadyApplied
// (SQLSTATE 23505 on applications_job_candidate_unique) and no second row is
// inserted.
func TestCreate_DuplicateReturnsAlreadyApplied(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	appID := uuid.New()
	if _, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appID,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	}, submittedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished, nil)); err != nil {
		t.Fatalf("first create: %v", err)
	}
	f.trackApp(appID)

	// Verify exactly one row BEFORE the duplicate attempt. The second Create
	// violates the UNIQUE(job_id, candidate_id) guard inside its OWN adapter
	// transaction, which aborts only that transaction (25P02 is contained) and
	// returns the mapped 23505 sentinel; the pool stays usable afterwards.
	if n := countApplications(ctx, t, f, f.jobPublished, f.userC1); n != 1 {
		t.Errorf("row count after first create: want 1, got %d", n)
	}

	dupAppID := uuid.New()
	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          dupAppID,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	}, submittedAuditEvent(uuid.New(), dupAppID, f.userC1, f.jobPublished, nil))
	if !errors.Is(err, entities.ErrAlreadyApplied) {
		t.Errorf("err: want ErrAlreadyApplied (23505), got %v", err)
	}
	if n := countApplications(ctx, t, f, f.jobPublished, f.userC1); n != 1 {
		t.Errorf("row count after duplicate: want still 1, got %d", n)
	}
	if n := countAuditRowsForEntity(ctx, t, f, dupAppID); n != 0 {
		t.Errorf("duplicate Create must not append an audit event; got %d rows for entity_id %v", n, dupAppID)
	}
}

// TestCreate_CrossJobAllowed — spec scenario S39: the UNIQUE is per
// (job_id, candidate_id), so the same candidate may apply to a different
// published job.
func TestCreate_CrossJobAllowed(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	for _, jobID := range []uuid.UUID{f.jobPublished, f.jobPublished2} {
		appID := uuid.New()
		if _, err := f.repo.Create(ctx, repositories.CreateParams{
			ID:          appID,
			JobID:       jobID,
			CandidateID: f.userC1,
		}, submittedAuditEvent(uuid.New(), appID, f.userC1, jobID, nil)); err != nil {
			t.Fatalf("create on job %v: %v", jobID, err)
		}
		f.trackApp(appID)
	}

	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM applications WHERE candidate_id = $1`, f.userC1,
	).Scan(&n); err != nil {
		t.Fatalf("count applications: %v", err)
	}
	if n != 2 {
		t.Errorf("row count: want 2 (one per job), got %d", n)
	}
}

// TestCreate_GateIsAtomicWithInsert — spec scenario S37: the eligibility
// predicate lives in the SAME statement as the INSERT, so a company that is
// active at the middleware gate but suspended before the INSERT still wins
// the predicate → 0 rows → ErrJobNotApplicable (no TOCTOU window).
func TestCreate_GateIsAtomicWithInsert(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	// Precondition: the fixture company is active before we simulate the
	// concurrent suspension — otherwise the test would pass on the wrong
	// reason.
	var status string
	if err := f.pool.QueryRow(ctx,
		`SELECT status FROM companies WHERE id = $1`, f.coActive1,
	).Scan(&status); err != nil {
		t.Fatalf("read company status: %v", err)
	}
	if status != "active" {
		t.Fatalf("precondition: company must start active, got %q", status)
	}

	// Suspend the company (committed — the adapter's own tx sees it),
	// simulating the state change between the middleware-level gate and the
	// INSERT arriving at the SQL layer. Restore it in t.Cleanup so sibling
	// tests keep seeing appCoActive1 as active.
	if _, err := f.pool.Exec(ctx,
		`UPDATE companies SET status = 'suspended' WHERE id = $1`, f.coActive1,
	); err != nil {
		t.Fatalf("suspend company mid-transaction: %v", err)
	}
	t.Cleanup(func() {
		if _, err := f.pool.Exec(context.Background(),
			`UPDATE companies SET status = 'active' WHERE id = $1`, f.coActive1,
		); err != nil {
			t.Errorf("restore company %s to active: %v", f.coActive1, err)
		}
	})

	appID := uuid.New()
	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appID,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	}, submittedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished, nil))
	if !errors.Is(err, entities.ErrJobNotApplicable) {
		t.Errorf("err: want ErrJobNotApplicable (atomic gate wins), got %v", err)
	}
	if rowExists(ctx, t, f, appID) {
		t.Error("atomic gate miss must not insert a row")
	}
	if n := countAuditRowsForEntity(ctx, t, f, appID); n != 0 {
		t.Errorf("gate miss must not append an audit event; got %d rows", n)
	}
}

// TestCreate_InvalidCandidateReference — design D2 23503 branch
// (defense-in-depth): a candidate_id that matches no users row passes the
// job gate but violates applications.candidate_id FK → SQLSTATE 23503 →
// ErrInvalidApplicationReference (400 sentinel). Unreachable via the
// designed flow (the JWT resolution always yields a live users.id); pinned
// here at the SQL round-trip level so the branch cannot silently rot.
func TestCreate_InvalidCandidateReference(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	ghostCandidate := uuid.New() // no users row
	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          uuid.New(),
		JobID:       f.jobPublished,
		CandidateID: ghostCandidate,
	}, submittedAuditEvent(uuid.New(), uuid.New(), ghostCandidate, f.jobPublished, nil))
	if !errors.Is(err, entities.ErrInvalidApplicationReference) {
		t.Errorf("err: want ErrInvalidApplicationReference (23503), got %v", err)
	}
}

// TestCreate_InvalidSourceCheckViolation — design D2 23514 branch
// (defense-in-depth): a malformed source VO (not representable via
// ParseApplicationSource) serializes to "unknown_source" and trips
// applications_source_check → SQLSTATE 23514 → ErrInvalidStatusTransition
// (400 sentinel). The use case VO-parses before the port, so this branch is
// only reachable by a programming error; pinned here so it fails loud at the
// DB boundary instead of storing garbage.
func TestCreate_InvalidSourceCheckViolation(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	badSource := applicationsvalueobjects.ApplicationSource(99) // String() = "unknown_source"
	appID := uuid.New()
	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appID,
		JobID:       f.jobPublished,
		CandidateID: f.userC2,
		Source:      &badSource,
	}, submittedAuditEvent(uuid.New(), appID, f.userC2, f.jobPublished, nil))
	if !errors.Is(err, applicationsvalueobjects.ErrInvalidStatusTransition) {
		t.Errorf("err: want ErrInvalidStatusTransition (23514), got %v", err)
	}
	if n := countAuditRowsForEntity(ctx, t, f, appID); n != 0 {
		t.Errorf("CHECK violation must not append an audit event; got %d rows", n)
	}
}

// --- GetByID (design D5 / D12) --------------------------------------------

// TestGetByID_OwnCompany — spec scenario S73: the owning recruiter fetches
// the detail. Also the D12 PII pin: the fixture profile stores a real salary
// + birth_date, and the round-trip proves the snippet carries ONLY user_id /
// full_name / professional_title / years_of_experience.
func TestGetByID_OwnCompany(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	appID := uuid.New()
	seedApplication(ctx, t, f, appID, f.jobPublished, f.userC1)

	got, err := f.repo.GetByID(ctx, appID, f.jobPublished, f.coActive1)
	if err != nil {
		t.Fatalf("GetByID(own company): %v", err)
	}
	if got.ID != appID {
		t.Errorf("ID: want %v, got %v", appID, got.ID)
	}
	if got.Status != applicationsvalueobjects.Submitted {
		t.Errorf("Status: want Submitted, got %v", got.Status)
	}
	if got.CreatedAt.IsZero() || got.UpdatedAt.IsZero() {
		t.Errorf("timestamps: want non-zero, got created=%v updated=%v", got.CreatedAt, got.UpdatedAt)
	}

	// The PII fixture is REAL — salary + birth_date are stored on the
	// candidate_profiles row. If the adapter query ever selected them, the
	// sqlc row scan would break (column-count/type drift) or the entity
	// would have to expose them (compile-time). Probe the DB to prove the
	// fixture actually contains the PII, so the absence assertion below is
	// non-vacuous.
	var gross *int
	var birth *time.Time
	if err := f.pool.QueryRow(ctx,
		`SELECT current_salary_gross, birth_date FROM candidate_profiles WHERE user_id = $1`,
		f.userC1,
	).Scan(&gross, &birth); err != nil {
		t.Fatalf("probe PII fixture: %v", err)
	}
	if gross == nil || *gross != 120000 {
		t.Errorf("fixture precondition: salary must be stored (want 120000), got %v", gross)
	}
	if birth == nil {
		t.Error("fixture precondition: birth_date must be stored")
	}

	// The snippet the adapter returned carries ONLY the four D12 fields.
	if got.Candidate.UserID != f.userC1 {
		t.Errorf("Candidate.UserID: want %v, got %v", f.userC1, got.Candidate.UserID)
	}
	if got.Candidate.FullName != "App Candidate One" {
		t.Errorf("Candidate.FullName: want %q, got %q", "App Candidate One", got.Candidate.FullName)
	}
	if got.Candidate.ProfessionalTitle == nil || *got.Candidate.ProfessionalTitle != "Senior Go Engineer" {
		t.Errorf("Candidate.ProfessionalTitle: want %q, got %v", "Senior Go Engineer", got.Candidate.ProfessionalTitle)
	}
	if got.Candidate.YearsOfExperience == nil || *got.Candidate.YearsOfExperience != 7 {
		t.Errorf("Candidate.YearsOfExperience: want 7, got %v", got.Candidate.YearsOfExperience)
	}
}

// TestGetByID_CrossCompany404 — spec scenario S78: a recruiter of company B
// asking for an application owned by company A gets the same 404 shape as a
// non-existent id (no existence leak).
func TestGetByID_CrossCompany404(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	appID := uuid.New()
	seedApplication(ctx, t, f, appID, f.jobPublished, f.userC1)

	_, err := f.repo.GetByID(ctx, appID, f.jobPublished, f.coActive2)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound, got %v", err)
	}
}

// TestGetByID_MismatchedJobID404 — spec scenario S79: the application's
// job_id does not match the path's {jobId} → 404 (same shape as non-existent).
func TestGetByID_MismatchedJobID404(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	appID := uuid.New()
	seedApplication(ctx, t, f, appID, f.jobPublished, f.userC1)

	// jobPublished2 is owned by the same company but has no applications —
	// the (id, job_id, company_id) scope must still reject the pair.
	_, err := f.repo.GetByID(ctx, appID, f.jobPublished2, f.coActive1)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound, got %v", err)
	}
}

// TestGetByID_NonExistent404 — spec scenario S80.
func TestGetByID_NonExistent404(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	_, err := f.repo.GetByID(ctx, uuid.New(), f.jobPublished, f.coActive1)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound, got %v", err)
	}
}

// TestGetByID_SoftDeletedJobStillVisible — spec scenario S70 (detail half):
// soft-deleting the job does NOT hide its historical applications from the
// owning recruiter.
func TestGetByID_SoftDeletedJobStillVisible(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	appID := uuid.New()
	seedApplication(ctx, t, f, appID, f.jobSoftDeleted, f.userC1)

	got, err := f.repo.GetByID(ctx, appID, f.jobSoftDeleted, f.coActive1)
	if err != nil {
		t.Fatalf("GetByID(soft-deleted job): %v", err)
	}
	if got.ID != appID {
		t.Errorf("ID: want %v, got %v", appID, got.ID)
	}
	if got.Status != applicationsvalueobjects.Submitted {
		t.Errorf("Status: want Submitted, got %v", got.Status)
	}
}

// TestGetByID_CandidateWithoutProfile — spec scenario S82: the LEFT JOIN
// yields SQL NULL for the missing candidate_profiles row, so the snippet
// renders the users fields and nil professional_title / years_of_experience.
func TestGetByID_CandidateWithoutProfile(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	appID := uuid.New()
	seedApplication(ctx, t, f, appID, f.jobPublished, f.userC2)

	got, err := f.repo.GetByID(ctx, appID, f.jobPublished, f.coActive1)
	if err != nil {
		t.Fatalf("GetByID(candidate without profile): %v", err)
	}
	if got.Candidate.UserID != f.userC2 {
		t.Errorf("Candidate.UserID: want %v, got %v", f.userC2, got.Candidate.UserID)
	}
	if got.Candidate.FullName != "App Candidate Two" {
		t.Errorf("Candidate.FullName: want %q, got %q", "App Candidate Two", got.Candidate.FullName)
	}
	if got.Candidate.ProfessionalTitle != nil {
		t.Errorf("Candidate.ProfessionalTitle: want nil (LEFT JOIN miss), got %v", *got.Candidate.ProfessionalTitle)
	}
	if got.Candidate.YearsOfExperience != nil {
		t.Errorf("Candidate.YearsOfExperience: want nil (LEFT JOIN miss), got %v", *got.Candidate.YearsOfExperience)
	}
}

// --- ListByJob (design D5) ------------------------------------------------

// TestListByJob_OwnCompanyEmpty — spec scenario S66: an own-company job with
// zero applications is `200 []` — a NON-NIL empty slice (the scope check
// passed; only the list is empty).
func TestListByJob_OwnCompanyEmpty(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	got, err := f.repo.ListByJob(ctx, f.jobPublished, f.coActive1)
	if err != nil {
		t.Fatalf("ListByJob(own, empty): %v", err)
	}
	if got == nil {
		t.Error("want non-nil empty slice (JSON [] not null)")
	}
	if len(got) != 0 {
		t.Errorf("want 0 rows, got %d", len(got))
	}
}

// TestListByJob_WithRowsDescOrder — spec scenario S61: applications on the
// same own-company job come back ordered created_at DESC, each carrying the
// PII-minimized candidate snippet.
func TestListByJob_WithRowsDescOrder(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	appOld := uuid.New() // userC1 applied first
	appMid := uuid.New() // userC2
	appNew := uuid.New() // userC3 applied last
	seedApplicationAt(ctx, t, f, appOld, f.jobPublished, f.userC1, "submitted", base)
	seedApplicationAt(ctx, t, f, appMid, f.jobPublished, f.userC2, "submitted", base.Add(time.Hour))
	seedApplicationAt(ctx, t, f, appNew, f.jobPublished, f.userC3, "submitted", base.Add(2*time.Hour))

	got, err := f.repo.ListByJob(ctx, f.jobPublished, f.coActive1)
	if err != nil {
		t.Fatalf("ListByJob(own, populated): %v", err)
	}
	want := []uuid.UUID{appNew, appMid, appOld}
	if len(got) != len(want) {
		t.Fatalf("want %d rows, got %d", len(want), len(got))
	}
	for i := range want {
		if got[i].ID != want[i] {
			t.Errorf("row %d: want id %v, got %v", i, want[i], got[i].ID)
		}
	}

	// The newest row belongs to userC1 (has a profile) — spot-check the
	// snippet projection.
	if got[2].Candidate.ProfessionalTitle == nil || *got[2].Candidate.ProfessionalTitle != "Senior Go Engineer" {
		t.Errorf("oldest row snippet: want professional_title %q, got %v", "Senior Go Engineer", got[2].Candidate.ProfessionalTitle)
	}
}

// TestListByJob_CrossCompany404 — spec scenario S67: a recruiter of company
// B listing a job owned by company A gets ErrApplicationNotFound (the
// two-step scope check, D5) — identical shape to a non-existent job.
func TestListByJob_CrossCompany404(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	_, err := f.repo.ListByJob(ctx, f.jobPublished, f.coActive2)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound, got %v", err)
	}
}

// TestListByJob_NonExistent404 — spec scenario S68.
func TestListByJob_NonExistent404(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	_, err := f.repo.ListByJob(ctx, uuid.New(), f.coActive1)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound, got %v", err)
	}
}

// TestListByJob_SoftDeletedVisible — spec scenario S70: the scope check
// (GetJobForApplicationsScope) has no deleted_at filter, so a soft-deleted
// job's applications remain recruiter-visible.
func TestListByJob_SoftDeletedVisible(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	app1 := uuid.New()
	app2 := uuid.New()
	seedApplication(ctx, t, f, app1, f.jobSoftDeleted, f.userC1)
	seedApplication(ctx, t, f, app2, f.jobSoftDeleted, f.userC2)

	got, err := f.repo.ListByJob(ctx, f.jobSoftDeleted, f.coActive1)
	if err != nil {
		t.Fatalf("ListByJob(soft-deleted job): %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 rows, got %d", len(got))
	}
	ids := map[uuid.UUID]bool{got[0].ID: true, got[1].ID: true}
	if !ids[app1] || !ids[app2] {
		t.Errorf("soft-delete must not hide history: want ids {%v %v}, got %v %v", app1, app2, got[0].ID, got[1].ID)
	}
}

// TestListByJob_Cap100 — spec scenario S69: 105 applications on an own-
// company job → exactly the 100 most recent (the 5 oldest are silently
// omitted; no pagination in this slice).
func TestListByJob_Cap100(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	users := seedBulkCandidates(ctx, t, f, "app-recruiter-cap", 105)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	appIDs := make([]uuid.UUID, 0, len(users))
	for i, userID := range users {
		appID := uuid.New()
		ts := base.Add(time.Duration(i) * time.Minute) // oldest first
		if _, err := f.pool.Exec(ctx,
			`INSERT INTO applications (id, job_id, candidate_id, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $4)`,
			appID, f.jobPublished2, userID, ts,
		); err != nil {
			t.Fatalf("seed cap application %d: %v", i, err)
		}
		appIDs = append(appIDs, appID)
	}

	got, err := f.repo.ListByJob(ctx, f.jobPublished2, f.coActive1)
	if err != nil {
		t.Fatalf("ListByJob(cap): %v", err)
	}
	if len(got) != 100 {
		t.Fatalf("want 100 rows (hard cap), got %d", len(got))
	}
	// Newest first: appIDs[104] is the most recent, appIDs[5] the oldest
	// one that still fits the cap; the first 5 are excluded.
	if got[0].ID != appIDs[104] {
		t.Errorf("got[0]: want newest %v, got %v", appIDs[104], got[0].ID)
	}
	if got[99].ID != appIDs[5] {
		t.Errorf("got[99]: want %v (oldest within cap), got %v", appIDs[5], got[99].ID)
	}
	for _, item := range got {
		for i := 0; i < 5; i++ {
			if item.ID == appIDs[i] {
				t.Errorf("the 5 oldest rows must be omitted by the cap; got %v", item.ID)
			}
		}
	}
}

// --- ListByCandidate ------------------------------------------------------

// TestListByCandidate_OwnRowsDesc — spec scenarios S52 + S53: the caller's
// own applications only, ordered created_at DESC, with the thin job summary.
func TestListByCandidate_OwnRowsDesc(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	// userC1's three applications, oldest → newest.
	seedApplicationAt(ctx, t, f, uuid.New(), f.jobPublished, f.userC1, "submitted", base)
	seedApplicationAt(ctx, t, f, uuid.New(), f.jobPublished2, f.userC1, "submitted", base.Add(time.Hour))
	seedApplicationAt(ctx, t, f, uuid.New(), f.jobForeign, f.userC1, "submitted", base.Add(2*time.Hour))
	// userC2's application on a DIFFERENT job must NOT appear in C1's list.
	seedApplication(ctx, t, f, uuid.New(), f.jobPublished3, f.userC2)

	got, err := f.repo.ListByCandidate(ctx, f.userC1)
	if err != nil {
		t.Fatalf("ListByCandidate: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 rows (only the caller's), got %d", len(got))
	}
	// Newest first: jobForeign → jobPublished2 → jobPublished.
	if got[0].Job.ID != f.jobForeign {
		t.Errorf("got[0]: want job %v, got %v", f.jobForeign, got[0].Job.ID)
	}
	if got[1].Job.ID != f.jobPublished2 {
		t.Errorf("got[1]: want job %v, got %v", f.jobPublished2, got[1].Job.ID)
	}
	if got[2].Job.ID != f.jobPublished {
		t.Errorf("got[2]: want job %v, got %v", f.jobPublished, got[2].Job.ID)
	}

	// Job summary projection (title + owning company).
	if got[0].Job.Title != "App Foreign Engineer" {
		t.Errorf("got[0].Job.Title: want %q, got %q", "App Foreign Engineer", got[0].Job.Title)
	}
	if got[0].Job.CompanyID != f.coActive2 {
		t.Errorf("got[0].Job.CompanyID: want %v, got %v", f.coActive2, got[0].Job.CompanyID)
	}
	if got[0].Job.CompanyName != "App Active Two SA" {
		t.Errorf("got[0].Job.CompanyName: want %q, got %q", "App Active Two SA", got[0].Job.CompanyName)
	}
}

// TestListByCandidate_EmptyNonNil — spec scenario S55: a candidate with no
// applications gets a non-nil empty slice.
func TestListByCandidate_EmptyNonNil(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	got, err := f.repo.ListByCandidate(ctx, f.userC3)
	if err != nil {
		t.Fatalf("ListByCandidate(empty): %v", err)
	}
	if got == nil {
		t.Error("want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("want 0 rows, got %d", len(got))
	}
}

// TestListByCandidate_SoftDeletedJobHistoryPreserved — spec scenario S54:
// the candidate's own history survives the job's soft-delete (no deleted_at
// redaction in ListMyApplications).
func TestListByCandidate_SoftDeletedJobHistoryPreserved(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedApplication(ctx, t, f, uuid.New(), f.jobSoftDeleted, f.userC1)

	got, err := f.repo.ListByCandidate(ctx, f.userC1)
	if err != nil {
		t.Fatalf("ListByCandidate(soft-deleted job): %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 row, got %d", len(got))
	}
	if got[0].Job.ID != f.jobSoftDeleted {
		t.Errorf("Job.ID: want %v, got %v", f.jobSoftDeleted, got[0].Job.ID)
	}
	if got[0].Job.Title != "App Deleted Engineer" {
		t.Errorf("Job.Title: want %q, got %q", "App Deleted Engineer", got[0].Job.Title)
	}
	if got[0].Job.CompanyID != f.coActive1 {
		t.Errorf("Job.CompanyID: want %v, got %v", f.coActive1, got[0].Job.CompanyID)
	}
}

// TestListByCandidate_Cap100 — spec scenario S56: 105 applications across
// 105 jobs → exactly the 100 most recent.
func TestListByCandidate_Cap100(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	jobs := seedBulkJobs(ctx, t, f, f.coActive1, "app-candidate-cap", 105)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	appIDs := make([]uuid.UUID, 0, len(jobs))
	for i, jobID := range jobs {
		appID := uuid.New()
		ts := base.Add(time.Duration(i) * time.Minute) // oldest first
		if _, err := f.pool.Exec(ctx,
			`INSERT INTO applications (id, job_id, candidate_id, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $4)`,
			appID, jobID, f.userC1, ts,
		); err != nil {
			t.Fatalf("seed cap application %d: %v", i, err)
		}
		appIDs = append(appIDs, appID)
	}

	got, err := f.repo.ListByCandidate(ctx, f.userC1)
	if err != nil {
		t.Fatalf("ListByCandidate(cap): %v", err)
	}
	if len(got) != 100 {
		t.Fatalf("want 100 rows (hard cap), got %d", len(got))
	}
	if got[0].Job.ID != jobs[104] {
		t.Errorf("got[0]: want newest job %v, got %v", jobs[104], got[0].Job.ID)
	}
	if got[99].Job.ID != jobs[5] {
		t.Errorf("got[99]: want %v (oldest within cap), got %v", jobs[5], got[99].Job.ID)
	}
	for _, item := range got {
		for i := 0; i < 5; i++ {
			if item.Job.ID == jobs[i] {
				t.Errorf("the 5 oldest rows must be omitted by the cap; got job %v", item.Job.ID)
			}
		}
	}
}

// --- Transition (design D3 / D4) ------------------------------------------

// TestTransition_SubmittedToInReview — spec scenario S83: submitted →
// in_review succeeds and returns the updated row with a FRESH updated_at
// (the seeded updated_at is deliberately old, so the advance is observable —
// Postgres now() is transaction-time, so the update cannot be compared
// against a same-transaction seed).
func TestTransition_SubmittedToInReview(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobPublished, f.userC1, "submitted", seedTime)

	got, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
		transitionedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished,
			applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview),
	)
	if err != nil {
		t.Fatalf("Transition(submitted→in_review): %v", err)
	}
	if got.ID != appID {
		t.Errorf("ID: want %v, got %v", appID, got.ID)
	}
	if got.Status != applicationsvalueobjects.InReview {
		t.Errorf("Status: want InReview, got %v", got.Status)
	}
	if !got.UpdatedAt.After(seedTime) {
		t.Errorf("UpdatedAt: want advanced past %v, got %v", seedTime, got.UpdatedAt)
	}

	var status string
	if err := f.pool.QueryRow(ctx,
		`SELECT status FROM applications WHERE id = $1`, appID,
	).Scan(&status); err != nil {
		t.Fatalf("raw read: %v", err)
	}
	if status != "in_review" {
		t.Errorf("raw status: want in_review, got %q", status)
	}
}

// TestTransition_InReviewToRejected — spec scenario S84: in_review →
// rejected succeeds and is terminal.
func TestTransition_InReviewToRejected(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobPublished, f.userC2, "in_review", seedTime)

	got, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.InReview, applicationsvalueobjects.Rejected,
		transitionedAuditEvent(uuid.New(), appID, f.userC2, f.jobPublished,
			applicationsvalueobjects.InReview, applicationsvalueobjects.Rejected),
	)
	if err != nil {
		t.Fatalf("Transition(in_review→rejected): %v", err)
	}
	if got.Status != applicationsvalueobjects.Rejected {
		t.Errorf("Status: want Rejected, got %v", got.Status)
	}
	if !got.UpdatedAt.After(seedTime) {
		t.Errorf("UpdatedAt: want advanced past %v, got %v", seedTime, got.UpdatedAt)
	}
}

// TestTransition_InReviewToHired — spec scenario S85: in_review → hired
// succeeds and is terminal.
func TestTransition_InReviewToHired(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobPublished, f.userC3, "in_review", seedTime)

	got, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.InReview, applicationsvalueobjects.Hired,
		transitionedAuditEvent(uuid.New(), appID, f.userC3, f.jobPublished,
			applicationsvalueobjects.InReview, applicationsvalueobjects.Hired),
	)
	if err != nil {
		t.Fatalf("Transition(in_review→hired): %v", err)
	}
	if got.Status != applicationsvalueobjects.Hired {
		t.Errorf("Status: want Hired, got %v", got.Status)
	}
}

// TestTransition_LostRaceNotFound — spec scenarios S98 + S99: two writers
// transition the same row from 'submitted'; the first wins and the second's
// WHERE status='submitted' guard matches 0 rows → ErrApplicationNotFound
// (no CAS — the 404 is the lost-race signal). The row stays readable via a
// re-fetch, which returns the winner's state (S99).
func TestTransition_LostRaceNotFound(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobPublished, f.userC1, "submitted", seedTime)

	// Writer 1 wins the race.
	if _, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
		transitionedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished,
			applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview),
	); err != nil {
		t.Fatalf("first transition: %v", err)
	}

	// Writer 2 holds a stale view (from_status='submitted'); the guard sees
	// the now-in_review row → 0 rows → ErrApplicationNotFound. The loser's
	// event must NOT be appended (the append happens only after a successful
	// UPDATE, strictly before commit).
	_, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
		transitionedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished,
			applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview),
	)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound (lost race), got %v", err)
	}

	// Exactly ONE audit row: the winner's Transitioned event only.
	if n := countAuditRowsForEntity(ctx, t, f, appID); n != 1 {
		t.Errorf("lost-race transition must not append an event; want 1 audit row, got %d", n)
	}

	// The row is unchanged AND still readable — the recruiter re-fetches and
	// sees the winner's state (S99).
	got, err := f.repo.GetByID(ctx, appID, f.jobPublished, f.coActive1)
	if err != nil {
		t.Fatalf("re-fetch after lost race: %v", err)
	}
	if got.Status != applicationsvalueobjects.InReview {
		t.Errorf("re-fetched Status: want InReview, got %v", got.Status)
	}
}

// TestTransition_CrossCompany404 — spec scenario S100: a recruiter of
// company B transitioning an application on company A's job → 0 rows →
// ErrApplicationNotFound and the row's status is unchanged.
func TestTransition_CrossCompany404(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobPublished, f.userC1, "submitted", seedTime)

	_, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive2,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
		transitionedAuditEvent(uuid.New(), appID, f.userC1, f.jobPublished,
			applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview),
	)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound, got %v", err)
	}

	if n := countAuditRowsForEntity(ctx, t, f, appID); n != 0 {
		t.Errorf("cross-company transition must not append an event; got %d audit rows", n)
	}

	var status string
	if err := f.pool.QueryRow(ctx,
		`SELECT status FROM applications WHERE id = $1`, appID,
	).Scan(&status); err != nil {
		t.Fatalf("raw read: %v", err)
	}
	if status != "submitted" {
		t.Errorf("cross-company transition must not mutate: want status submitted, got %q", status)
	}
}

// TestTransition_SoftDeletedJobStillTransitionable — spec scenario S72: the
// soft-delete of the parent job does NOT lock the application's status —
// recruiters keep closing out historical pipelines.
func TestTransition_SoftDeletedJobStillTransitionable(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	seedTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	appID := uuid.New()
	seedApplicationAt(ctx, t, f, appID, f.jobSoftDeleted, f.userC1, "in_review", seedTime)

	got, err := f.repo.Transition(ctx, appID, f.jobSoftDeleted, f.coActive1,
		applicationsvalueobjects.InReview, applicationsvalueobjects.Hired,
		transitionedAuditEvent(uuid.New(), appID, f.userC1, f.jobSoftDeleted,
			applicationsvalueobjects.InReview, applicationsvalueobjects.Hired),
	)
	if err != nil {
		t.Fatalf("Transition(soft-deleted job): %v", err)
	}
	if got.Status != applicationsvalueobjects.Hired {
		t.Errorf("Status: want Hired, got %v", got.Status)
	}
}
