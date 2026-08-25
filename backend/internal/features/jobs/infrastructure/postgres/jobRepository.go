// Package postgres implements the jobs persistence ports against PostgreSQL.
//
// The adapter is the only place where the sqlc-generated `db.SearchJobsRow`
// and `db.GetJobByIDRow` types are converted into domain entities. The
// domain layer never imports `internal/db` so the conversion is locked
// behind this seam — the entities, VOs, and the `JobRepository` port
// stay free of generated SQL types.
//
// Read-only slice: only `Search` and `GetByID` are exposed here. Write
// flows (POST /jobs, status transitions) live on a future adapter.
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// JobRepository is the PostgreSQL adapter for the repositories.JobRepository port.
type JobRepository struct {
	queries *db.Queries
}

// NewJobRepository wraps the sqlc-generated data layer.
func NewJobRepository(queries *db.Queries) *JobRepository {
	return &JobRepository{queries: queries}
}

// Compile-time assertion: the adapter satisfies the domain port. If a
// future refactor drifts the surface, this line refuses to compile
// rather than waiting for a wiring/runtime surprise in `cmd/api/main.go`.
var _ repositories.JobRepository = (*JobRepository)(nil)

// Search fetches the public job list. The use-case layer is responsible
// for inflating the page size to limit+1 before forwarding it; the
// adapter passes `SearchParams.Limit` AS-IS to sqlc (no further +1).
// `Search` returns the rows in the order the SQL `ORDER BY` produced
// (search_rank DESC, published_at DESC, id DESC) so the use case can
// drop the trailing +1 sentinel and encode the next cursor from the
// last visible row.
//
// `Job.Rank` is populated ONLY when `SearchParams.Q != nil` (search
// mode). Browse mode (`Q == nil`) leaves `Rank` nil so the cursor
// codec stays in 2-tuple land.
func (r *JobRepository) Search(ctx context.Context, p repositories.SearchParams) ([]entities.Job, error) {
	isSearchMode := p.Q != nil
	rows, err := r.queries.SearchJobs(ctx, buildSearchParams(p))
	if err != nil {
		return nil, err
	}

	out := make([]entities.Job, 0, len(rows))
	for _, row := range rows {
		j, err := toEntity(row, isSearchMode)
		if err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, nil
}

// GetByID fetches a single visible job. The visibility rule
// (status='published', deleted_at IS NULL, owning company.status='active')
// is enforced in SQL inside `db.Queries.GetJobByID`; the adapter only
// translates pgx.ErrNoRows into `entities.ErrJobNotFound` and maps the
// row into the domain entity. GetByID NEVER populates `Job.Rank` —
// search rank is only meaningful for the list endpoint.
func (r *JobRepository) GetByID(ctx context.Context, id uuid.UUID) (*entities.Job, error) {
	row, err := r.queries.GetJobByID(ctx, id)
	if err != nil {
		return nil, mapGetError(err)
	}
	j, err := toEntityFromGetByID(row, false)
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// GetForUpdate fetches a single job for the gated write path. The
// visibility rule is INTENTIONALLY OMITTED — the write path must see
// drafts (so a recruiter can publish them) and closed rows (so the
// use case can reject them with the terminal-rule 400). Only the
// company scope and `deleted_at IS NULL` apply, exactly as the D3 SQL
// pins.
//
// 0 rows (non-existent, cross-company, soft-deleted) all surface as
// entities.ErrJobNotFound — the use case treats them indistinguishably
// per the same-company invariant (design D4, spec scenarios
// "cross-company id returns 404" / "soft-deleted id returns 404" /
// "non-existent id returns 404").
//
// The returned JobForUpdate is rebuilt by `toJobForUpdateEntity` from
// the sqlc row. VOs are parsed via Parse* so an unrecognized DB value
// fails loud (defense-in-depth — the DB CHECK should make this
// unreachable). UpdatedAt comes back as a non-pointer time.Time
// because the row's `updated_at` is NOT NULL.
func (r *JobRepository) GetForUpdate(ctx context.Context, id, companyID uuid.UUID) (*entities.JobForUpdate, error) {
	row, err := r.queries.GetJobForUpdate(ctx, db.GetJobForUpdateParams{
		ID:        id,
		CompanyID: companyID,
	})
	if err != nil {
		return nil, mapGetError(err)
	}
	j, err := toJobForUpdateEntity(row)
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// Update applies the patch atomically, guarded by the active-company
// CTE (D1/D2), the row predicates (id, company_id, deleted_at IS NULL),
// and CAS `updated_at = casUpdatedAt`. The D1 SQL is `:one` and emits a
// scalar SELECT returning {guard_passed, updated_count}, which the
// adapter inspects to distinguish the three outcomes:
//   - guard_passed = false → ErrCompanyNotActive (suspended /
//     pending_verification / missing company). The row is NOT updated.
//   - guard_passed = true, updated_count = 0 → ErrJobNotFound (CAS lost
//     OR cross-company OR soft-delete race WITH an active company — D3).
//     The use case re-reads and re-interprets as ErrConcurrencyConflict.
//   - guard_passed = true, updated_count = 1 → success (1 row affected).
//
// The D1 SQL sets `updated_at = now()` on a successful update, so the
// authoritative post-write value is the next GetForUpdate's result
// (the use case re-reads to obtain it — design D5 step 8).
//
// Returns:
//
//   - nil                                  on success (guard passed, 1 row)
//   - entities.ErrCompanyNotActive         on guard miss (suspended/pending/missing)
//   - entities.ErrJobNotFound              on CAS lost / cross-company / soft-delete race
//   - entities.ErrInvalidStatusTransition  on SQLSTATE 23514 (CHECK violation
//     — defense-in-depth; unreachable
//     via the designed flow)
//   - other error                          propagated untouched (HTTP 500)
func (r *JobRepository) Update(ctx context.Context, id, companyID uuid.UUID, patch repositories.UpdatePatch, casUpdatedAt time.Time) error {
	row, err := r.queries.UpdateJob(ctx, buildUpdateJobParams(id, companyID, patch, casUpdatedAt))
	if err != nil {
		return mapUpdateError(err)
	}
	if !row.GuardPassed {
		return entities.ErrCompanyNotActive
	}
	if row.UpdatedCount == 0 {
		return entities.ErrJobNotFound
	}
	return nil
}

// SoftDelete tombstones the row (`deleted_at = now()`) atomically,
// guarded by the active-company CTE (D1/D2), the row predicates
// (id, company_id, deleted_at IS NULL), and CAS
// `updated_at = casUpdatedAt`. The D1 SQL is `:one` and emits a
// scalar SELECT returning {guard_passed, deleted_count}; the adapter
// inspects it to distinguish the three outcomes (design D2):
//
//   - guard_passed = false → entities.ErrCompanyNotActive
//     (suspended / pending / missing company). The row is NOT
//     tombstoned.
//   - guard_passed = true,  deleted_count = 0
//     → entities.ErrJobNotFound (CAS lost / already-soft-deleted /
//     cross-company race with an active company — D2 residual race;
//     the use case does NOT re-read, mapped to 404).
//   - guard_passed = true,  deleted_count = 1 → nil (success: 1 row
//     tombstoned).
//
// The minimal SET list (`deleted_at`, `updated_at`) preserves every
// other column as audit history (design D1): `published_at`,
// `title`, `description`, `status`, `work_mode`, `employment_type`,
// `seniority`, `location`, `salary_min`, `salary_max`,
// `salary_currency`, `company_id`, `created_at`, `id` are NOT touched.
// `search_vector` (STORED generated) is naturally unchanged because
// its inputs (`title`, `description`) are not touched.
//
// Returns:
//
//   - nil                                  on success (guard passed, 1 row)
//   - entities.ErrCompanyNotActive         on guard miss (suspended / pending / missing)
//   - entities.ErrJobNotFound              on guard passed but 0 rows affected
//     (D2 residual race — mapped to 404, no re-read)
//   - entities.ErrInvalidStatusTransition  on SQLSTATE 23514 (CHECK violation —
//     defense-in-depth; the minimal SET
//     list cannot trip a CHECK on the
//     designed flow)
//   - other error                          propagated untouched (HTTP 500)
func (r *JobRepository) SoftDelete(ctx context.Context, id, companyID uuid.UUID, casUpdatedAt time.Time) error {
	row, err := r.queries.SoftDeleteJob(ctx, buildSoftDeleteJobParams(id, companyID, casUpdatedAt))
	if err != nil {
		return mapSoftDeleteError(err)
	}
	if !row.GuardPassed {
		return entities.ErrCompanyNotActive
	}
	if row.DeletedCount == 0 {
		return entities.ErrJobNotFound
	}
	return nil
}

// Create atomically inserts a draft job owned by `companyID`, guarded
// by the active-company predicate inside the same SQL statement
// (design D1/D2/D3). The use case owns UUID generation (id) and VO
// parsing; the adapter maps parsed VOs to canonical wire strings and
// optional pointers to nullable pgtypes.
//
// On success the returned *entities.JobForUpdate lets the use case
// reuse `toEditorView` verbatim — no parallel projection is needed
// (D2: the row set CreateJob emits matches GetJobForUpdate's 15 cols).
//
// Error contract:
//
//   - entities.ErrCompanyNotActive       on 0 rows (the CTE guard
//     matches no active company;
//     pgx.ErrNoRows → here).
//   - entities.ErrCompanyGone            on SQLSTATE 23503 (FK
//     violation on
//     jobs.company_id; defense-
//     in-depth — the CTE
//     filters to existing
//     active companies).
//   - entities.ErrInvalidStatusTransition on SQLSTATE 23514 (CHECK
//     violation; defense-in-
//     depth — the use case
//     parses VOs before SQL).
//   - other error                         propagated untouched
//     (HTTP 500).
func (r *JobRepository) Create(ctx context.Context, id, companyID uuid.UUID, params repositories.CreateJobParams) (*entities.JobForUpdate, error) {
	row, err := r.queries.CreateJob(ctx, buildCreateJobParams(id, companyID, params))
	if err != nil {
		return nil, mapCreateError(err)
	}
	j, err := toJobForUpdateEntity(createRowToGetForUpdateRow(row))
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// buildSearchParams translates the domain SearchParams into the sqlc
// `SearchJobsParams` struct. Every optional input collapses to an
// invalid pgtype (SQL NULL) when the caller passed nil/empty so the
// SQL `narg(... ) IS NULL OR …` predicates degenerate to TRUE.
//
// The cursor splits across three pgtypes (ts, id, rank) — all invalid
// when `SearchParams.Cursor == nil`; when the cursor is non-nil, ts
// and id are populated unconditionally and rank is set ONLY when the
// caller already has a non-nil `Cursor.Rank` (browse cursors leave it
// invalid so the SQL `COALESCE(.., 0)` substitute drives the 3-tuple
// keyset to a 2-tuple comparator — see design.md Decision 3).
//
// `Limit` is forwarded verbatim; the use case inflates to limit+1
// before calling, so the adapter MUST NOT add another +1 (it would
// drop one row from every page).
func buildSearchParams(p repositories.SearchParams) db.SearchJobsParams {
	return db.SearchJobsParams{
		Q:              strPtrToText(p.Q),
		Seniority:      strPtrToText(p.Seniority),
		WorkMode:       strPtrToText(p.WorkMode),
		EmploymentType: strPtrToText(p.EmploymentType),
		Location:       strPtrToText(p.Location),
		SalaryCurrency: strPtrToText(p.SalaryCurrency),

		CursorTs:   cursorTsToPgTimestamptz(p.Cursor),
		CursorID:   cursorIDToPgUUID(p.Cursor),
		CursorRank: cursorRankToPgFloat8(p.Cursor),

		Limit: pgtype.Int4{Int32: int32(p.Limit), Valid: true},
	}
}

// strPtrToText folds `*string` into a `pgtype.Text`. Valid=false when
// nil so the SQL predicate collapses to TRUE (no filter).
func strPtrToText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// cursorTsToPgTimestamptz lifts the cursor's `PublishedAt` into a
// pgtype.Timestamptz. Invalid when the cursor is nil (first page).
func cursorTsToPgTimestamptz(c *repositories.Cursor) pgtype.Timestamptz {
	if c == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: c.PublishedAt, Valid: true}
}

// cursorIDToPgUUID lifts the cursor's ID into pgtype.UUID. Invalid
// when the cursor is nil.
func cursorIDToPgUUID(c *repositories.Cursor) pgtype.UUID {
	if c == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: c.ID, Valid: true}
}

// cursorRankToPgFloat8 lifts the cursor's Rank *float64 into a
// pgtype.Float8. Invalid when either the cursor is nil OR the cursor
// is browse-mode (Rank nil). Only search-mode cursors carry a rank.
func cursorRankToPgFloat8(c *repositories.Cursor) pgtype.Float8 {
	if c == nil || c.Rank == nil {
		return pgtype.Float8{}
	}
	return pgtype.Float8{Float64: *c.Rank, Valid: true}
}

// toEntity rebuilds a domain Job from a sqlc SearchJobsRow.
//
// VOs are reconstructed via Parse* so an unrecognized DB value (which
// would only happen if someone bypassed the CHECK constraint) FAILS
// LOUD rather than silently zeroing — a corrupted row never reaches
// the wire. Optional DB columns (location, salary_min, salary_max,
// published_at) translate to pointers through the pgtype `Valid` flag.
//
// `populateRank` is true only when Search (not GetByID) is the call
// site AND the caller asked for search mode (Q != nil). In browse
// mode `Rank` MUST be nil so the use case doesn't smuggle an empty
// rank into the next-page cursor.
func toEntity(row db.SearchJobsRow, populateRank bool) (entities.Job, error) {
	wm, err := valueobjects.ParseWorkMode(row.WorkMode)
	if err != nil {
		return entities.Job{}, err
	}
	et, err := valueobjects.ParseEmploymentType(row.EmploymentType)
	if err != nil {
		return entities.Job{}, err
	}
	sn, err := valueobjects.ParseSeniority(row.Seniority)
	if err != nil {
		return entities.Job{}, err
	}
	st, err := valueobjects.ParseJobStatus(row.Status)
	if err != nil {
		return entities.Job{}, err
	}
	cur, err := valueobjects.ParseSalaryCurrency(row.SalaryCurrency)
	if err != nil {
		return entities.Job{}, err
	}

	j := entities.Job{
		ID:             row.ID,
		Title:          row.Title,
		Description:    row.Description,
		WorkMode:       wm,
		EmploymentType: et,
		Seniority:      sn,
		JobStatus:      st,
		Location:       pgTextToStringPtr(row.Location),
		SalaryMin:      pgInt4ToIntPtr(row.SalaryMin),
		SalaryMax:      pgInt4ToIntPtr(row.SalaryMax),
		SalaryCurrency: cur,
		PublishedAt:    pgTimestamptzToTimePtr(row.PublishedAt),
		Company: entities.CompanyRef{
			ID:   row.CompanyID,
			Name: row.CompanyName,
		},
	}

	if populateRank {
		// sqlc maps PostgreSQL `real` (the return type of ts_rank) to
		// Go float32 — widen to float64 here so the domain entity and
		// the search-keyset cursor codec see a single representation
		// (the cursor codec encodes *float64, not *float32).
		rank := float64(row.SearchRank)
		j.Rank = &rank
	}

	return j, nil
}

// toEntityFromGetByID mirrors `toEntity` for `db.GetJobByIDRow`. sqlc
// emits distinct row types per query even when the column lists
// overlap; this thin wrapper projects the detail row onto the search
// shape so the shared builder can run unchanged. The `populateRank`
// flag is forced false at every call site: GetByID has no meaningful
// rank (no `q`, no keyset), so the field stays nil regardless of
// what `populateRank` is here — the boolean is kept only to keep the
// signatures symmetric and the call site readable.
func toEntityFromGetByID(row db.GetJobByIDRow, populateRank bool) (entities.Job, error) {
	return toEntity(getByIDToSearchRow(row), populateRank)
}

// getByIDToSearchRow lifts a `db.GetJobByIDRow` onto the search-row
// shape. The column lists are identical except for `SearchRank` (a
// search-only projection); the zero value is correct because the
// caller always passes `populateRank=false`.
func getByIDToSearchRow(row db.GetJobByIDRow) db.SearchJobsRow {
	return db.SearchJobsRow{
		ID:             row.ID,
		Title:          row.Title,
		Description:    row.Description,
		Location:       row.Location,
		WorkMode:       row.WorkMode,
		EmploymentType: row.EmploymentType,
		Seniority:      row.Seniority,
		SalaryMin:      row.SalaryMin,
		SalaryMax:      row.SalaryMax,
		SalaryCurrency: row.SalaryCurrency,
		Status:         row.Status,
		PublishedAt:    row.PublishedAt,
		DeletedAt:      row.DeletedAt,
		CompanyID:      row.CompanyID,
		CompanyName:    row.CompanyName,
		SearchRank:     0,
	}
}

// --- pgtype helpers (mirror `companyRepository.go`) ----------------------

func pgTextToStringPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}

func pgInt4ToIntPtr(t pgtype.Int4) *int {
	if !t.Valid {
		return nil
	}
	v := int(t.Int32)
	return &v
}

func pgTimestamptzToTimePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

// mapGetError translates pgx errors into domain sentinels. The
// visibility rule is enforced in SQL, so the only mapping GetByID
// needs is `pgx.ErrNoRows` → `entities.ErrJobNotFound`. Any other
// error propagates untouched so the HTTP layer can log it as a 500.
func mapGetError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrJobNotFound
	}
	return err
}

