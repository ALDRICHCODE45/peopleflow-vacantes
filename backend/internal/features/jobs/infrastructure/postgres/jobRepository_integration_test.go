//go:build integration

// Runtime coverage for the jobs READ PATH against a live PostgreSQL.
//
// The unit tests in `jobRepository_test.go` cover the deterministic Go
// helpers (`buildSearchParams`, `toEntity`, `mapGetError`); they cannot
// cover what actually decides the public contract — the SQL in
// `db/queries/jobs.sql`. Everything asserted here is behaviour that only
// Postgres can prove:
//
//   - REQ-02 Read-Side Visibility Rule: only `status='published'` +
//     `deleted_at IS NULL` + owning `companies.status='active'` surfaces,
//     on BOTH `Search` and `GetByID`.
//   - REQ-05 Full-Text Search: `setweight(title,'A') > setweight(desc,'B')`
//     really orders a title hit above a description-only hit, and a
//     non-matching query returns nothing.
//   - REQ-06 Listing Filters: each equality filter and the `location`
//     ILIKE substring filter narrow to the expected rows; absent filters
//     return the whole visible set.
//   - REQ-07 Keyset Pagination: walking every page via `next_cursor`
//     until it is nil yields each visible row exactly once, in the same
//     order a single unpaginated query produces — including the
//     rank-tie case where the 3-tuple `(ts_rank, published_at, id)`
//     comparator is the only thing preventing skips/duplicates.
//
// Isolation: every test runs inside a transaction that is ALWAYS rolled
// back. The fixture deletes every `jobs` row outside its own universe so
// assertions can be exact ID lists instead of fuzzy counts, and the
// rollback puts the developer's database back exactly as it was. Tests
// in this package never call `t.Parallel()`, so the fixture transactions
// never contend with each other or with the migration tests.
//
// Skips (never fails) when DATABASE_URL is unset, mirroring
// `migration_00008_test.go`. Assumes `make db-migrate` has applied
// 00001..00008; the fixture re-applies the 00008 seed itself so it also
// works right after the 00007 down/up test recreated an empty table.
package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/cursor"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// --- fixture identities ----------------------------------------------------

// Seeded (00008) job ids, aliased for readability. Index order matches
// `seededJobIDs` in migration_00008_test.go — kept as a named mapping so
// a change to the seed breaks the alias, not a silent assertion.
var (
	jobBackendGoID  = seededJobIDs[0] // remote  full_time  senior   CDMX          MXN 2026-08-01
	jobFrontendID   = seededJobIDs[1] // hybrid  full_time  mid      CDMX          MXN 2026-08-05
	jobDataEngID    = seededJobIDs[2] // remote  full_time  senior   Remote LATAM  USD 2026-08-10
	jobMLEngID      = seededJobIDs[3] // remote  contract   lead     Remote        USD 2026-08-12
	jobJuniorQAID   = seededJobIDs[4] // onsite  full_time  junior   Guadalajara   MXN 2026-08-15
	jobDevOpsIntern = seededJobIDs[5] // hybrid  internship intern   Guadalajara   MXN 2026-08-18
)

// Extra fixture rows inserted on top of the 00008 seed. The `b*` ids are
// the four ways a row must stay INVISIBLE; the `c*` ids are the
// title-hit / description-hit pair that proves FTS weighting.
var (
	companySuspendedID = uuid.MustParse("018f0000-0000-7000-8000-0000000000b0")

	jobDraftID           = uuid.MustParse("018f0000-0000-7000-8000-0000000000b1")
	jobClosedID          = uuid.MustParse("018f0000-0000-7000-8000-0000000000b2")
	jobSoftDeletedID     = uuid.MustParse("018f0000-0000-7000-8000-0000000000b3")
	jobInactiveCompanyID = uuid.MustParse("018f0000-0000-7000-8000-0000000000b4")

	jobTitleHitID = uuid.MustParse("018f0000-0000-7000-8000-0000000000c1") // "zorblax" in TITLE
	jobDescHitID  = uuid.MustParse("018f0000-0000-7000-8000-0000000000c2") // "zorblax" in DESCRIPTION only
)

