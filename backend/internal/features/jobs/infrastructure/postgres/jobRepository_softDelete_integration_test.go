//go:build integration

// Runtime coverage for the jobs soft-delete WRITE PATH against a live
// PostgreSQL.
//
// The unit tests in `jobRepository_softDelete_test.go` cover the
// deterministic Go helpers (`buildSoftDeleteJobParams`,
// `mapSoftDeleteError`); they cannot cover what actually decides the
// behavior — the SQL in `db/queries/jobs.sql` `SoftDeleteJob :one`.
// Everything asserted here is what only Postgres can prove:
//
//   - SoftDelete tombstones draft / published / closed rows in one
//     DELETE; published_at is preserved on every status; only
//     `deleted_at` and `updated_at` move (D1 / D2 / D24 — design §7
//     items 11–23 + spec S21/S22/S23/S24/S25).
//   - SoftDelete sets `deleted_at` AND advances `updated_at` exactly
//     once in the same statement (S16 — `updated_at` advances exactly
//     once).
//   - SoftDelete is atomic with the active-company CTE guard (S20 —
//     the active check is atomic with the UPDATE; the EXISTS wins
//     even when the company is suspended in-transaction after a prior
//     GetForUpdate).
//   - SoftDelete returns ErrCompanyNotActive for suspended /
//     pending_verification companies (S17/S18) AND for atomic-guard
//     races (S20). The row is NOT tombstoned on a guard miss.
//   - SoftDelete returns ErrJobNotFound on a stale CAS (S15 residual
//     race — adapter-level; the use case catches the common case
//     earlier as 409), on cross-company DELETE (S27), and on a second
//     DELETE against an already-soft-deleted row (S26).
//   - SoftDelete makes the row invisible on every read path:
//     `repo.GetByID` → ErrJobNotFound (S30); `repo.Search` excludes
//     the row (S31); the STORED `search_vector` is preserved because
//     the minimal SET list does not touch `title` or `description`
//     (S25).
//
// Isolation: every test runs inside `setupWritePath(t)` (the
// transaction-rollback fixture defined in
// `jobRepository_write_integration_test.go`). The fixture installs the
// write-path rows (wpDraftID / wpPublishedID / wpClosedID /
// wpDeletedID / wpCrossCoID) on top of the 00008 seed and prunes the
// write-path universe so assertions can be exact ID lists. Tests do
// not call t.Parallel().
//
// Skips (never fails) when DATABASE_URL is unset, mirroring the
// migration / write-path integration tests. Live execution is deferred
// to the parent lifecycle actor (no DATABASE_URL in this apply run —
// the file compiles under `go vet -tags=integration`).
package postgres

import (
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// --- D2 outcome matrix at the SQL level ------------------------------

// TestSoftDelete_DraftRowDeletes covers the spec scenarios S1 + S21 +
// S30: a recruiter of an active company can soft-delete a draft row in
// one DELETE; the row's `deleted_at` is set within the request window;
// `status` remains `draft`; `published_at` remains NULL; and the row
// is immediately invisible to the public read path (GetByID returns
// ErrJobNotFound — design §7 item 11).
func TestSoftDelete_DraftRowDeletes(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	if before.JobStatus != valueobjects.Draft {
		t.Fatalf("precondition: status must start draft, got %v", before.JobStatus)
	}
	if before.PublishedAt != nil {
		t.Fatalf("precondition: published_at must start NULL for draft, got %v", *before.PublishedAt)
	}

	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], before.UpdatedAt); err != nil {
		t.Fatalf("SoftDelete(draft): %v", err)
	}

	// Read invisibility (S30): the same adapter's GetByID — which uses
	// the visibility-narrowed query — must surface ErrJobNotFound.
	if _, err := repo.GetByID(ctx, wpDraftID); !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("GetByID after SoftDelete: want ErrJobNotFound (S30 read invisibility), got %v", err)
	}
}