// --- write-path helpers (Phase 3.2, design D4) ----------------------------

// buildUpdateJobParams translates the domain UpdatePatch into the sqlc
// `UpdateJobParams` struct. Three field shapes per the D3 SQL:
//
//   - Pointer-typed field (Title, Description, WorkMode, EmploymentType,
//     Seniority, SalaryCurrency, Status): nil pointer → invalid pgtype
//     (COALESCE branch degenerates to column value); non-nil → valid
//     pgtype carrying the canonical String() form.
//   - Optional[T] for the nullable trio: Set=false → flag false AND
//     value invalid (untouched); Set=true,Valid=false → flag true AND
//     value invalid (clear to NULL); Set=true,Valid=true → flag true
//     AND value valid (set to value).
//   - Identity columns (ID, CompanyID, CasToken) are always populated.
func buildUpdateJobParams(id, companyID uuid.UUID, patch repositories.UpdatePatch, casUpdatedAt time.Time) db.UpdateJobParams {
	return db.UpdateJobParams{
		Title:          strPtrToText(patch.Title),
		Description:    strPtrToText(patch.Description),
		WorkMode:       workModeToText(patch.WorkMode),
		EmploymentType: employmentTypeToText(patch.EmploymentType),
		Seniority:      seniorityToText(patch.Seniority),
		SalaryCurrency: salaryCurrencyToText(patch.SalaryCurrency),

		SetLocation:  patch.Location.Set,
		Location:     optionalStringToText(patch.Location),
		SetSalaryMin: patch.SalaryMin.Set,
		SalaryMin:    optionalIntToInt4(patch.SalaryMin),
		SetSalaryMax: patch.SalaryMax.Set,
		SalaryMax:    optionalIntToInt4(patch.SalaryMax),

		Status:    jobStatusToText(patch.Status),
		ID:        id,
		CompanyID: companyID,
		CasToken:  pgtype.Timestamptz{Time: casUpdatedAt, Valid: true},
	}
}

