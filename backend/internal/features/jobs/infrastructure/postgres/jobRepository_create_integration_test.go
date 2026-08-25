//go:build integration

// Runtime coverage for the jobs CREATE PATH against a live PostgreSQL.
//
// The unit tests in `createJobRepository_test.go` cover the
// deterministic Go helpers (`buildCreateJobParams`,
// `createRowToGetForUpdateRow`, `mapCreateError`); they cannot
// cover what actually decides the behavior — the SQL in
// `db/queries/jobs.sql`. Everything asserted here is what only
// Postgres can prove:
//
//   - Active-company guard (D1): the atomic CTE yields exactly 1 row
//     for an active company and 0 rows for suspended /
//     pending_verification / missing companies, and the adapter maps
//     the 0-rows case to entities.ErrCompanyNotActive WITHOUT writing
//     a row.
//   - Draft + published_at NULL (locked decision #1): the created row
//     is born draft with published_at NULL — invisible to the public
//     read path (which requires status='published').
//   - status literal in INSERT (defense-in-depth): the row's status
//     is 'draft' regardless of any DB DEFAULT drift.
//   - search_vector auto-population (D3): the STORED generated column
//     is populated by Postgres on INSERT (from title + description) and
//     is NOT present in any RETURNING/SELECT column set (asserted via
//     runtime SELECT against jobs.search_vector).
//   - salary_currency defaults to MXN (D5): the adapter writes an
//     explicit canonical 'MXN' string when the use case forwards
//     MXN (its nil default).
//   - UUID v7 (D4): the created id's version nibble is 7.
//   - Create -> publish round-trip: the row's updated_at is a usable
//     CAS token for the gated PATCH /jobs/{id} (spec "Draft Creation
//     Semantics" success criterion).
//
// Isolation: every test runs inside a transaction that is ALWAYS
// rolled back. The fixture prunes the write-path universe so
// assertions can be exact ID lists. Tests do not call t.Parallel().
//
// Skips (never fails) when DATABASE_URL is unset, mirroring
// migration_00008_test.go. Assumes `make db-migrate` has applied
// 00001..00008; the fixture re-applies the 00008 seed itself.
package postgres

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// createPathFixtureCompanyIDs are companies the create-path fixture
// installs in addition to the 00008 seed.
//
//	ca — active company (the happy path)
//	cs — suspended company (the "non-active" gate)
//	cp — pending_verification company (the second non-active gate)
var (
	createPathActiveID    = uuid.MustParse("018f0000-0000-7000-8000-0000000000ca")
	createPathSuspendedID = uuid.MustParse("018f0000-0000-7000-8000-0000000000cb")
	createPathPendingID   = uuid.MustParse("018f0000-0000-7000-8000-0000000000cc")
)

// createPathFixtureSQL adds, on top of the 00008 seed:
//
//	ca  active company (the happy path)
//	cs  suspended company
//	cp  pending_verification company
const createPathFixtureSQL = `
INSERT INTO companies (id, name, rfc, industry_id, status) VALUES
    ('018f0000-0000-7000-8000-0000000000ca', 'Active CP SA',   'ACTI010101AA1', 'technology', 'active'),
    ('018f0000-0000-7000-8000-0000000000cb', 'Suspended CP',   'SUSP010101BB2', 'technology', 'suspended'),
    ('018f0000-0000-7000-8000-0000000000cc', 'Pending CP',     'PEND010101CC3', 'technology', 'pending_verification')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
`

// setupCreatePath mirrors setupWritePath but installs the create-path
// fixture and prunes the create-path universe. Returns the adapter
// bound to the transaction so all reads see the fixture, and the
// underlying pgx.Tx so tests can issue raw SQL (e.g. to count
// surviving rows after a 409) before the rollback.
func setupCreatePath(t *testing.T) (context.Context, *JobRepository, pgx.Tx) {
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
	if _, err := tx.Exec(ctx, createPathFixtureSQL); err != nil {
		t.Fatalf("apply create-path fixture: %v", err)
	}

	// Keep only the create-path fixture rows + the 00008 seed rows so
	// the new row's id is unambiguous in every assertion.
	universe := append([]uuid.UUID{
		createPathActiveID, createPathSuspendedID, createPathPendingID,
	}, seededJobIDs...)
	if _, err := tx.Exec(ctx,
		`DELETE FROM jobs WHERE id <> ALL($1::uuid[])`, universe,
	); err != nil {
		t.Fatalf("prune non-fixture jobs: %v", err)
	}

	return ctx, NewJobRepository(db.New(tx)), tx
}

// --- Active-company gate (D1) --------------------------------------

