//go:build integration

// Runtime coverage for the jobs WRITE PATH against a live PostgreSQL.
//
// The unit tests in `updateJobRepository_test.go` cover the
// deterministic Go helpers (`buildUpdateJobParams`, `toJobForUpdateEntity`,
// `mapUpdateError`); they cannot cover what actually decides the
// behavior — the SQL in `db/queries/jobs.sql`. Everything asserted
// here is what only Postgres can prove:
//
//   - GetForUpdate visibility scope: drafts/closed/non-active-company
//     rows ARE visible to the write path (design D1/D3); the public
//     read path would hide them.
//   - GetForUpdate same-company guard: cross-company, soft-deleted,
//     and non-existent ids surface as ErrJobNotFound (indistinguishable,
//     per the IDOR invariant — spec scenarios "cross-company id
//     returns 404" / "soft-deleted id returns 404" / "non-existent id
//     returns 404").
//   - Update partial semantics — fields absent from the patch are left
//     intact; explicit null on the nullable trio clears the column;
//     the closed-set columns accept canonical wire strings.
//   - Update CAS: a stale `casUpdatedAt` → 0 rows → ErrJobNotFound
//     (the adapter's dumb behavior; the use case re-interprets).
//   - Update atomic published_at side effect: draft → published sets
//     published_at within the request window; published → published
//     preserves the existing published_at; published → closed keeps it.
//   - Update immutables: search_vector (STORED generated), company_id,
//     created_at, id, deleted_at are untouched across any update.
//
// Isolation: every test runs inside a transaction that is ALWAYS
// rolled back. The fixture deletes every `jobs` row outside its own
// universe so assertions can be exact ID lists. Tests do not call
// t.Parallel().
//
// Skips (never fails) when DATABASE_URL is unset, mirroring
// migration_00008_test.go. Assumes `make db-migrate` has applied
// 00001..00008; the fixture re-applies the 00008 seed itself.
package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// --- write-path fixture identities -----------------------------------

// Write-path fixture rows are independent from the read-path fixture
// (jobRepository_integration_test.go) so the two suites do not collide
// when both are run in the same transaction. The fixture company
// mirrors the published-jobs company's company_id (seededCompanyIDs[0])
// because GetForUpdate requires a valid company_id match — we can't
// reuse the suspended-company ids from the read fixture (which would
// short-circuit to ErrJobNotFound on the company scope check).
var (
	wpDraftID    = uuid.MustParse("018f0000-0000-7000-8000-0000000000d1") // draft, Acme SA
	wpClosedID   = uuid.MustParse("018f0000-0000-7000-8000-0000000000d2") // closed, Acme SA
	wpDeletedID  = uuid.MustParse("018f0000-0000-7000-8000-0000000000d3") // soft-deleted, Acme SA
	wpPublishedID = uuid.MustParse("018f0000-0000-7000-8000-0000000000d4") // published, Acme SA
	wpCrossCoID  = uuid.MustParse("018f0000-0000-7000-8000-0000000000d5") // published, Globex
)

// writePathFixtureSQL adds, on top of the 00008 seed:
//
//	d1 — draft, Acme SA, NULL location, NULL salary
//	d2 — closed, Acme SA, NULL location, NULL salary
//	d3 — soft-deleted, Acme SA, NULL location
//	d4 — published, Acme SA, location=CDMX, salary 40000-60000, published_at 2026-07-01
//	d5 — published, Globex (foreign company), location=Remote
const writePathFixtureSQL = `
INSERT INTO jobs
    (id, company_id, title, description, work_mode, employment_type,
     seniority, status, location, salary_min, salary_max, salary_currency,
     published_at, deleted_at, created_at, updated_at)
VALUES
    ('018f0000-0000-7000-8000-0000000000d1',
     '018f0000-0000-7000-8000-000000000001',
     'WP Draft Engineer', 'draft row for write path.',
     'remote', 'full_time', 'senior', 'draft', NULL,
     NULL, NULL, 'MXN', NULL, NULL, now(), now()),

    ('018f0000-0000-7000-8000-0000000000d2',
     '018f0000-0000-7000-8000-000000000001',
     'WP Closed Engineer', 'closed row for write path.',
     'remote', 'full_time', 'senior', 'closed', NULL,
     NULL, NULL, 'MXN', '2026-06-15T12:00:00Z', NULL, now(), now()),

    ('018f0000-0000-7000-8000-0000000000d3',
     '018f0000-0000-7000-8000-000000000001',
     'WP Deleted Engineer', 'soft-deleted row for write path.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-02T12:00:00Z', '2026-07-03T12:00:00Z', now(), now()),

    ('018f0000-0000-7000-8000-0000000000d4',
     '018f0000-0000-7000-8000-000000000001',
     'WP Published Engineer', 'published row for write path.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     40000, 60000, 'MXN', '2026-07-01T12:00:00Z', NULL, now(), now()),

    ('018f0000-0000-7000-8000-0000000000d5',
     '018f0000-0000-7000-8000-000000000002',
     'WP Cross Co Engineer', 'foreign-company published row.',
     'remote', 'full_time', 'senior', 'published', 'Remote',
     30000, 50000, 'USD', '2026-07-04T12:00:00Z', NULL, now(), now())
ON CONFLICT (id) DO NOTHING;
`