// strPtrToText folds `*string` into a `pgtype.Text`. Valid=false when
// nil so the SQL `COALESCE(NULL, col)` degenerates to the column.
// (Reused by the write-path buildUpdateJobParams; the read path's
// buildSearchParams uses it the same way.)

// workModeToText is the VO-typed wrapper around strPtrToText: a
// non-nil *valueobjects.WorkMode canonicalizes via .String() so the
// adapter never serializes an iota int to SQL.
func workModeToText(w *valueobjects.WorkMode) pgtype.Text {
	if w == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: w.String(), Valid: true}
}

func employmentTypeToText(e *valueobjects.EmploymentType) pgtype.Text {
	if e == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: e.String(), Valid: true}
}

func seniorityToText(s *valueobjects.Seniority) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s.String(), Valid: true}
}

func salaryCurrencyToText(c *valueobjects.SalaryCurrency) pgtype.Text {
	if c == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: c.String(), Valid: true}
}

func jobStatusToText(s *valueobjects.JobStatus) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s.String(), Valid: true}
}

// optionalStringToText renders the tri-state Optional[string] into a
// pgtype.Text. The Set flag drives the SQL CASE branch; the Valid
// flag drives the actual column value.
func optionalStringToText(o valueobjects.Optional[string]) pgtype.Text {
	if !o.Set {
		return pgtype.Text{}
	}
	if !o.Valid {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: o.Value, Valid: true}
}