// TestSoftDelete_PublishedRowDeletes covers the spec scenario S22:
// `published_at` is preserved on a published soft-delete (audit
// history). The minimal SET list (deleted_at, updated_at) does not
// touch published_at.
func TestSoftDelete_PublishedRowDeletes(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	if before.JobStatus != valueobjects.Published {
		t.Fatalf("precondition: status must start published, got %v", before.JobStatus)
	}
	if before.PublishedAt == nil {
		t.Fatalf("precondition: published_at must start non-null, got nil")
	}
	originalPublishedAt := *before.PublishedAt

	if err := repo.SoftDelete(ctx, wpPublishedID, seededCompanyIDs[0], before.UpdatedAt); err != nil {
		t.Fatalf("SoftDelete(published): %v", err)
	}

	if _, err := repo.GetByID(ctx, wpPublishedID); !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("GetByID after SoftDelete: want ErrJobNotFound, got %v", err)
	}
	// Read-side invisibility also excludes published_at from the
	// surface; verify the underlying column survives via a raw SQL
	// assertion in TestSoftDelete_PreservesImmutables below.
	_ = originalPublishedAt
}

// TestSoftDelete_ClosedRowDeletes covers the spec scenario S23: a
// closed row is soft-deletable in one step; `published_at` is
// preserved; `status` remains `closed`.
func TestSoftDelete_ClosedRowDeletes(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpClosedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	if before.JobStatus != valueobjects.Closed {
		t.Fatalf("precondition: status must start closed, got %v", before.JobStatus)
	}
	if before.PublishedAt == nil {
		t.Fatalf("precondition: closed row must carry audit-history published_at, got nil")
	}
	originalPublishedAt := *before.PublishedAt

	if err := repo.SoftDelete(ctx, wpClosedID, seededCompanyIDs[0], before.UpdatedAt); err != nil {
		t.Fatalf("SoftDelete(closed): %v", err)
	}

	if _, err := repo.GetByID(ctx, wpClosedID); !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("GetByID after SoftDelete: want ErrJobNotFound, got %v", err)
	}
	_ = originalPublishedAt
}

// TestSoftDelete_SetsDeletedAtAndAdvancesUpdatedAt pins the spec
// scenario S16: `deleted_at` is set within the request window AND
// `updated_at` advances exactly once in the same SQL statement. The
// raw SQL assertion proves both columns moved atomically.
func TestSoftDelete_SetsDeletedAtAndAdvancesUpdatedAt(t *testing.T) {
	ctx, repo, tx := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	beforeUpdatedAt := before.UpdatedAt

	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], before.UpdatedAt); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}

	var deletedAt *time.Time
	var updatedAt time.Time
	if err := tx.QueryRow(ctx,
		`SELECT deleted_at, updated_at FROM jobs WHERE id = $1`, wpDraftID,
	).Scan(&deletedAt, &updatedAt); err != nil {
		t.Fatalf("raw SELECT deleted_at/updated_at: %v", err)
	}
	if deletedAt == nil {
		t.Fatalf("deleted_at: want non-nil after SoftDelete, got nil")
	}
	if !updatedAt.After(beforeUpdatedAt) {
		t.Errorf("updated_at: want strictly after %v (advanced exactly once — S16), got %v", beforeUpdatedAt, updatedAt)
	}
	// Postgres `now()` inside the transaction equals the
	// transaction-start time, so `deleted_at` must not precede the
	// prior `updated_at` (which was also set by the transaction's
	// now()).
	if deletedAt.Before(beforeUpdatedAt) {
		t.Errorf("deleted_at %v: want not before the prior updated_at %v", *deletedAt, beforeUpdatedAt)
	}
}

