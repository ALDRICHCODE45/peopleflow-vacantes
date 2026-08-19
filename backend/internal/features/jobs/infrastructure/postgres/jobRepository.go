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