func optionalIntToInt4(o valueobjects.Optional[int]) pgtype.Int4 {
	if !o.Set {
		return pgtype.Int4{}
	}
	if !o.Valid {
		return pgtype.Int4{Valid: false}
	}
	return pgtype.Int4{Int32: int32(o.Value), Valid: true}
}

// toJobForUpdateEntity rebuilds a domain JobForUpdate from the sqlc
// row. VOs are parsed through the closed-set codecs so an
// unrecognized DB value (which would only happen if someone bypassed
// the CHECK constraint) FAILS LOUD rather than silently zeroing — a
// corrupted row never reaches the wire.
//
// Optional DB columns (Location, SalaryMin, SalaryMax, PublishedAt)
// translate to pointers through the pgtype `Valid` flag. `UpdatedAt`
// is the NOT-NULL column at the bottom of the row; we defensively
// return the zero time on !Valid but this is unreachable for the
// `jobs` table.
func toJobForUpdateEntity(row db.GetJobForUpdateRow) (entities.JobForUpdate, error) {
	wm, err := valueobjects.ParseWorkMode(row.WorkMode)
	if err != nil {
		return entities.JobForUpdate{}, err
	}
	et, err := valueobjects.ParseEmploymentType(row.EmploymentType)
	if err != nil {
		return entities.JobForUpdate{}, err
	}
	sn, err := valueobjects.ParseSeniority(row.Seniority)
	if err != nil {
		return entities.JobForUpdate{}, err
	}
	st, err := valueobjects.ParseJobStatus(row.Status)
	if err != nil {
		return entities.JobForUpdate{}, err
	}
	cur, err := valueobjects.ParseSalaryCurrency(row.SalaryCurrency)
	if err != nil {
		return entities.JobForUpdate{}, err
	}

	return entities.JobForUpdate{
		ID:             row.ID,
		Title:          row.Title,
		Description:    row.Description,
		WorkMode:       wm,
		EmploymentType: et,
		Seniority:      sn,
		JobStatus:      st,
		Location:       pgTextToStringPtr(row.Location),
		SalaryMin:      pgInt4ToIntPtr(row.SalaryMin),
		SalaryMax:      pgInt4ToIntPtr(row.SalaryMax),
		SalaryCurrency: cur,
		PublishedAt:    pgTimestamptzToTimePtr(row.PublishedAt),
		UpdatedAt:      pgTimestamptzToTime(row.UpdatedAt),
		Company: entities.CompanyRef{
			ID:   row.CompanyID,
			Name: row.CompanyName,
		},
	}, nil
}