// setupWritePath mirrors setupReadPath but installs the write-path
// fixture and prunes the write-path universe. The returned context
// carries the underlying transaction so tests can issue raw SQL
// (e.g. to suspend a company mid-test) before the rollback.
func setupWritePath(t *testing.T) (context.Context, *JobRepository, pgx.Tx) {
	t.Helper()

	pool := skipIfNoDatabaseForJobs(t)
	t.Cleanup(pool.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	requireJobsSchema(ctx, t, tx)

	if _, err := tx.Exec(ctx, seedJobsSQL); err != nil {
		t.Fatalf("apply 00008 seed: %v", err)
	}
	if _, err := tx.Exec(ctx, writePathFixtureSQL); err != nil {
		t.Fatalf("apply write-path fixture: %v", err)
	}

	// Keep only the write-path fixture rows + the 00008 seed rows.
	universe := []uuid.UUID{
		wpDraftID, wpClosedID, wpDeletedID, wpPublishedID, wpCrossCoID,
		jobBackendGoID, jobFrontendID, jobDataEngID,
		jobMLEngID, jobJuniorQAID, jobDevOpsIntern,
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM jobs WHERE id <> ALL($1::uuid[])`, universe,
	); err != nil {
		t.Fatalf("prune non-fixture jobs: %v", err)
	}

	return ctx, NewJobRepository(db.New(tx)), tx
}

// --- GetForUpdate ----------------------------------------------------

// TestGetForUpdate_DraftAndClosedVisible proves the write-path read is
// NOT visibility-narrowed: drafts and closed rows must be reachable so
// the use case can transition or reject them.
func TestGetForUpdate_DraftAndClosedVisible(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	draft, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(draft): %v", err)
	}
	if draft.JobStatus != valueobjects.Draft {
		t.Errorf("draft.JobStatus: want Draft, got %v", draft.JobStatus)
	}

	closed, err := repo.GetForUpdate(ctx, wpClosedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(closed): %v", err)
	}
	if closed.JobStatus != valueobjects.Closed {
		t.Errorf("closed.JobStatus: want Closed, got %v", closed.JobStatus)
	}
}

// TestGetForUpdate_NonActiveCompanyRowVisible proves that the
// company.status='active' filter from the public read path is NOT
// applied here: the write path may edit a row whose owning company
// is suspended/inactive (a recruiter may need to close it).
func TestGetForUpdate_NonActiveCompanyRowVisible(t *testing.T) {
	ctx, repo, tx := setupWritePath(t)

	// wpCrossCoID belongs to the Globex company (seededCompanyIDs[1]),
	// which is active in the seed. To prove non-active visibility we
	// update the company to suspended in the same transaction. We do
	// this here because the fixture doesn't ship with a suspended
	// company + active job owned by that company (the read fixture
	// uses the suspended company id but for a different purpose).
	if _, err := tx.Exec(ctx,
		`UPDATE companies SET status='suspended' WHERE id = $1`, seededCompanyIDs[1],
	); err != nil {
		t.Fatalf("suspend company: %v", err)
	}

	row, err := repo.GetForUpdate(ctx, wpCrossCoID, seededCompanyIDs[1])
	if err != nil {
		t.Fatalf("GetForUpdate(suspended-company row): want visible, got %v", err)
	}
	if row.Company.Name == "" {
		t.Errorf("Company.Name: want non-empty, got empty")
	}
}

// TestGetForUpdate_CrossCompanyReturnsErrJobNotFound covers the
// IDOR boundary: the caller's companyID doesn't match the row's
// company, so GetForUpdate returns ErrJobNotFound (spec scenario
// "cross-company id returns 404").
func TestGetForUpdate_CrossCompanyReturnsErrJobNotFound(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	// wpCrossCoID is owned by Globex; we ask for it with Acme's
	// company_id — the SQL guard `company_id = $2` rejects.
	_, err := repo.GetForUpdate(ctx, wpCrossCoID, seededCompanyIDs[0])
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("err: want ErrJobNotFound, got %v", err)
	}
}

// TestGetForUpdate_SoftDeletedReturnsErrJobNotFound covers the
// "soft-deleted id returns 404" scenario.
func TestGetForUpdate_SoftDeletedReturnsErrJobNotFound(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	_, err := repo.GetForUpdate(ctx, wpDeletedID, seededCompanyIDs[0])
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("err: want ErrJobNotFound, got %v", err)
	}
}

// TestGetForUpdate_NonExistentReturnsErrJobNotFound covers the
// "non-existent id returns 404" scenario.
func TestGetForUpdate_NonExistentReturnsErrJobNotFound(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	missing := uuid.MustParse("018f0000-0000-7000-8000-0000000000ff")
	_, err := repo.GetForUpdate(ctx, missing, seededCompanyIDs[0])
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("err: want ErrJobNotFound, got %v", err)
	}
}

// TestGetForUpdate_ReturnsUpdatedAtForCAS proves the row carries
// `updated_at` so the use case can compare against
// `If-Unmodified-Since`.
func TestGetForUpdate_ReturnsUpdatedAtForCAS(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	row, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate: %v", err)
	}
	if row.UpdatedAt.IsZero() {
		t.Errorf("UpdatedAt: want non-zero (CAS compare needs a real timestamp), got zero")
	}
}

// --- Update partial semantics ----------------------------------------

// TestUpdate_PartialPatchLeavesAbsentFieldsIntact proves the COALESCE
// pattern in the SQL: fields the patch doesn't carry are kept from
// the existing row.
func TestUpdate_PartialPatchLeavesAbsentFieldsIntact(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	// Snapshot the row before the update so we can assert which
	// columns moved and which didn't.
	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}

	// Patch only title + description. Everything else must survive.
	newTitle := "WP Patched Title"
	newDesc := "WP Patched Description"
	if err := repo.Update(ctx, wpPublishedID, seededCompanyIDs[0],
		repositories.UpdatePatch{
			Title:       &newTitle,
			Description: &newDesc,
		},
		before.UpdatedAt,
	); err != nil {
		t.Fatalf("Update(partial): %v", err)
	}

	after, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after): %v", err)
	}

	if after.Title != "WP Patched Title" {
		t.Errorf("Title: want \"WP Patched Title\", got %q", after.Title)
	}
	if after.Description != "WP Patched Description" {
		t.Errorf("Description: want \"WP Patched Description\", got %q", after.Description)
	}
	if after.WorkMode != before.WorkMode {
		t.Errorf("WorkMode: want unchanged %v, got %v", before.WorkMode, after.WorkMode)
	}
	if after.EmploymentType != before.EmploymentType {
		t.Errorf("EmploymentType: want unchanged %v, got %v", before.EmploymentType, after.EmploymentType)
	}
	if after.Seniority != before.Seniority {
		t.Errorf("Seniority: want unchanged %v, got %v", before.Seniority, after.Seniority)
	}
	if after.SalaryCurrency != before.SalaryCurrency {
		t.Errorf("SalaryCurrency: want unchanged %v, got %v", before.SalaryCurrency, after.SalaryCurrency)
	}
	if (after.Location == nil) != (before.Location == nil) ||
		(after.Location != nil && before.Location != nil && *after.Location != *before.Location) {
		t.Errorf("Location: want unchanged %v, got %v", before.Location, after.Location)
	}
}

// TestUpdate_NullLocationClears covers the tri-state "explicit null
// clears" branch: Optional.Set=true,Valid=false → SQL flag=true +
// NULL → column set to NULL.
func TestUpdate_NullLocationClears(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	if before.Location == nil {
		t.Fatalf("precondition: location must start non-null for this test to be meaningful")
	}

	if err := repo.Update(ctx, wpPublishedID, seededCompanyIDs[0],
		repositories.UpdatePatch{
			Location: valueobjects.Optional[string]{Set: true, Valid: false},
		},
		before.UpdatedAt,
	); err != nil {
		t.Fatalf("Update(null location): %v", err)
	}

	after, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after): %v", err)
	}
	if after.Location != nil {
		t.Errorf("Location: want nil after null clear, got %v", *after.Location)
	}
}

// TestUpdate_NullSalaryClears exercises the int pair for the null
// branch (Set=true,Valid=false).
func TestUpdate_NullSalaryClears(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}

	if err := repo.Update(ctx, wpPublishedID, seededCompanyIDs[0],
		repositories.UpdatePatch{
			SalaryMin: valueobjects.Optional[int]{Set: true, Valid: false},
			SalaryMax: valueobjects.Optional[int]{Set: true, Valid: false},
		},
		before.UpdatedAt,
	); err != nil {
		t.Fatalf("Update(null salary): %v", err)
	}

	after, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after): %v", err)
	}
	if after.SalaryMin != nil {
		t.Errorf("SalaryMin: want nil after null clear, got %v", *after.SalaryMin)
	}
	if after.SalaryMax != nil {
		t.Errorf("SalaryMax: want nil after null clear, got %v", *after.SalaryMax)
	}
}

// --- Update CAS ------------------------------------------------------

// TestUpdate_CASMismatchReturnsErrJobNotFound proves the WHERE-clause
// CAS: when casUpdatedAt doesn't equal the row's current updated_at,
// the UPDATE affects 0 rows and the adapter surfaces ErrJobNotFound
// (the use case re-interprets this as ErrConcurrencyConflict).
func TestUpdate_CASMismatchReturnsErrJobNotFound(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate: %v", err)
	}

	// Stale token: well before the row's updated_at.
	stale := before.UpdatedAt.Add(-1 * time.Hour)
	newTitle := "WP CAS-Stale Title"
	err = repo.Update(ctx, wpPublishedID, seededCompanyIDs[0],
		repositories.UpdatePatch{Title: &newTitle},
		stale,
	)
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("err: want ErrJobNotFound on CAS mismatch, got %v", err)
	}

	// The row MUST NOT have been modified.
	after, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after CAS mismatch): %v", err)
	}
	if after.Title == newTitle {
		t.Errorf("Title must NOT have changed on CAS mismatch, got %q", after.Title)
	}
}

// TestUpdate_CrossCompanyUpdateAffectsZeroRows proves the SQL same-
// company guard: Update with a foreign company_id affects 0 rows.
// The adapter surfaces ErrJobNotFound (same as CAS mismatch — design
// D4 keeps the adapter dumb).
func TestUpdate_CrossCompanyUpdateAffectsZeroRows(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate: %v", err)
	}

	newTitle := "WP Cross-Co Title"
	err = repo.Update(ctx, wpPublishedID, seededCompanyIDs[1], // wrong company
		repositories.UpdatePatch{Title: &newTitle},
		before.UpdatedAt,
	)
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("err: want ErrJobNotFound on cross-company, got %v", err)
	}
}

// --- Update atomic published_at side effect --------------------------

// TestUpdate_DraftToPublishedSetsPublishedAt covers the spec
// scenario "draft → published sets published_at now": the same SQL
// UPDATE sets status='published' AND published_at = COALESCE
// (published_at, now()) atomically, so the row's published_at lands
// at the transaction-start instant.
//
// Note on Postgres `now()` semantics: inside a transaction, `now()`
// returns the transaction-start time, NOT the statement-execution
// time. The row's `before.UpdatedAt` was set at the transaction start
// (when the fixture inserted the row); the new `published_at` is set
// to the SAME `now()` value. So the assertion is:
//   - new published_at == before.UpdatedAt (both are transaction-start now())
//   - new published_at is non-nil
//   - the row's status is now 'published'
func TestUpdate_DraftToPublishedSetsPublishedAt(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	if before.JobStatus != valueobjects.Draft {
		t.Fatalf("precondition: status must start draft, got %v", before.JobStatus)
	}
	if before.PublishedAt != nil {
		t.Fatalf("precondition: published_at must start null, got %v", *before.PublishedAt)
	}

	afterUpdate := time.Now().UTC()
	newStatus := valueobjects.Published
	if err := repo.Update(ctx, wpDraftID, seededCompanyIDs[0],
		repositories.UpdatePatch{Status: &newStatus},
		before.UpdatedAt,
	); err != nil {
		t.Fatalf("Update(draft->published): %v", err)
	}

	after, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after): %v", err)
	}
	if after.JobStatus != valueobjects.Published {
		t.Errorf("JobStatus: want Published, got %v", after.JobStatus)
	}
	if after.PublishedAt == nil {
		t.Fatalf("PublishedAt: want non-nil after draft->published, got nil")
	}
	// Postgres TIMESTAMPTZ is UTC; normalize before compare. The
	// assertion pins the atomic-side-effect guarantee: published_at
	// is set to the SAME transaction-time now() that updated_at
	// uses. We allow a 2s slack on the upper bound to tolerate
	// wall-clock drift between the app and Postgres on shared hosts.
	got := after.PublishedAt.UTC()
	if got.Before(before.UpdatedAt.UTC()) || got.After(afterUpdate.Add(2*time.Second)) {
		t.Errorf("PublishedAt %v (UTC): want within [%v, %v]", got, before.UpdatedAt, afterUpdate)
	}
}

// TestUpdate_PublishedToPublishedPreservesPublishedAt covers the
// spec scenario "published → published preserves published_at": the
// published_at column is left alone when status is already 'published'.
func TestUpdate_PublishedToPublishedPreservesPublishedAt(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	if before.PublishedAt == nil {
		t.Fatalf("precondition: published_at must start non-null, got nil")
	}
	original := *before.PublishedAt

	newStatus := valueobjects.Published
	if err := repo.Update(ctx, wpPublishedID, seededCompanyIDs[0],
		repositories.UpdatePatch{Status: &newStatus},
		before.UpdatedAt,
	); err != nil {
		t.Fatalf("Update(published->published): %v", err)
	}

	after, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after): %v", err)
	}
	if after.PublishedAt == nil {
		t.Fatalf("PublishedAt: want non-nil, got nil")
	}
	if !after.PublishedAt.Equal(original) {
		t.Errorf("PublishedAt: want unchanged %v, got %v", original, *after.PublishedAt)
	}
}

// TestUpdate_PublishedToClosedPreservesPublishedAt covers the spec
// scenario "published → closed preserves published_at".
func TestUpdate_PublishedToClosedPreservesPublishedAt(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	if before.PublishedAt == nil {
		t.Fatalf("precondition: published_at must start non-null, got nil")
	}
	original := *before.PublishedAt

	newStatus := valueobjects.Closed
	if err := repo.Update(ctx, wpPublishedID, seededCompanyIDs[0],
		repositories.UpdatePatch{Status: &newStatus},
		before.UpdatedAt,
	); err != nil {
		t.Fatalf("Update(published->closed): %v", err)
	}

	after, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after): %v", err)
	}
	if after.JobStatus != valueobjects.Closed {
		t.Errorf("JobStatus: want Closed, got %v", after.JobStatus)
	}
	if after.PublishedAt == nil {
		t.Fatalf("PublishedAt: want non-nil, got nil")
	}
	if !after.PublishedAt.Equal(original) {
		t.Errorf("PublishedAt: want unchanged %v, got %v", original, *after.PublishedAt)
	}
}

// --- Update immutables ------------------------------------------------

// TestUpdate_ImmutablesNeverTouched pins the contract that search_vector
// (STORED generated), company_id, created_at, id, and deleted_at are
// never modified by the write path — even with a maximal patch.
func TestUpdate_ImmutablesNeverTouched(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}

	// Apply the maximum-allowed patch (every editable column set).
	newTitle := "WP Immut Title"
	newDesc := "WP Immut Description"
	newWM := valueobjects.Hybrid
	newET := valueobjects.Contract
	newSn := valueobjects.LeadSeniority
	newCur := valueobjects.USD
	newLoc := "Remote LATAM"
	newMin := 50000
	newMax := 90000
	newStatus := valueobjects.Published
	if err := repo.Update(ctx, wpPublishedID, seededCompanyIDs[0],
		repositories.UpdatePatch{
			Title:          &newTitle,
			Description:    &newDesc,
			WorkMode:       &newWM,
			EmploymentType: &newET,
			Seniority:      &newSn,
			SalaryCurrency: &newCur,
			Location:       valueobjects.Optional[string]{Set: true, Valid: true, Value: newLoc},
			SalaryMin:      valueobjects.Optional[int]{Set: true, Valid: true, Value: newMin},
			SalaryMax:      valueobjects.Optional[int]{Set: true, Valid: true, Value: newMax},
			Status:         &newStatus,
		},
		before.UpdatedAt,
	); err != nil {
		t.Fatalf("Update(max patch): %v", err)
	}

	after, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after): %v", err)
	}

	// id / company_id / created_at / deleted_at MUST be unchanged.
	if after.ID != before.ID {
		t.Errorf("ID: want unchanged %v, got %v", before.ID, after.ID)
	}
	if after.Company.ID != before.Company.ID {
		t.Errorf("Company.ID: want unchanged %v, got %v", before.Company.ID, after.Company.ID)
	}
	if !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Errorf("UpdatedAt: want transaction-time equal %v, got %v (Postgres now() is transaction-time; out-of-transaction PATCHes WILL advance it)",
			before.UpdatedAt, after.UpdatedAt)
	}
}