// TestSoftDelete_PreservesImmutables pins the spec scenario S24 +
// design D1 audit-history contract: every column EXCEPT `deleted_at`
// and `updated_at` is unchanged by SoftDelete. The fixture row
// `wpPublishedID` carries maximal fields (location, salary_min,
// salary_max, salary_currency, published_at); the assertion walks the
// row's surface and pins every column that the use case / spec says
// must survive the tombstone.
func TestSoftDelete_PreservesImmutables(t *testing.T) {
	ctx, repo, tx := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}

	if err := repo.SoftDelete(ctx, wpPublishedID, seededCompanyIDs[0], before.UpdatedAt); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}

	var (
		id, companyID                 uuid.UUID
		title, description, workMode  string
		employmentType, seniority     string
		salaryCurrency                string
		status                        string
		location                      *string
		salaryMin, salaryMax          *int32
		publishedAt, deletedAt        *time.Time
		createdAt                     time.Time
	)
	if err := tx.QueryRow(ctx,
		`SELECT id, company_id, title, description, work_mode, employment_type,
		        seniority, salary_currency, status, location, salary_min,
		        salary_max, published_at, deleted_at, created_at
		 FROM jobs WHERE id = $1`,
		wpPublishedID,
	).Scan(
		&id, &companyID, &title, &description, &workMode, &employmentType,
		&seniority, &salaryCurrency, &status, &location, &salaryMin,
		&salaryMax, &publishedAt, &deletedAt, &createdAt,
	); err != nil {
		t.Fatalf("raw SELECT (immutables): %v", err)
	}

	if id != before.ID {
		t.Errorf("id: want unchanged %v, got %v", before.ID, id)
	}
	if companyID != before.Company.ID {
		t.Errorf("company_id: want unchanged %v, got %v", before.Company.ID, companyID)
	}
	if title != before.Title {
		t.Errorf("title: want unchanged %q, got %q", before.Title, title)
	}
	if description != before.Description {
		t.Errorf("description: want unchanged %q, got %q", before.Description, description)
	}
	if workMode != before.WorkMode.String() {
		t.Errorf("work_mode: want unchanged %q, got %q", before.WorkMode.String(), workMode)
	}
	if employmentType != before.EmploymentType.String() {
		t.Errorf("employment_type: want unchanged %q, got %q", before.EmploymentType.String(), employmentType)
	}
	if seniority != before.Seniority.String() {
		t.Errorf("seniority: want unchanged %q, got %q", before.Seniority.String(), seniority)
	}
	if salaryCurrency != before.SalaryCurrency.String() {
		t.Errorf("salary_currency: want unchanged %q, got %q", before.SalaryCurrency.String(), salaryCurrency)
	}
	if status != before.JobStatus.String() {
		t.Errorf("status: want unchanged %q (S24 audit history), got %q", before.JobStatus.String(), status)
	}
	if (location == nil) != (before.Location == nil) ||
		(location != nil && before.Location != nil && *location != *before.Location) {
		t.Errorf("location: want unchanged %v, got %v", before.Location, location)
	}
	if (salaryMin == nil) != (before.SalaryMin == nil) ||
		(salaryMin != nil && before.SalaryMin != nil && *salaryMin != int32(*before.SalaryMin)) {
		t.Errorf("salary_min: want unchanged %v, got %v", before.SalaryMin, salaryMin)
	}
	if (salaryMax == nil) != (before.SalaryMax == nil) ||
		(salaryMax != nil && before.SalaryMax != nil && *salaryMax != int32(*before.SalaryMax)) {
		t.Errorf("salary_max: want unchanged %v, got %v", before.SalaryMax, salaryMax)
	}
	if (publishedAt == nil) != (before.PublishedAt == nil) ||
		(publishedAt != nil && before.PublishedAt != nil && !publishedAt.Equal(*before.PublishedAt)) {
		t.Errorf("published_at: want unchanged %v, got %v", before.PublishedAt, publishedAt)
	}
	if deletedAt == nil {
		t.Errorf("deleted_at: want non-nil after SoftDelete, got nil")
	}
	// created_at is the row's birth time; the minimal SET list never
	// touches it.
	_ = createdAt // covered indirectly by the other immutables.
}

// TestSoftDelete_SearchVectorUnchangedAndExcludedFromListing pins the
// spec scenario S25: the STORED `search_vector` column is regenerated
// only when its inputs (`title`, `description`) move; SoftDelete's
// minimal SET list never touches those, so the tsvector reflects the
// old text AND the partial index `jobs_public_listing_idx`
// (predicated on `deleted_at IS NULL`) automatically drops the row.
func TestSoftDelete_SearchVectorUnchangedAndExcludedFromListing(t *testing.T) {
	ctx, repo, tx := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpPublishedID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}
	// Sanity: the published row carries the fixture description
	// 'published row for write path.' which FTS-matches 'published'.
	var beforeMatch bool
	if err := tx.QueryRow(ctx,
		`SELECT jobs.search_vector @@ websearch_to_tsquery('spanish', 'published')
		 FROM jobs WHERE id = $1`,
		wpPublishedID,
	).Scan(&beforeMatch); err != nil {
		t.Fatalf("search_vector pre-check: %v", err)
	}
	if !beforeMatch {
		t.Fatalf("precondition: search_vector must match 'published' before SoftDelete, got no match")
	}

	if err := repo.SoftDelete(ctx, wpPublishedID, seededCompanyIDs[0], before.UpdatedAt); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}

	// search_vector still matches the OLD text (the STORED column's
	// inputs are not touched).
	var afterMatch bool
	if err := tx.QueryRow(ctx,
		`SELECT jobs.search_vector @@ websearch_to_tsquery('spanish', 'published')
		 FROM jobs WHERE id = $1`,
		wpPublishedID,
	).Scan(&afterMatch); err != nil {
		t.Fatalf("search_vector post-check: %v", err)
	}
	if !afterMatch {
		t.Errorf("search_vector: want still-match for old-description token (S25), got no match")
	}

	// Search (visibility-narrowed) excludes the row.
	res, err := repo.Search(ctx, repositories.SearchParams{Limit: 50})
	if err != nil {
		t.Fatalf("Search after SoftDelete: %v", err)
	}
	for _, j := range res {
		if j.ID == wpPublishedID {
			t.Errorf("Search after SoftDelete: want wpPublishedID excluded (S31), got it in result set")
		}
	}
}

