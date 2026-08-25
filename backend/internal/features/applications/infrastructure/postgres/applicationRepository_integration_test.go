//go:build integration

// Runtime coverage for the applications ADAPTER against a live PostgreSQL.
//
// The unit tests in `applicationRepository_test.go` cover the deterministic
// Go helpers (`mapCreateError`, `mapTransitionError`, `mapGetError`, the
// builders, the `to*` mappers) with a stub `Querier`; they cannot cover what
// actually decides the slice's behavior — the SQL in
// `db/queries/applications.sql` (design D1/D3/D5) plus the migrated schema
// (00010). Everything asserted here is what only Postgres can prove:
//
//   - Create atomic eligibility gate (D1): published + deleted_at IS NULL +
//     active company yields a row; draft / closed / soft-deleted /
//     suspended-company / pending_verification-company / non-existent job
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
// Isolation: every test runs inside a transaction that is ALWAYS rolled
// back. The fixture seeds its own companies/jobs/users/candidate_profiles
// universe (fixed UUIDs under 01900000-…) and DELETEs every `applications`
// row inside that transaction so assertions can be exact ID lists without
// fuzzy counts. Tests do not call t.Parallel(), so the fixture transactions
// never contend with each other or with the migration tests.
//
// Skips (never fails) when DATABASE_URL is unset, via the package helper
// `skipIfNoDatabaseForApplications` from migration_00010_test.go. Assumes
// `make db-migrate` has applied 00001..00010; the fixture re-applies its own
// seed so it also works right after a down/up migration test.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/repositories"
	applicationsvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

	// Jobs. All are published + deleted_at IS NULL unless the name says
	// otherwise; every job's owning company is appCoActive1 unless stated.
	appJobPublished   = uuid.MustParse("01900000-0000-7000-8000-0000000000b1") // published, active co
	appJobDraft       = uuid.MustParse("01900000-0000-7000-8000-0000000000b2") // draft
	appJobClosed      = uuid.MustParse("01900000-0000-7000-8000-0000000000b3") // closed
	appJobSoftDeleted = uuid.MustParse("01900000-0000-7000-8000-0000000000b4") // published + deleted_at
	appJobForeign     = uuid.MustParse("01900000-0000-7000-8000-0000000000b5") // published, appCoActive2
	appJobSuspendedCo = uuid.MustParse("01900000-0000-7000-8000-0000000000b6") // published, appCoSuspended
	appJobPendingCo   = uuid.MustParse("01900000-0000-7000-8000-0000000000b7") // published, appCoPending
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
     NULL, NULL, 'MXN', '2026-07-08T12:00:00Z', NULL, now(), now())
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

// applicationFixture is the per-test fixture handle: the adapter bound to the
// rolled-back transaction plus the fixed UUIDs the assertions reference.
type applicationFixture struct {
	repo *ApplicationRepository
	tx   pgx.Tx

	coActive1      uuid.UUID
	coActive2      uuid.UUID
	coSuspended    uuid.UUID
	coPending      uuid.UUID
	jobPublished   uuid.UUID
	jobDraft       uuid.UUID
	jobClosed      uuid.UUID
	jobSoftDeleted uuid.UUID
	jobForeign     uuid.UUID
	jobSuspendedCo uuid.UUID
	jobPendingCo   uuid.UUID
	jobPublished2  uuid.UUID
	jobPublished3  uuid.UUID
	userC1         uuid.UUID
	userC2         uuid.UUID
	userC3         uuid.UUID
}