// pgTimestamptzToTime extracts a non-pointer time.Time from a
// pgtype.Timestamptz, returning the zero value on !Valid. Mirrors the
// companies adapter; defined here too to avoid a cross-feature import.
func pgTimestamptzToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

// mapUpdateError translates Postgres errors surfaced by UpdateJob
// into domain sentinels. The active-company guard is in the SQL CTE
// (D1), and the guard outcome is observable via the row's GuardPassed
// flag (the designed path). pgx.ErrNoRows is unreachable via the
// designed flow (the :one scalar SELECT always returns exactly one
// row), but it is mapped to ErrCompanyNotActive as defense-in-depth
// — mirrors mapCreateError and satisfies the locked
// "pgx.ErrNoRows → ErrCompanyNotActive" contract if the query shape
// ever drifts.
//
// Ordering vs the existing 23514 branch: pgx.ErrNoRows is checked
// BEFORE the errors.As into *pgconn.PgError so the two checks
// coexist (pgx.ErrNoRows is not a *pgconn.PgError, so there is no
// precedence conflict).
//
// Mapping contract:
//
//   - nil                                → nil (pass-through)
//   - pgx.ErrNoRows                      → entities.ErrCompanyNotActive
//     (defense-in-depth; unreachable
//     via the designed flow — the
//     :one scalar SELECT always
//     yields one row)
//   - 23514 (check_violation on
//     jobs_published_integrity_check)    → entities.ErrInvalidStatusTransition
//     (defense-in-depth; unreachable
//     via the designed flow — the
//     use case parses VOs before SQL)
//   - Any other PgError (unknown code)   → pass-through (HTTP 500)
//   - Any non-pg error (connection, ctx) → pass-through (HTTP 500)
//
// 23503 (FK violation) is not applicable — UpdateJob does not insert
// or reassign `company_id`. The adapter is intentionally narrow.
func mapUpdateError(err error) error {
	if err == nil {
		return nil
	}
	// Defense-in-depth: pgx.ErrNoRows → ErrCompanyNotActive. Mirrors
	// mapCreateError; unreachable on the designed flow but kept so a
	// future query-shape drift doesn't silently leak a 500 to the HTTP
	// layer (the active-company gate must produce 409, not 500).
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrCompanyNotActive
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23514":
			return entities.ErrInvalidStatusTransition
		}
	}
	return err
}