// hiddenJobIDs are the rows the visibility rule must suppress everywhere.
var hiddenJobIDs = []uuid.UUID{
	jobDraftID, jobClosedID, jobSoftDeletedID, jobInactiveCompanyID,
}

// visibleJobIDsDesc is the complete visible universe in the order the
// browse-mode query must return it: `published_at DESC, id DESC` (every
// row's ts_rank is 0 when `q` is absent).
var visibleJobIDsDesc = []uuid.UUID{
	jobDescHitID,    // 2026-08-21
	jobTitleHitID,   // 2026-08-20
	jobDevOpsIntern, // 2026-08-18
	jobJuniorQAID,   // 2026-08-15
	jobMLEngID,      // 2026-08-12
	jobDataEngID,    // 2026-08-10
	jobFrontendID,   // 2026-08-05
	jobBackendGoID,  // 2026-08-01
}

// --- fixture setup ---------------------------------------------------------

// setupReadPath is the SetupTest-style helper every test here starts
// with. It skips without a database, opens a transaction that is always
// rolled back, applies the 00008 seed plus the extra visibility/FTS
// rows, and prunes every other `jobs` row so the visible universe is
// exactly `visibleJobIDsDesc`.
//
// It returns the adapter under test, bound to the transaction, so all
// reads see the fixture and nothing escapes it.
func setupReadPath(t *testing.T) (context.Context, *JobRepository) {
	t.Helper()

	pool := skipIfNoDatabaseForJobs(t)
	t.Cleanup(pool.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	// Rollback unconditionally: the fixture is destructive by design
	// (it prunes unrelated rows) and must never touch committed state.
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	requireJobsSchema(ctx, t, tx)

	for _, stmt := range []struct {
		name string
		sql  string
	}{
		{"00008 seed", seedJobsSQL},
		{"read-path extras", readPathFixtureSQL},
	} {
		if _, err := tx.Exec(ctx, stmt.sql); err != nil {
			t.Fatalf("apply %s: %v", stmt.name, err)
		}
	}

	// Prune anything outside the fixture universe so every assertion
	// below can be an exact ID list. Safe: we are inside the rollback.
	universe := append(append([]uuid.UUID{}, visibleJobIDsDesc...), hiddenJobIDs...)
	if _, err := tx.Exec(ctx,
		`DELETE FROM jobs WHERE id <> ALL($1::uuid[])`, universe,
	); err != nil {
		t.Fatalf("prune non-fixture jobs: %v", err)
	}

	return ctx, NewJobRepository(db.New(tx))
}

// requireJobsSchema fails loudly (rather than silently passing) when the
// migrations have not been applied — a green run against a missing table
// would be a false negative for every scenario in this file.
func requireJobsSchema(ctx context.Context, t *testing.T, tx pgx.Tx) {
	t.Helper()
	var hasTable bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'jobs')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("probe jobs table: %v", err)
	}
	if !hasTable {
		t.Fatal("table `jobs` is missing — run `make db-migrate` before the integration suite")
	}
}