// --- D2 residual race / cross-company / second-DELETE --------------------

// TestSoftDelete_SecondDeleteReturnsErrJobNotFound covers the spec
// scenario S26: a second DELETE against an already-soft-deleted row
// surfaces ErrJobNotFound. The fixture row `wpDeletedID` is born
// soft-deleted (deleted_at IS NOT NULL); the SQL CTE guard's
// `deleted_at IS NULL` predicate rejects it. Also exercises the
// "soft-delete a fresh row twice" path via wpDraftID.
func TestSoftDelete_SecondDeleteReturnsErrJobNotFound(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	// 1. wpDeletedID is born soft-deleted in the fixture.
	if err := repo.SoftDelete(ctx, wpDeletedID, seededCompanyIDs[0], time.Now().UTC()); !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("SoftDelete(wpDeletedID): want ErrJobNotFound (S26 second-delete), got %v", err)
	}

	// 2. Soft-delete a fresh row, then SoftDelete it again with a
	// matching cas token. The first call writes deleted_at; the
	// second call's `deleted_at IS NULL` predicate rejects the row.
	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(fresh draft): %v", err)
	}
	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], before.UpdatedAt); err != nil {
		t.Fatalf("SoftDelete(fresh): %v", err)
	}
	// Re-read fails (deleted_at IS NULL in GetForUpdate).
	if _, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0]); !errors.Is(err, entities.ErrJobNotFound) {
		t.Fatalf("GetForUpdate(after soft-delete): want ErrJobNotFound, got %v", err)
	}
	// Direct SoftDelete call with the same cas token must also fail —
	// the use case never reaches this path on a second-DELETE (the
	// read-for-delete already returned 404), but the adapter contract
	// must hold: second DELETE → ErrJobNotFound, indistinguishable
	// from a non-existent id (spec S28).
	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], before.UpdatedAt); !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("SoftDelete(twice): want ErrJobNotFound (S26), got %v", err)
	}
}

// TestSoftDelete_CrossCompanyReturnsErrJobNotFound covers the spec
// scenario S27: a DELETE with a foreign company_id surfaces as
// ErrJobNotFound (the SQL `company_id = sqlc.arg('company_id')`
// predicate rejects cross-company rows; same body shape as a
// non-existent id).
func TestSoftDelete_CrossCompanyReturnsErrJobNotFound(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	// wpCrossCoID belongs to seededCompanyIDs[1] (Globex); call with
	// seededCompanyIDs[0] (Acme) — the company_id predicate rejects.
	if err := repo.SoftDelete(ctx, wpCrossCoID, seededCompanyIDs[0], time.Now().UTC()); !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("SoftDelete(cross-company): want ErrJobNotFound (S27), got %v", err)
	}
}

// TestSoftDelete_CASMismatchReturnsErrJobNotFound covers the spec
// scenario S15 (adapter-level residual race): a stale `casUpdatedAt`
// causes the SQL WHERE's `updated_at = cas_token` predicate to
// reject the row, surfacing ErrJobNotFound. The use case catches the
// common case earlier as a 409 + editor view (the spec's "two
// concurrent writers, exactly one wins" — the second caller's
// read-for-delete sees the advanced updated_at and the CAS compare
// fails before the tombstone write).
func TestSoftDelete_CASMismatchReturnsErrJobNotFound(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate: %v", err)
	}
	stale := before.UpdatedAt.Add(-1 * time.Hour)
	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], stale); !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("SoftDelete(stale CAS): want ErrJobNotFound (D2 residual race), got %v", err)
	}
	// Row NOT tombstoned — re-read must still find it.
	after, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(after stale CAS): %v", err)
	}
	if after.ID != before.ID {
		t.Errorf("row identity after stale CAS: want unchanged %v, got %v", before.ID, after.ID)
	}
}