// --- soft-delete helpers (jobs-soft-delete slice, design D1/D3) -------------

// buildSoftDeleteJobParams translates the soft-delete input
// `(id, companyID, casUpdatedAt)` into the sqlc `SoftDeleteJobParams`
// struct. The arg order is pinned by first textual appearance in the
// D1 SQL:
//
//   - `company_id` first appears in the `active` CTE,
//   - `id` next in the UPDATE `WHERE`,
//   - `cas_token` last in the UPDATE `WHERE`.
//
// The generated struct mirrors this order; a SQL drift fails the
// adapter compile (D7). `CasToken` is unconditionally wrapped as
// `Valid=true` so the SQL WHERE receives a real timestamptz even when
// the use case falls through with a zero time (the use case's CAS
// compare would have caught the zero token earlier as a 409, but the
// adapter must not silently substitute NULL on this path — D2 contract
// is "the adapter is dumb and surfaces the row outcome as-is").
func buildSoftDeleteJobParams(id, companyID uuid.UUID, casUpdatedAt time.Time) db.SoftDeleteJobParams {
	return db.SoftDeleteJobParams{
		CompanyID: companyID,
		ID:        id,
		CasToken:  pgtype.Timestamptz{Time: casUpdatedAt, Valid: true},
	}
}

// mapSoftDeleteError translates Postgres errors surfaced by SoftDeleteJob
// into domain sentinels. Mirrors `mapUpdateError` exactly (the
// soft-delete query is an `UPDATE`, not an `INSERT`, so it inherits
// Update's error surface, not Create's). The minimal SET list
// (`deleted_at`, `updated_at`) cannot trip the
// `jobs_published_integrity_check` on the designed flow, so `23514` is
// defense-in-depth kept to mirror `mapUpdateError`.
//
// Ordering vs the existing `23514` branch: `pgx.ErrNoRows` is checked
// BEFORE the `errors.As` into `*pgconn.PgError` so the two checks
// coexist (pgx.ErrNoRows is not a *pgconn.PgError, so there is no
// precedence conflict).
//
// Mapping contract:
//
//   - nil                                → nil (pass-through)
//   - pgx.ErrNoRows                      → entities.ErrCompanyNotActive
//     (defense-in-depth;
//     unreachable via the
//     designed flow — the
//     :one scalar SELECT
//     always yields one row)
//   - 23514 (check_violation on
//     jobs_*_check constraints)          → entities.ErrInvalidStatusTransition
//     (defense-in-depth;
//     unreachable via the
//     designed flow — the
//     minimal SET list
//     touches neither
//     `status` nor
//     `published_at`)
//   - Any other PgError (unknown code)   → pass-through (HTTP 500)
//   - Any non-pg error (connection, ctx) → pass-through (HTTP 500)
//
// NO `23503` (foreign_key_violation on jobs.company_id) mapping — D3:
// soft-delete never inserts or reassigns `company_id`; a FK violation
// on `company_id` is impossible on this path. (Update is similarly
// silent on 23503; only Create maps it to ErrCompanyGone.)
func mapSoftDeleteError(err error) error {
	if err == nil {
		return nil
	}
	// Defense-in-depth: pgx.ErrNoRows → ErrCompanyNotActive. Mirrors
	// mapUpdateError; unreachable on the designed flow but kept so a
	// future query-shape drift doesn't silently leak a 500 to the HTTP
	// layer (the active-company gate must produce 409, not 500).
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrCompanyNotActive
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23514":
			return entities.ErrInvalidStatusTransition
		}
	}
	return err
}