// readPathFixtureSQL adds, on top of the 00008 seed:
//
//	b0  a SUSPENDED company (the "company is not active" case)
//	b1  a draft job          (active company)
//	b2  a closed job         (active company)
//	b3  a published job that is soft-deleted
//	b4  a published job owned by the suspended company
//	c1  "Zorblax Engineer"   — the token lives in the TITLE   (weight A)
//	c2  "Platform Engineer"  — the token lives in the DESC    (weight B)
//
// c2 is published LATER than c1 on purpose: `ORDER BY search_rank DESC,
// published_at DESC` would put c2 first on date alone, so a test that
// sees c1 first has proven RANK dominated the ordering, not recency.
const readPathFixtureSQL = `
INSERT INTO companies (id, name, rfc, industry_id, status) VALUES
    ('018f0000-0000-7000-8000-0000000000b0', 'Suspendida SA', 'SUSP010101ZZZ', 'technology', 'suspended')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

INSERT INTO jobs
    (id, company_id, title, description, work_mode, employment_type,
     seniority, status, location, salary_min, salary_max, salary_currency,
     published_at, deleted_at, created_at, updated_at)
VALUES
    ('018f0000-0000-7000-8000-0000000000b1',
     '018f0000-0000-7000-8000-000000000001',
     'Draft Backend Engineer', 'Aun no publicada.',
     'remote', 'full_time', 'senior', 'draft', 'CDMX',
     NULL, NULL, 'MXN', NULL, NULL, now(), now()),

    ('018f0000-0000-7000-8000-0000000000b2',
     '018f0000-0000-7000-8000-000000000001',
     'Closed Backend Engineer', 'Vacante cerrada.',
     'remote', 'full_time', 'senior', 'closed', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-01T12:00:00Z', NULL, now(), now()),

    ('018f0000-0000-7000-8000-0000000000b3',
     '018f0000-0000-7000-8000-000000000001',
     'Deleted Backend Engineer', 'Borrada logicamente.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-02T12:00:00Z', '2026-07-03T12:00:00Z', now(), now()),

    ('018f0000-0000-7000-8000-0000000000b4',
     '018f0000-0000-7000-8000-0000000000b0',
     'Suspended Company Engineer', 'Empresa suspendida.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     NULL, NULL, 'MXN', '2026-07-04T12:00:00Z', NULL, now(), now()),

    ('018f0000-0000-7000-8000-0000000000c1',
     '018f0000-0000-7000-8000-000000000001',
     'Zorblax Engineer', 'Trabajo de plataforma sin sorpresas.',
     'remote', 'part_time', 'mid', 'published', 'Monterrey',
     30000, 45000, 'MXN', '2026-08-20T12:00:00Z', NULL, now(), now()),

    ('018f0000-0000-7000-8000-0000000000c2',
     '018f0000-0000-7000-8000-000000000001',
     'Platform Engineer', 'Experiencia con pipelines zorblax en produccion.',
     'remote', 'part_time', 'mid', 'published', 'Monterrey',
     30000, 45000, 'MXN', '2026-08-21T12:00:00Z', NULL, now(), now())
ON CONFLICT (id) DO NOTHING;
`

// --- helpers ---------------------------------------------------------------

func idsOf(jobs []entities.Job) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, j.ID)
	}
	return out
}

func sameIDs(got, want []uuid.UUID) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// containsID reports whether id is present, so a failure message can say
// WHICH forbidden row leaked instead of just "length mismatch".
func containsID(ids []uuid.UUID, id uuid.UUID) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}

func ptr[T any](v T) *T { return &v }

// searchAll runs an unpaginated Search with the given filters.
func searchAll(ctx context.Context, t *testing.T, repo *JobRepository, p repositories.SearchParams) []entities.Job {
	t.Helper()
	if p.Limit == 0 {
		p.Limit = 100
	}
	jobs, err := repo.Search(ctx, p)
	if err != nil {
		t.Fatalf("Search(%+v): %v", p, err)
	}
	return jobs
}

// --- REQ-02: read-side visibility rule -------------------------------------

// TestSearch_ReturnsOnlyVisibleJobs proves the visibility rule at
// runtime: the eight published rows from active companies come back, in
// `published_at DESC, id DESC` order, and NONE of the four hidden rows
// leaks — draft, closed, soft-deleted, or owned by a non-active company.
func TestSearch_ReturnsOnlyVisibleJobs(t *testing.T) {
	ctx, repo := setupReadPath(t)

	got := idsOf(searchAll(ctx, t, repo, repositories.SearchParams{}))

	for _, hidden := range hiddenJobIDs {
		if containsID(got, hidden) {
			t.Errorf("hidden job %s leaked into Search results", hidden)
		}
	}
	if !sameIDs(got, visibleJobIDsDesc) {
		t.Errorf("Search order/contents mismatch\n got: %v\nwant: %v", got, visibleJobIDsDesc)
	}
}