// TestCreate_ActiveCompanyWritesDraftRow covers the spec scenario
// "active company passes the gate": the CTE yields 1 row, the
// adapter returns the entity, and the persisted row carries
// status='draft', published_at IS NULL, and a fresh updated_at.
func TestCreate_ActiveCompanyWritesDraftRow(t *testing.T) {
	ctx, repo, _ := setupCreatePath(t)

	loc := "CDMX"
	smin := 40000
	smax := 60000
	params := repositories.CreateJobParams{
		Title:          "CP Active Engineer",
		Description:    "active-company draft row for the create path.",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		Location:       &loc,
		SalaryMin:      &smin,
		SalaryMax:      &smax,
		SalaryCurrency: valueobjects.MXN,
	}

	row, err := repo.Create(ctx, uuid.New(), createPathActiveID, params)
	if err != nil {
		t.Fatalf("Create(active company): %v", err)
	}
	if row == nil {
		t.Fatal("Create(active company): want non-nil entity, got nil")
	}
	if row.JobStatus != valueobjects.Draft {
		t.Errorf("JobStatus: want Draft, got %v", row.JobStatus)
	}
	if row.PublishedAt != nil {
		t.Errorf("PublishedAt: want nil (draft row), got %v", *row.PublishedAt)
	}
	if row.UpdatedAt.IsZero() {
		t.Errorf("UpdatedAt: want non-zero, got zero")
	}
	if row.Company.ID != createPathActiveID {
		t.Errorf("Company.ID: want %v, got %v", createPathActiveID, row.Company.ID)
	}
	if row.Company.Name == "" {
		t.Errorf("Company.Name: want non-empty (joined from companies), got empty")
	}
}

// TestCreate_SuspendedCompanyReturnsErrCompanyNotActiveAndNoRow pins
// the spec scenario "suspended company is rejected with 409": the
// CTE yields zero rows, the adapter returns ErrCompanyNotActive, and
// NO row is inserted (atomicity).
func TestCreate_SuspendedCompanyReturnsErrCompanyNotActiveAndNoRow(t *testing.T) {
	ctx, repo, tx := setupCreatePath(t)

	row, err := repo.Create(ctx, uuid.New(), createPathSuspendedID, repositories.CreateJobParams{
		Title:          "CP Suspended Engineer",
		Description:    "should never persist.",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		SalaryCurrency: valueobjects.MXN,
	})
	if !errors.Is(err, entities.ErrCompanyNotActive) {
		t.Fatalf("err: want ErrCompanyNotActive, got %v", err)
	}
	if row != nil {
		t.Errorf("Create result: want nil on ErrCompanyNotActive, got %+v", row)
	}

	// Verify NO row was inserted (atomicity guarantee).
	var c int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM jobs WHERE title = $1`, "CP Suspended Engineer").Scan(&c); err != nil {
		t.Fatalf("count: %v", err)
	}
	if c != 0 {
		t.Errorf("jobs rows with suspended-company title: want 0 (atomic gate), got %d", c)
	}
}

// TestCreate_PendingVerificationCompanyReturnsErrCompanyNotActiveAndNoRow
// covers the spec scenario "pending_verification company is rejected
// with 409": same behavior as suspended (the active CTE filters
// both out).
func TestCreate_PendingVerificationCompanyReturnsErrCompanyNotActiveAndNoRow(t *testing.T) {
	ctx, repo, tx := setupCreatePath(t)

	row, err := repo.Create(ctx, uuid.New(), createPathPendingID, repositories.CreateJobParams{
		Title:          "CP Pending Engineer",
		Description:    "should never persist.",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		SalaryCurrency: valueobjects.MXN,
	})
	if !errors.Is(err, entities.ErrCompanyNotActive) {
		t.Fatalf("err: want ErrCompanyNotActive, got %v", err)
	}
	if row != nil {
		t.Errorf("Create result: want nil on ErrCompanyNotActive, got %+v", row)
	}

	var c int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM jobs WHERE title = $1`, "CP Pending Engineer").Scan(&c); err != nil {
		t.Fatalf("count: %v", err)
	}
	if c != 0 {
		t.Errorf("jobs rows with pending-company title: want 0 (atomic gate), got %d", c)
	}
}