// setupApplicationFixture is the SetupTest-style helper every test here
// starts with. It skips without a database, opens a transaction that is
// ALWAYS rolled back, probes the migrated schema, applies the fixture seed,
// and DELETEs every pre-existing `applications` row inside the transaction
// so assertions can be exact ID lists instead of fuzzy counts (the jobs /
// membership suites use the same destructive-but-rolled-back pattern).
//
// Returns the test context (30s timeout) and the fixture handle.
func setupApplicationFixture(t *testing.T) (context.Context, *applicationFixture) {
	t.Helper()

	pool := skipIfNoDatabaseForApplications(t)
	t.Cleanup(pool.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	// Rollback unconditionally: the fixture is destructive by design (it
	// DELETEs applications rows) and must never touch committed state.
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	requireApplicationsSchema(ctx, t, tx)

	if _, err := tx.Exec(ctx, applicationFixtureSQL); err != nil {
		t.Fatalf("apply applications fixture: %v", err)
	}

	// Keep only rows this test seeds. Safe: we are inside the rollback.
	if _, err := tx.Exec(ctx, `DELETE FROM applications`); err != nil {
		t.Fatalf("prune applications: %v", err)
	}

	f := &applicationFixture{
		repo:           NewApplicationRepository(db.New(tx)),
		tx:             tx,
		coActive1:      appCoActive1,
		coActive2:      appCoActive2,
		coSuspended:    appCoSuspended,
		coPending:      appCoPending,
		jobPublished:   appJobPublished,
		jobDraft:       appJobDraft,
		jobClosed:      appJobClosed,
		jobSoftDeleted: appJobSoftDeleted,
		jobForeign:     appJobForeign,
		jobSuspendedCo: appJobSuspendedCo,
		jobPendingCo:   appJobPendingCo,
		jobPublished2:  appJobPublished2,
		jobPublished3:  appJobPublished3,
		userC1:         appUserC1,
		userC2:         appUserC2,
		userC3:         appUserC3,
	}
	return ctx, f
}

// requireApplicationsSchema fails loudly (rather than silently passing) when
// the migrations have not been applied — a green run against a missing table
// would be a false negative for every scenario in this file.
func requireApplicationsSchema(ctx context.Context, t *testing.T, tx pgx.Tx) {
	t.Helper()
	for _, table := range []string{"applications", "jobs", "companies", "users", "candidate_profiles"} {
		var hasTable bool
		if err := tx.QueryRow(ctx,
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
// the code under test, so seeding through Create would re-enter it.
func seedApplication(ctx context.Context, t *testing.T, tx pgx.Tx, id, jobID, candidateID uuid.UUID) {
	t.Helper()
	if _, err := tx.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id) VALUES ($1, $2, $3)`,
		id, jobID, candidateID,
	); err != nil {
		t.Fatalf("seed application %s: %v", id, err)
	}
}

// seedApplicationAt inserts an application row with an explicit status and
// explicit created_at/updated_at. The explicit timestamps let the ordering
// and updated_at-advance assertions be deterministic; the explicit status
// lets the transition tests start from in_review without going through the
// use case. The transition tests pass a deliberately OLD timestamp so the
// `updated_at = now()` write (transaction-time) is provably AFTER it.
func seedApplicationAt(ctx context.Context, t *testing.T, tx pgx.Tx, id, jobID, candidateID uuid.UUID, status string, at time.Time) {
	t.Helper()
	if _, err := tx.Exec(ctx,
		`INSERT INTO applications (id, job_id, candidate_id, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $5)`,
		id, jobID, candidateID, status, at,
	); err != nil {
		t.Fatalf("seed application %s (status=%s): %v", id, status, err)
	}
}

// seedBulkCandidates inserts n fresh candidate users and returns their ids.
// Used by the LIMIT-100 tests, which need more distinct (job, candidate)
// pairs than the fixed fixture universe provides.
func seedBulkCandidates(ctx context.Context, t *testing.T, tx pgx.Tx, prefix string, n int) []uuid.UUID {
	t.Helper()
	ids := make([]uuid.UUID, 0, n)
	for i := 0; i < n; i++ {
		id := uuid.New()
		sub := fmt.Sprintf("%s-%d", prefix, i)
		if _, err := tx.Exec(ctx,
			`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
			 VALUES ($1, $2, $3, $4, 'candidate')`,
			id, sub, sub+"@example.com", "Bulk Candidate",
		); err != nil {
			t.Fatalf("seed bulk candidate %d: %v", i, err)
		}
		ids = append(ids, id)
	}
	return ids
}

// seedBulkJobs inserts n published jobs owned by companyID and returns their
// ids in insertion order. published_at is required by
// jobs_published_integrity_check for status='published' rows.
func seedBulkJobs(ctx context.Context, t *testing.T, tx pgx.Tx, companyID uuid.UUID, prefix string, n int) []uuid.UUID {
	t.Helper()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ids := make([]uuid.UUID, 0, n)
	for i := 0; i < n; i++ {
		jobID := uuid.New()
		if _, err := tx.Exec(ctx,
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
		ids = append(ids, jobID)
	}
	return ids
}

// countApplications probes the number of rows matching (job_id, candidate_id).
func countApplications(ctx context.Context, t *testing.T, tx pgx.Tx, jobID, candidateID uuid.UUID) int {
	t.Helper()
	var n int
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM applications WHERE job_id = $1 AND candidate_id = $2`,
		jobID, candidateID,
	).Scan(&n); err != nil {
		t.Fatalf("count applications: %v", err)
	}
	return n
}

// rowExists probes whether an application row with the given id exists.
func rowExists(ctx context.Context, t *testing.T, tx pgx.Tx, id uuid.UUID) bool {
	t.Helper()
	var exists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM applications WHERE id = $1)`, id,
	).Scan(&exists); err != nil {
		t.Fatalf("probe application row %s: %v", id, err)
	}
	return exists
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
	})
	if err != nil {
		t.Fatalf("Create(no optionals): %v", err)
	}
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
	if err := f.tx.QueryRow(ctx,
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
	cover := "I am a great fit for this role."
	appIDB := uuid.New()
	gotB, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appIDB,
		JobID:       f.jobPublished2,
		CandidateID: f.userC1,
		Source:      &src,
		CoverLetter: &cover,
	})
	if err != nil {
		t.Fatalf("Create(with optionals): %v", err)
	}
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
	if err := f.tx.QueryRow(ctx,
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
		{"non-existent job", uuid.New()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			appID := uuid.New()
			_, err := f.repo.Create(ctx, repositories.CreateParams{
				ID:          appID,
				JobID:       tc.jobID,
				CandidateID: f.userC2,
			})
			if !errors.Is(err, entities.ErrJobNotApplicable) {
				t.Errorf("err: want ErrJobNotApplicable, got %v", err)
			}
			if rowExists(ctx, t, f.tx, appID) {
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
	}); err != nil {
		t.Fatalf("first create: %v", err)
	}

	// Verify exactly one row BEFORE the duplicate attempt. The second Create
	// below violates the UNIQUE(job_id, candidate_id) guard, which PostgreSQL
	// aborts the shared fixture transaction (SQLSTATE 25P02 on any later query
	// on the same tx). Counting after the violation would fail on the aborted
	// tx, not on the actual invariant — so we assert the count first.
	if n := countApplications(ctx, t, f.tx, f.jobPublished, f.userC1); n != 1 {
		t.Errorf("row count after first create: want 1, got %d", n)
	}

	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          uuid.New(),
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	})
	if !errors.Is(err, entities.ErrAlreadyApplied) {
		t.Errorf("err: want ErrAlreadyApplied (23505), got %v", err)
	}
}

// TestCreate_CrossJobAllowed — spec scenario S39: the UNIQUE is per
// (job_id, candidate_id), so the same candidate may apply to a different
// published job.
func TestCreate_CrossJobAllowed(t *testing.T) {
	ctx, f := setupApplicationFixture(t)

	for _, jobID := range []uuid.UUID{f.jobPublished, f.jobPublished2} {
		if _, err := f.repo.Create(ctx, repositories.CreateParams{
			ID:          uuid.New(),
			JobID:       jobID,
			CandidateID: f.userC1,
		}); err != nil {
			t.Fatalf("create on job %v: %v", jobID, err)
		}
	}

	var n int
	if err := f.tx.QueryRow(ctx,
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
	if err := f.tx.QueryRow(ctx,
		`SELECT status FROM companies WHERE id = $1`, f.coActive1,
	).Scan(&status); err != nil {
		t.Fatalf("read company status: %v", err)
	}
	if status != "active" {
		t.Fatalf("precondition: company must start active, got %q", status)
	}

	// Suspend in-transaction — simulates the state change between the
	// middleware-level gate and the INSERT arriving at the SQL layer.
	if _, err := f.tx.Exec(ctx,
		`UPDATE companies SET status = 'suspended' WHERE id = $1`, f.coActive1,
	); err != nil {
		t.Fatalf("suspend company mid-transaction: %v", err)
	}

	appID := uuid.New()
	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          appID,
		JobID:       f.jobPublished,
		CandidateID: f.userC1,
	})
	if !errors.Is(err, entities.ErrJobNotApplicable) {
		t.Errorf("err: want ErrJobNotApplicable (atomic gate wins), got %v", err)
	}
	if rowExists(ctx, t, f.tx, appID) {
		t.Error("atomic gate miss must not insert a row")
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

	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          uuid.New(),
		JobID:       f.jobPublished,
		CandidateID: uuid.New(), // no users row
	})
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
	_, err := f.repo.Create(ctx, repositories.CreateParams{
		ID:          uuid.New(),
		JobID:       f.jobPublished,
		CandidateID: f.userC2,
		Source:      &badSource,
	})
	if !errors.Is(err, applicationsvalueobjects.ErrInvalidStatusTransition) {
		t.Errorf("err: want ErrInvalidStatusTransition (23514), got %v", err)
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
	seedApplication(ctx, t, f.tx, appID, f.jobPublished, f.userC1)

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
	if err := f.tx.QueryRow(ctx,
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
	seedApplication(ctx, t, f.tx, appID, f.jobPublished, f.userC1)

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
	seedApplication(ctx, t, f.tx, appID, f.jobPublished, f.userC1)

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
	seedApplication(ctx, t, f.tx, appID, f.jobSoftDeleted, f.userC1)

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
	seedApplication(ctx, t, f.tx, appID, f.jobPublished, f.userC2)

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
	seedApplicationAt(ctx, t, f.tx, appOld, f.jobPublished, f.userC1, "submitted", base)
	seedApplicationAt(ctx, t, f.tx, appMid, f.jobPublished, f.userC2, "submitted", base.Add(time.Hour))
	seedApplicationAt(ctx, t, f.tx, appNew, f.jobPublished, f.userC3, "submitted", base.Add(2*time.Hour))

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
	seedApplication(ctx, t, f.tx, app1, f.jobSoftDeleted, f.userC1)
	seedApplication(ctx, t, f.tx, app2, f.jobSoftDeleted, f.userC2)

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

	users := seedBulkCandidates(ctx, t, f.tx, "app-recruiter-cap", 105)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	appIDs := make([]uuid.UUID, 0, len(users))
	for i, userID := range users {
		appID := uuid.New()
		ts := base.Add(time.Duration(i) * time.Minute) // oldest first
		if _, err := f.tx.Exec(ctx,
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
	seedApplicationAt(ctx, t, f.tx, uuid.New(), f.jobPublished, f.userC1, "submitted", base)
	seedApplicationAt(ctx, t, f.tx, uuid.New(), f.jobPublished2, f.userC1, "submitted", base.Add(time.Hour))
	seedApplicationAt(ctx, t, f.tx, uuid.New(), f.jobForeign, f.userC1, "submitted", base.Add(2*time.Hour))
	// userC2's application on a DIFFERENT job must NOT appear in C1's list.
	seedApplication(ctx, t, f.tx, uuid.New(), f.jobPublished3, f.userC2)

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

	seedApplication(ctx, t, f.tx, uuid.New(), f.jobSoftDeleted, f.userC1)

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

	jobs := seedBulkJobs(ctx, t, f.tx, f.coActive1, "app-candidate-cap", 105)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	appIDs := make([]uuid.UUID, 0, len(jobs))
	for i, jobID := range jobs {
		appID := uuid.New()
		ts := base.Add(time.Duration(i) * time.Minute) // oldest first
		if _, err := f.tx.Exec(ctx,
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
	seedApplicationAt(ctx, t, f.tx, appID, f.jobPublished, f.userC1, "submitted", seedTime)

	got, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
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
	if err := f.tx.QueryRow(ctx,
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
	seedApplicationAt(ctx, t, f.tx, appID, f.jobPublished, f.userC2, "in_review", seedTime)

	got, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.InReview, applicationsvalueobjects.Rejected,
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
	seedApplicationAt(ctx, t, f.tx, appID, f.jobPublished, f.userC3, "in_review", seedTime)

	got, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.InReview, applicationsvalueobjects.Hired,
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
	seedApplicationAt(ctx, t, f.tx, appID, f.jobPublished, f.userC1, "submitted", seedTime)

	// Writer 1 wins the race.
	if _, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
	); err != nil {
		t.Fatalf("first transition: %v", err)
	}

	// Writer 2 holds a stale view (from_status='submitted'); the guard sees
	// the now-in_review row → 0 rows → ErrApplicationNotFound.
	_, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive1,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
	)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound (lost race), got %v", err)
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
	seedApplicationAt(ctx, t, f.tx, appID, f.jobPublished, f.userC1, "submitted", seedTime)

	_, err := f.repo.Transition(ctx, appID, f.jobPublished, f.coActive2,
		applicationsvalueobjects.Submitted, applicationsvalueobjects.InReview,
	)
	if !errors.Is(err, entities.ErrApplicationNotFound) {
		t.Errorf("err: want ErrApplicationNotFound, got %v", err)
	}

	var status string
	if err := f.tx.QueryRow(ctx,
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
	seedApplicationAt(ctx, t, f.tx, appID, f.jobSoftDeleted, f.userC1, "in_review", seedTime)

	got, err := f.repo.Transition(ctx, appID, f.jobSoftDeleted, f.coActive1,
		applicationsvalueobjects.InReview, applicationsvalueobjects.Hired,
	)
	if err != nil {
		t.Fatalf("Transition(soft-deleted job): %v", err)
	}
	if got.Status != applicationsvalueobjects.Hired {
		t.Errorf("Status: want Hired, got %v", got.Status)
	}
}