// TestSearch_HydratesCompanyAndColumns pins that the JOIN and the
// pgtype→pointer mapping survive a real round trip: a known row comes
// back with its company name and its nullable columns populated.
func TestSearch_HydratesCompanyAndColumns(t *testing.T) {
	ctx, repo := setupReadPath(t)

	jobs := searchAll(ctx, t, repo, repositories.SearchParams{Location: ptr("Remote LATAM")})
	if len(jobs) != 1 {
		t.Fatalf("want 1 job for location 'Remote LATAM', got %d", len(jobs))
	}
	j := jobs[0]
	if j.ID != jobDataEngID {
		t.Fatalf("want %s, got %s", jobDataEngID, j.ID)
	}
	if j.Company.Name != "Globex Holdings" {
		t.Errorf("Company.Name: want %q, got %q", "Globex Holdings", j.Company.Name)
	}
	if j.Company.ID != seededCompanyIDs[1] {
		t.Errorf("Company.ID: want %s, got %s", seededCompanyIDs[1], j.Company.ID)
	}
	if j.SalaryMin == nil || *j.SalaryMin != 90000 {
		t.Errorf("SalaryMin: want 90000, got %v", j.SalaryMin)
	}
	if j.PublishedAt == nil {
		t.Error("PublishedAt: want non-nil on a published row, got nil")
	}
}

// TestGetByID_ReturnsVisibleJob covers the happy path of the detail
// endpoint against real SQL.
func TestGetByID_ReturnsVisibleJob(t *testing.T) {
	ctx, repo := setupReadPath(t)

	j, err := repo.GetByID(ctx, jobBackendGoID)
	if err != nil {
		t.Fatalf("GetByID(visible): %v", err)
	}
	if j.ID != jobBackendGoID {
		t.Errorf("ID: want %s, got %s", jobBackendGoID, j.ID)
	}
	if j.Company.Name != "Acme SA" {
		t.Errorf("Company.Name: want %q, got %q", "Acme SA", j.Company.Name)
	}
	if j.Rank != nil {
		t.Errorf("Rank: want nil on GetByID, got %v", *j.Rank)
	}
}

// TestGetByID_HidesNonVisibleJobs is the REQ-02 counterpart for the
// detail endpoint: every invisible shape must be indistinguishable from
// "does not exist" (ErrJobNotFound → 404), never a leaked row.
func TestGetByID_HidesNonVisibleJobs(t *testing.T) {
	ctx, repo := setupReadPath(t)

	tests := []struct {
		name string
		id   uuid.UUID
	}{
		{"draft job", jobDraftID},
		{"closed job", jobClosedID},
		{"soft-deleted job", jobSoftDeletedID},
		{"job of a non-active company", jobInactiveCompanyID},
		{"unknown id", uuid.MustParse("018f0000-0000-7000-8000-0000000000ff")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := repo.GetByID(ctx, tt.id)
			if !errors.Is(err, entities.ErrJobNotFound) {
				t.Fatalf("want ErrJobNotFound, got job=%v err=%v", got, err)
			}
		})
	}
}

// --- REQ-05: full-text search ---------------------------------------------

// TestSearch_TitleHitOutranksDescriptionHit is the weighting proof.
// Both fixture rows contain "zorblax"; only the ordering distinguishes
// them, and the description-hit row is published LATER so recency alone
// would invert the result. Seeing the title row first means
// `setweight(title,'A') > setweight(description,'B')` drove the order.
func TestSearch_TitleHitOutranksDescriptionHit(t *testing.T) {
	ctx, repo := setupReadPath(t)

	jobs := searchAll(ctx, t, repo, repositories.SearchParams{Q: ptr("zorblax")})
	got := idsOf(jobs)
	want := []uuid.UUID{jobTitleHitID, jobDescHitID}
	if !sameIDs(got, want) {
		t.Fatalf("q=zorblax\n got: %v\nwant: %v (title hit must outrank description hit)", got, want)
	}

	// The ordering above must come from the rank, so the ranks must
	// actually differ — equal ranks would mean the assertion passed on
	// a tie-break accident.
	if jobs[0].Rank == nil || jobs[1].Rank == nil {
		t.Fatalf("search mode must populate Rank, got %v / %v", jobs[0].Rank, jobs[1].Rank)
	}
	if !(*jobs[0].Rank > *jobs[1].Rank) {
		t.Errorf("title rank %v must be strictly greater than description rank %v",
			*jobs[0].Rank, *jobs[1].Rank)
	}
}