// --- create-path helpers (Phase 3.2, design D7) ---------------------------

// buildCreateJobParams translates the domain CreateJobParams into the
// sqlc `CreateJobParams` struct. Three field shapes per the D1 SQL:
//
//   - Closed-set VOs (WorkMode, EmploymentType, Seniority,
//     SalaryCurrency): canonicalize via .String() so the adapter
//     never serializes an iota int to SQL. The use case parsed via
//     Parse* so the incoming VOs are always valid (we trust them).
//   - Optional[T]-free pointers (Location, SalaryMin, SalaryMax):
//     nil pointer → invalid pgtype (SQL NULL); non-nil pointer → valid
//     pgtype carrying the value. NO tri-state on create (plain
//     pointers, no Optional — D6: absent == null == SQL NULL).
//   - Identity columns (ID, CompanyID) are always populated by the
//     use case (uuid.NewV7 for ID, the middleware-injected CompanyID
//     for CompanyID).
func buildCreateJobParams(id, companyID uuid.UUID, p repositories.CreateJobParams) db.CreateJobParams {
	return db.CreateJobParams{
		CompanyID:      companyID,
		ID:             id,
		Title:          p.Title,
		Description:    p.Description,
		WorkMode:       p.WorkMode.String(),
		EmploymentType: p.EmploymentType.String(),
		Seniority:      p.Seniority.String(),
		Location:       strPtrToText(p.Location),
		SalaryMin:      intPtrToInt4(p.SalaryMin),
		SalaryMax:      intPtrToInt4(p.SalaryMax),
		SalaryCurrency: p.SalaryCurrency.String(),
	}
}