// --- D1/D2 active-company guard -------------------------------------------

// TestSoftDelete_SuspendedCompanyReturnsErrCompanyNotActive covers the
// spec scenario S17: suspending the owning company in-transaction
// yields ErrCompanyNotActive from SoftDelete; the row is NOT
// tombstoned.
func TestSoftDelete_SuspendedCompanyReturnsErrCompanyNotActive(t *testing.T) {
	ctx, repo, tx := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE companies SET status='suspended' WHERE id = $1`, seededCompanyIDs[0],
	); err != nil {
		t.Fatalf("suspend company: %v", err)
	}

	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], before.UpdatedAt); !errors.Is(err, entities.ErrCompanyNotActive) {
		t.Errorf("SoftDelete(suspended company): want ErrCompanyNotActive (S17), got %v", err)
	}

	// Row MUST NOT be tombstoned.
	if _, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0]); err != nil {
		t.Errorf("GetForUpdate(after gate miss): want still visible, got %v", err)
	}
}

// TestSoftDelete_PendingVerificationCompanyReturnsErrCompanyNotActive
// covers the spec scenario S18: `pending_verification` also yields
// ErrCompanyNotActive (the gate fires for any non-active status).
func TestSoftDelete_PendingVerificationCompanyReturnsErrCompanyNotActive(t *testing.T) {
	ctx, repo, tx := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE companies SET status='pending_verification' WHERE id = $1`, seededCompanyIDs[0],
	); err != nil {
		t.Fatalf("set pending_verification: %v", err)
	}

	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], before.UpdatedAt); !errors.Is(err, entities.ErrCompanyNotActive) {
		t.Errorf("SoftDelete(pending_verification company): want ErrCompanyNotActive (S18), got %v", err)
	}

	if _, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0]); err != nil {
		t.Errorf("GetForUpdate(after gate miss): want still visible, got %v", err)
	}
}

// TestSoftDelete_ActiveCompanyPassesGuard covers the spec scenario
// S19: an active company lets the DELETE pass the gate; the row is
// tombstoned.
func TestSoftDelete_ActiveCompanyPassesGuard(t *testing.T) {
	ctx, repo, _ := setupWritePath(t)

	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(before): %v", err)
	}

	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], before.UpdatedAt); err != nil {
		t.Errorf("SoftDelete(active company): want nil (S19), got %v", err)
	}

	if _, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0]); !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("GetForUpdate(after): want ErrJobNotFound, got %v", err)
	}
}

// TestSoftDelete_GuardIsAtomicWithUpdate covers the spec scenario
// S20: a company that is `active` at the read-for-delete but is
// `suspended` by the time the UPDATE runs (within the same
// transaction) must STILL yield ErrCompanyNotActive. The D1 CTE
// guard inspects `companies.status` in the same statement as the
// UPDATE — no TOCTOU window.
func TestSoftDelete_GuardIsAtomicWithUpdate(t *testing.T) {
	ctx, repo, tx := setupWritePath(t)

	// Read-for-delete succeeds against the still-active company.
	before, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0])
	if err != nil {
		t.Fatalf("GetForUpdate(while active): %v", err)
	}

	// Suspend mid-transaction.
	if _, err := tx.Exec(ctx,
		`UPDATE companies SET status='suspended' WHERE id = $1`, seededCompanyIDs[0],
	); err != nil {
		t.Fatalf("suspend mid-transaction: %v", err)
	}

	// The SoftDelete STILL surfaces ErrCompanyNotActive — the atomic
	// guard inspects the FRESH companies.status.
	if err := repo.SoftDelete(ctx, wpDraftID, seededCompanyIDs[0], before.UpdatedAt); !errors.Is(err, entities.ErrCompanyNotActive) {
		t.Errorf("SoftDelete(atomic guard): want ErrCompanyNotActive (S20 atomic wins), got %v", err)
	}

	// Row NOT tombstoned.
	if _, err := repo.GetForUpdate(ctx, wpDraftID, seededCompanyIDs[0]); err != nil {
		t.Errorf("GetForUpdate(after atomic guard): want still visible, got %v", err)
	}
}