// TestSearch_NonMatchingQueryReturnsNothing covers the other end of
// REQ-05: a term present in no document yields an empty page (not the
// unfiltered listing).
func TestSearch_NonMatchingQueryReturnsNothing(t *testing.T) {
	ctx, repo := setupReadPath(t)

	jobs := searchAll(ctx, t, repo, repositories.SearchParams{Q: ptr("quetzalcoatlus")})
	if len(jobs) != 0 {
		t.Errorf("want 0 rows for a non-matching q, got %d (%v)", len(jobs), idsOf(jobs))
	}
}

// TestSearch_MalformedQueryDoesNotError proves the `websearch_to_tsquery`
// choice at the DB level (not just at the handler): input that would make
// `to_tsquery` raise a syntax error must come back as a normal result set.
func TestSearch_MalformedQueryDoesNotError(t *testing.T) {
	ctx, repo := setupReadPath(t)

	for _, q := range []string{"go:", "!!!", "a & | b", `"unbalanced`} {
		if _, err := repo.Search(ctx, repositories.SearchParams{Q: ptr(q), Limit: 100}); err != nil {
			t.Errorf("Search(q=%q): want no error (safe parser), got %v", q, err)
		}
	}
}

// TestSearch_AbsentQueryReturnsAllVisible pins the browse-mode sentinel:
// with no `q`, `COALESCE(...,”)` degenerates the tsquery and every
// visible row is returned.
func TestSearch_AbsentQueryReturnsAllVisible(t *testing.T) {
	ctx, repo := setupReadPath(t)

	got := idsOf(searchAll(ctx, t, repo, repositories.SearchParams{}))
	if len(got) != len(visibleJobIDsDesc) {
		t.Errorf("absent q: want %d visible rows, got %d", len(visibleJobIDsDesc), len(got))
	}
}

// --- REQ-06: listing filters ----------------------------------------------

// TestSearch_FiltersNarrowResults walks every filter the spec defines,
// as an exact ID list per case. `location` is asserted in lowercase to
// prove the ILIKE substring semantics (the stored values are 'Guadalajara'
// and 'Remote LATAM').
func TestSearch_FiltersNarrowResults(t *testing.T) {
	ctx, repo := setupReadPath(t)

	tests := []struct {
		name   string
		params repositories.SearchParams
		want   []uuid.UUID
	}{
		{
			name:   "no filters returns every visible job",
			params: repositories.SearchParams{},
			want:   visibleJobIDsDesc,
		},
		{
			name:   "seniority equality",
			params: repositories.SearchParams{Seniority: ptr("senior")},
			want:   []uuid.UUID{jobDataEngID, jobBackendGoID},
		},
		{
			name:   "work_mode equality",
			params: repositories.SearchParams{WorkMode: ptr("onsite")},
			want:   []uuid.UUID{jobJuniorQAID},
		},
		{
			name:   "employment_type equality",
			params: repositories.SearchParams{EmploymentType: ptr("internship")},
			want:   []uuid.UUID{jobDevOpsIntern},
		},
		{
			name:   "salary_currency equality (no FX conversion)",
			params: repositories.SearchParams{SalaryCurrency: ptr("USD")},
			want:   []uuid.UUID{jobMLEngID, jobDataEngID},
		},
		{
			name:   "location ILIKE substring, case-insensitive",
			params: repositories.SearchParams{Location: ptr("guadalajara")},
			want:   []uuid.UUID{jobDevOpsIntern, jobJuniorQAID},
		},
		{
			name: "combined filters AND together",
			params: repositories.SearchParams{
				Seniority: ptr("senior"),
				WorkMode:  ptr("remote"),
			},
			want: []uuid.UUID{jobDataEngID, jobBackendGoID},
		},
		{
			name: "combined filters that intersect on nothing",
			params: repositories.SearchParams{
				Seniority: ptr("intern"),
				WorkMode:  ptr("onsite"),
			},
			want: []uuid.UUID{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := idsOf(searchAll(ctx, t, repo, tt.params))
			if !sameIDs(got, tt.want) {
				t.Errorf("\n got: %v\nwant: %v", got, tt.want)
			}
		})
	}
}