// intPtrToInt4 lifts a *int into a pgtype.Int4. nil → invalid (SQL
// NULL); non-nil → valid (Int32=*v). The reverse direction
// `pgInt4ToIntPtr` already exists in the read path; this helper is
// the only *int→Int4 translator in the write path (the existing
// optionalIntToInt4 reads from a tri-state Optional and is NOT reused
// — D6 keeps create plain pointers, no Optional).
func intPtrToInt4(v *int) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*v), Valid: true}
}

// createRowToGetForUpdateRow projects a `db.CreateJobRow` onto the
// `db.GetJobForUpdateRow` shape so the existing `toJobForUpdateEntity`
// can run unchanged (design D2: no parallel projection, no
// `entities.CreatedJob`). sqlc always emits per-query row types even
// when the column lists overlap, so the adapter adds this thin lift
// (mirroring `getByIDToSearchRow` on the read path). Every field is
// lifted verbatim — the two structs have an identical 15-column
// layout per D2.
func createRowToGetForUpdateRow(row db.CreateJobRow) db.GetJobForUpdateRow {
	return db.GetJobForUpdateRow{
		ID:             row.ID,
		Title:          row.Title,
		Description:    row.Description,
		Location:       row.Location,
		WorkMode:       row.WorkMode,
		EmploymentType: row.EmploymentType,
		Seniority:      row.Seniority,
		SalaryMin:      row.SalaryMin,
		SalaryMax:      row.SalaryMax,
		SalaryCurrency: row.SalaryCurrency,
		Status:         row.Status,
		PublishedAt:    row.PublishedAt,
		UpdatedAt:      row.UpdatedAt,
		CompanyID:      row.CompanyID,
		CompanyName:    row.CompanyName,
	}
}

// mapCreateError translates Postgres errors surfaced by CreateJob
// into domain sentinels. The active-company gate is in the SQL CTE,
// so the adapter's job is to surface pgx.ErrNoRows as
// ErrCompanyNotActive (the designed path) plus a small
// defense-in-depth pair for SQLSTATEs the CTE should already prevent
// (23503 → ErrCompanyGone, 23514 → ErrInvalidStatusTransition).
//
// Mapping contract:
//
//   - nil                                → nil (pass-through)
//   - pgx.ErrNoRows                      → entities.ErrCompanyNotActive
//     (0 rows on the active guard;
//     the only designed path)
//   - 23503 (foreign_key_violation on
//     jobs.company_id)                   → entities.ErrCompanyGone
//     (defense-in-depth;
//     unreachable via the
//     designed flow — the CTE
//     filters by companies.id)
//   - 23514 (check_violation on
//     jobs_*_check constraints)          → entities.ErrInvalidStatusTransition
//     (defense-in-depth;
//     unreachable via the
//     designed flow — the use
//     case parses VOs before
//     SQL)
//   - Any other PgError (unknown code)   → pass-through (HTTP 500)
//   - Any non-pg error (connection, ctx) → pass-through (HTTP 500)
//
// NO 23505 (unique_violation) mapping — locked decision #4: no
// business dedupe on jobs beyond the app-generated UUID v7 PK.
func mapCreateError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrCompanyNotActive
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503":
			return entities.ErrCompanyGone
		case "23514":
			return entities.ErrInvalidStatusTransition
		}
	}
	return err
}