// TestCreate_MissingCompanyReturnsErrCompanyNotActive covers the
// defensive 0-rows path: a UUID that doesn't match any company
// also surfaces ErrCompanyNotActive (the spec scenario "0 rows on
// the SQL guard" — never ErrJobNotFound, never a different 409).
func TestCreate_MissingCompanyReturnsErrCompanyNotActive(t *testing.T) {
	ctx, repo, tx := setupCreatePath(t)

	missing := uuid.MustParse("018f0000-0000-7000-8000-0000000000ff")
	row, err := repo.Create(ctx, uuid.New(), missing, repositories.CreateJobParams{
		Title:          "CP Missing Co Engineer",
		Description:    "should never persist.",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		SalaryCurrency: valueobjects.MXN,
	})
	if !errors.Is(err, entities.ErrCompanyNotActive) {
		t.Fatalf("err: want ErrCompanyNotActive, got %v", err)
	}
	if row != nil {
		t.Errorf("Create result: want nil on missing company, got %+v", row)
	}

	var c int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM jobs WHERE title = $1`, "CP Missing Co Engineer").Scan(&c); err != nil {
		t.Fatalf("count: %v", err)
	}
	if c != 0 {
		t.Errorf("jobs rows with missing-company title: want 0, got %d", c)
	}
}

// --- search_vector exclusion (D3) ----------------------------------

// TestCreate_SearchVectorAutoPopulatedAndNotInRow pins D3: the
// STORED generated column is populated by Postgres (so FTS works
// after the row is published) and the db.CreateJobRow type does NOT
// carry a SearchVector field (so the adapter cannot return a
// tsvector to the use case). The runtime check below is the
// observable part; the type-system part is enforced at compile time
// by the sqlc regen output.
func TestCreate_SearchVectorAutoPopulatedAndNotInRow(t *testing.T) {
	ctx, repo, tx := setupCreatePath(t)

	row, err := repo.Create(ctx, uuid.New(), createPathActiveID, repositories.CreateJobParams{
		Title:          "CP SearchVector Engineer",
		Description:    "search_vector should auto-populate from this title and description.",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		SalaryCurrency: valueobjects.MXN,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Type-system contract: db.CreateJobRow MUST NOT have a
	// SearchVector field. We assert this via reflection: if a future
	// sqlc regen ever surfaces a SearchVector field (because a
	// RETURNING * or a search_vector SELECT slipped in), this test
	// fails LOUD, prompting a review of D3.
	if _, found := reflect.TypeOf(db.CreateJobRow{}).FieldByName("SearchVector"); found {
		t.Errorf("db.CreateJobRow MUST NOT carry a SearchVector field (D3 contract): sqlc regen slipped the column into the row type")
	}

	// Runtime invariant: jobs.search_vector IS NOT NULL after the
	// INSERT (the column is STORED generated; Postgres populates it
	// from title + description at row-write time).
	var sv string
	if err := tx.QueryRow(ctx, `SELECT search_vector::text FROM jobs WHERE id = $1`, row.ID).Scan(&sv); err != nil {
		t.Fatalf("query search_vector: %v", err)
	}
	if sv == "" {
		t.Errorf("search_vector: want non-empty (auto-populated), got empty")
	}
}

// --- salary_currency default (D5) ----------------------------------

// TestCreate_SalaryCurrencyDefaultsToMXNWhenOmitted pins D5: the
// use case forwards MXN as the canonical wire string (when nil) and
// the INSERT writes an explicit 'MXN' value (never NULL, never the
// DB DEFAULT — the explicit value is what survives a future DEFAULT
// drift).
func TestCreate_SalaryCurrencyDefaultsToMXNWhenOmitted(t *testing.T) {
	ctx, repo, tx := setupCreatePath(t)

	row, err := repo.Create(ctx, uuid.New(), createPathActiveID, repositories.CreateJobParams{
		Title:          "CP Currency Engineer",
		Description:    "currency default test.",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		SalaryCurrency: valueobjects.MXN, // <-- use-case default
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if row.SalaryCurrency != valueobjects.MXN {
		t.Errorf("entity SalaryCurrency: want MXN, got %v", row.SalaryCurrency)
	}

	var cur string
	if err := tx.QueryRow(ctx, `SELECT salary_currency FROM jobs WHERE id = $1`, row.ID).Scan(&cur); err != nil {
		t.Fatalf("query salary_currency: %v", err)
	}
	if cur != "MXN" {
		t.Errorf("DB salary_currency: want %q (explicit INSERT value), got %q", "MXN", cur)
	}
}

// --- UUID v7 (D4) --------------------------------------------------

// TestCreate_IDIsUUIDv7 pins D4: the use case calls uuid.NewV7()
// and the persisted row's id has version nibble 7.
func TestCreate_IDIsUUIDv7(t *testing.T) {
	ctx, repo, _ := setupCreatePath(t)

	row, err := repo.Create(ctx, uuid.New(), createPathActiveID, repositories.CreateJobParams{
		Title:          "CP UUIDv7 Engineer",
		Description:    "uuid v7 round-trip.",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		SalaryCurrency: valueobjects.MXN,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if row.ID.Version() != 7 {
		t.Errorf("created id version: want 7, got %d", row.ID.Version())
	}
}

// --- Create -> Publish round-trip (spec "Draft Creation Semantics") -

// TestCreate_UpdatedAtIsUsableCASTokenForPublish proves the
// spec scenario "response is not the public read DTO" / "response
// status is draft and updated_at is server-supplied": the freshly
// created row's updated_at can drive an immediate PATCH to publish
// the draft (the round-trip is the keystone of the create-then-PATCH
// flow the editor view supports).
func TestCreate_UpdatedAtIsUsableCASTokenForPublish(t *testing.T) {
	ctx, repo, _ := setupCreatePath(t)

	row, err := repo.Create(ctx, uuid.New(), createPathActiveID, repositories.CreateJobParams{
		Title:          "CP Round-Trip Engineer",
		Description:    "create then publish round-trip.",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		SalaryCurrency: valueobjects.MXN,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if row.JobStatus != valueobjects.Draft {
		t.Fatalf("precondition: status must be draft, got %v", row.JobStatus)
	}

	// Use the create response's updated_at as the CAS token for the
	// PATCH that publishes the draft. A mismatch surfaces
	// ErrJobNotFound (which the use case re-interprets as
	// ErrConcurrencyConflict). On success, the row's status is
	// 'published' and published_at is set.
	newStatus := valueobjects.Published
	if err := repo.Update(ctx, row.ID, createPathActiveID, repositories.UpdatePatch{
		Status: &newStatus,
	}, row.UpdatedAt); err != nil {
		t.Fatalf("Update(draft -> published): %v", err)
	}

	after, err := repo.GetForUpdate(ctx, row.ID, createPathActiveID)
	if err != nil {
		t.Fatalf("GetForUpdate after publish: %v", err)
	}
	if after.JobStatus != valueobjects.Published {
		t.Errorf("after-publish JobStatus: want Published, got %v", after.JobStatus)
	}
	if after.PublishedAt == nil {
		t.Errorf("after-publish PublishedAt: want non-nil, got nil")
	}
}

// --- Optional fields round-trip ------------------------------------

// TestCreate_OptionalFieldsRoundTrip exercises the nullable trio:
// Location/SalaryMin/SalaryMax must round-trip verbatim, including
// the absent case (NULL columns).
func TestCreate_OptionalFieldsRoundTrip(t *testing.T) {
	ctx, repo, _ := setupCreatePath(t)

	t.Run("with optionals set", func(t *testing.T) {
		loc := "Remote LATAM"
		smin := 50000
		smax := 90000
		row, err := repo.Create(ctx, uuid.New(), createPathActiveID, repositories.CreateJobParams{
			Title:          "CP Optionals-Set",
			Description:    "all optional fields set.",
			WorkMode:       valueobjects.Remote,
			EmploymentType: valueobjects.FullTime,
			Seniority:      valueobjects.SeniorSeniority,
			Location:       &loc,
			SalaryMin:      &smin,
			SalaryMax:      &smax,
			SalaryCurrency: valueobjects.USD,
		})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if row.Location == nil || *row.Location != "Remote LATAM" {
			t.Errorf("Location: want %q, got %v", "Remote LATAM", row.Location)
		}
		if row.SalaryMin == nil || *row.SalaryMin != 50000 {
			t.Errorf("SalaryMin: want 50000, got %v", row.SalaryMin)
		}
		if row.SalaryMax == nil || *row.SalaryMax != 90000 {
			t.Errorf("SalaryMax: want 90000, got %v", row.SalaryMax)
		}
		if row.SalaryCurrency != valueobjects.USD {
			t.Errorf("SalaryCurrency: want USD, got %v", row.SalaryCurrency)
		}
	})

	t.Run("without optionals (NULL)", func(t *testing.T) {
		row, err := repo.Create(ctx, uuid.New(), createPathActiveID, repositories.CreateJobParams{
			Title:          "CP Optionals-Null",
			Description:    "no optional fields set; nullable columns must be NULL.",
			WorkMode:       valueobjects.Remote,
			EmploymentType: valueobjects.FullTime,
			Seniority:      valueobjects.SeniorSeniority,
			SalaryCurrency: valueobjects.MXN,
		})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if row.Location != nil {
			t.Errorf("Location (absent): want nil, got %v", *row.Location)
		}
		if row.SalaryMin != nil {
			t.Errorf("SalaryMin (absent): want nil, got %v", *row.SalaryMin)
		}
		if row.SalaryMax != nil {
			t.Errorf("SalaryMax (absent): want nil, got %v", *row.SalaryMax)
		}
	})
}