// TestSearch_DroppedEnumFilterReturnsUnfilteredListing is the SQL-side
// half of the REQ-06 scenario "invalid filter value is ignored". The use
// case drops an out-of-domain value to nil (unit-tested); this proves
// what nil then MEANS in SQL — the predicate degenerates to TRUE and the
// caller gets the full listing, not an empty page.
func TestSearch_DroppedEnumFilterReturnsUnfilteredListing(t *testing.T) {
	ctx, repo := setupReadPath(t)

	unfiltered := idsOf(searchAll(ctx, t, repo, repositories.SearchParams{Seniority: nil}))
	if !sameIDs(unfiltered, visibleJobIDsDesc) {
		t.Errorf("nil seniority must behave as unfiltered\n got: %v\nwant: %v",
			unfiltered, visibleJobIDsDesc)
	}

	// Contrast: the raw value the use case now refuses to forward would
	// have produced an empty page. This documents the defect the drop
	// rule exists to prevent.
	outOfDomain := idsOf(searchAll(ctx, t, repo, repositories.SearchParams{Seniority: ptr("expert")}))
	if len(outOfDomain) != 0 {
		t.Fatalf("precondition: 'expert' must match no row, got %v", outOfDomain)
	}
}

// --- REQ-07: keyset pagination ---------------------------------------------

// walkAllPages drives the real use case over the real adapter, following
// `next_cursor` until it is nil, and returns the concatenated ids plus
// the number of pages. It fails the test if the walk does not terminate,
// which is the failure mode a broken keyset predicate produces.
func walkAllPages(ctx context.Context, t *testing.T, svc *usecases.JobService, in dtos.SearchJobsDto) ([]string, int) {
	t.Helper()

	const maxPages = 50 // generous ceiling; the fixture needs a handful
	var ids []string
	pages := 0

	for {
		res, err := svc.SearchJobs(ctx, in)
		if err != nil {
			t.Fatalf("SearchJobs(page %d): %v", pages+1, err)
		}
		pages++
		for _, item := range res.Items {
			ids = append(ids, item.ID)
		}
		if res.NextCursor == nil {
			return ids, pages
		}
		if pages >= maxPages {
			t.Fatalf("keyset walk did not terminate after %d pages (cursor never went nil)", maxPages)
		}
		in.Cursor = res.NextCursor
	}
}

// TestKeysetPagination_BrowseModeVisitsEveryRowExactlyOnce is the
// REQ-07 stability proof for browse mode: paginating a set larger than
// the page size must yield exactly the same sequence as one unpaginated
// query — no row skipped, none duplicated, order preserved.
func TestKeysetPagination_BrowseModeVisitsEveryRowExactlyOnce(t *testing.T) {
	ctx, repo := setupReadPath(t)
	svc := usecases.NewJobService(repo)

	const pageSize = 3 // 8 visible rows → 3 pages (3 + 3 + 2)

	walked, pages := walkAllPages(ctx, t, svc, dtos.SearchJobsDto{Limit: pageSize})

	want := make([]string, 0, len(visibleJobIDsDesc))
	for _, id := range visibleJobIDsDesc {
		want = append(want, id.String())
	}

	assertKeysetWalk(t, walked, want)
	if pages < 2 {
		t.Errorf("fixture must span more than one page, got %d page(s)", pages)
	}
}

// TestKeysetPagination_SearchModeVisitsEveryRowExactlyOnce is the
// harder case: with `q` set, every matching row scores the SAME ts_rank
// (one title occurrence each), so the leading rank component of the
// cursor ties on every comparison and only the `(published_at, id)`
// tail can advance the page. A 2-tuple-only or rank-only comparator
// would skip or repeat rows here.
func TestKeysetPagination_SearchModeVisitsEveryRowExactlyOnce(t *testing.T) {
	ctx, repo := setupReadPath(t)
	svc := usecases.NewJobService(repo)

	const q = "engineer"

	// Baseline: the full result set in one shot, straight from the adapter.
	baseline := searchAll(ctx, t, repo, repositories.SearchParams{Q: ptr(q)})
	if len(baseline) < 4 {
		t.Fatalf("fixture precondition: q=%q must match at least 4 rows, matched %d", q, len(baseline))
	}
	want := make([]string, 0, len(baseline))
	for _, j := range baseline {
		want = append(want, j.ID.String())
	}

	walked, pages := walkAllPages(ctx, t, svc, dtos.SearchJobsDto{Q: ptr(q), Limit: 2})

	assertKeysetWalk(t, walked, want)
	if pages < 2 {
		t.Errorf("search-mode fixture must span more than one page, got %d page(s)", pages)
	}
}

// TestKeysetPagination_CursorPastTheEndReturnsEmpty covers the REQ-07
// scenario "cursor past the end returns empty". The use case never emits
// such a cursor on its own — the last page correctly hands back nil —
// so the probe is a hand-built cursor anchored before every row, which
// is what a stale client-held cursor looks like after the rows it
// pointed past were unpublished.
func TestKeysetPagination_CursorPastTheEndReturnsEmpty(t *testing.T) {
	ctx, repo := setupReadPath(t)
	svc := usecases.NewJobService(repo)

	// Sanity: a page smaller than the visible set hands back a cursor,
	// and the page that exhausts the set does not.
	first, err := svc.SearchJobs(ctx, dtos.SearchJobsDto{Limit: len(visibleJobIDsDesc) - 1})
	if err != nil {
		t.Fatalf("SearchJobs(page 1): %v", err)
	}
	if first.NextCursor == nil {
		t.Fatal("page 1 must hand back a cursor when a row remains")
	}
	last, err := svc.SearchJobs(ctx, dtos.SearchJobsDto{
		Limit:  len(visibleJobIDsDesc) - 1,
		Cursor: first.NextCursor,
	})
	if err != nil {
		t.Fatalf("SearchJobs(page 2): %v", err)
	}
	if len(last.Items) != 1 {
		t.Errorf("final page: want the 1 remaining row, got %d", len(last.Items))
	}
	if last.NextCursor != nil {
		t.Errorf("final page: want no cursor, got %q", *last.NextCursor)
	}

	// The past-the-end probe: an anchor older than every visible row,
	// so the keyset predicate `(rank, published_at, id) < anchor`
	// excludes everything.
	pastTheEnd := cursor.Encode(&repositories.Cursor{
		Rank:        nil,
		PublishedAt: time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC),
		ID:          uuid.Nil,
	})

	past, err := svc.SearchJobs(ctx, dtos.SearchJobsDto{
		Limit:  len(visibleJobIDsDesc),
		Cursor: &pastTheEnd,
	})
	if err != nil {
		t.Fatalf("SearchJobs(past the end): %v", err)
	}
	if len(past.Items) != 0 {
		t.Errorf("past-the-end page: want 0 items, got %d (%v)", len(past.Items), past.Items)
	}
	if past.NextCursor != nil {
		t.Errorf("past-the-end page: want no cursor, got %q", *past.NextCursor)
	}
}

// assertKeysetWalk reports the three distinct failure modes separately —
// duplicates, missing rows, wrong order — so a red run names the actual
// defect instead of dumping two slices.
func assertKeysetWalk(t *testing.T, walked, want []string) {
	t.Helper()

	seen := make(map[string]int, len(walked))
	for _, id := range walked {
		seen[id]++
	}
	for id, n := range seen {
		if n > 1 {
			t.Errorf("row %s appeared on %d pages (keyset duplicated it)", id, n)
		}
	}
	for _, id := range want {
		if seen[id] == 0 {
			t.Errorf("row %s was never returned (keyset skipped it)", id)
		}
	}
	if len(walked) != len(want) {
		t.Errorf("walked %d rows, want %d", len(walked), len(want))
		return
	}
	for i := range walked {
		if walked[i] != want[i] {
			t.Errorf("page walk order diverges at index %d: got %s, want %s", i, walked[i], want[i])
			return
		}
	}
}
