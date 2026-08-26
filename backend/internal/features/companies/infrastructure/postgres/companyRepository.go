// Package postgres implements the companies persistence ports against PostgreSQL.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CompanyRepository is the PostgreSQL adapter for the repositories.CompanyRepository port.
//
// Companies-write WU3 (design D15): the adapter is now POOL-OWNING.
// It holds a `*pgxpool.Pool` (not a `*db.Queries` handle) and the
// transactional write paths (`UpdateCompany`, `SoftDeleteCompany`)
// open their own `pgx.Tx` via `r.pool.Begin(ctx)` and own the
// `defer tx.Rollback(ctx)` / `tx.Commit(ctx)` lifecycle. Reads
// (`GetByID`, `Create`, `GetCompanyForUpdate`) borrow a per-call
// `db.New(r.pool)` so the read path is semantically identical to the
// pre-WU3 behavior (same SQL, same `*db.Queries` mapping).
//
// companies-audit WU2 (design D4/D9): the adapter now also holds the
// stateless audit adapter (`auditrepositories.AuditEventRepository`)
// so the write paths can co-write the domain write + the audit event
// append atomically. The audit append runs INSIDE the adapter-owned
// `pgx.Tx`, AFTER the domain write succeeds, and BEFORE `tx.Commit`;
// an audit failure wraps to `co-write audit: <err>` and aborts the
// transaction via the deferred `tx.Rollback` (fail-closed — no
// domain write without its audit trail). The adapter NEVER builds
// the event — the use case is the single source of truth (the event
// arrives through the port signature as the LAST value param, D3).
type CompanyRepository struct {
	pool  *pgxpool.Pool
	audit auditrepositories.AuditEventRepository
}

// NewCompanyRepository wraps the pgxpool.Pool + the stateless audit
// adapter. Pool first, audit second — mirror of
// `NewApplicationRepository(pool, audit)` (companies-audit design
// D4). The composition root hoists the `auditRepo` declaration
// above the `companyRepo` construction so the `auditRepo` variable
// is in scope when this constructor runs.
func NewCompanyRepository(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository) *CompanyRepository {
	return &CompanyRepository{pool: pool, audit: audit}
}

// Compile-time assertion: the adapter satisfies the domain port. If a
// future refactor drifts the surface, this line refuses to compile
// rather than waiting for a wiring/runtime surprise in `cmd/api/main.go`.
var _ repositories.CompanyRepository = (*CompanyRepository)(nil)

// Create persists a new company, mapping the entity's value objects into sqlc params.
//
// WU3 (D15): the read path borrows `db.New(r.pool)` per call instead
// of holding a `*db.Queries` field; the SQL is byte-for-byte
// identical to the pre-WU3 path so legacy behavior is preserved.
func (r *CompanyRepository) Create(ctx context.Context, company *entities.Company) error {
	_, err := db.New(r.pool).CreateCompany(ctx, buildCreateParams(company))
	return mapCompanyCreateError(err)
}

// GetByID fetches a company and rebuilds the domain entity from the sqlc row.
//
// WU3 (D15): the read path borrows `db.New(r.pool)` per call; the
// SQL is byte-for-byte identical to the pre-WU3 path so legacy
// behavior is preserved.
func (r *CompanyRepository) GetByID(ctx context.Context, id uuid.UUID) (*entities.Company, error) {
	row, err := db.New(r.pool).GetCompanyByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, entities.ErrCompanyNotFound
		}
		return nil, err
	}

	return toEntity(row)
}

// GetCompanyForUpdate is the write-path read seam (companies-write
// slice, design D2). The visibility rule is byte-for-byte identical to
// `GetCompanyByID`: `WHERE id = $1 AND deleted_at IS NULL` (no status
// filter — the write path must see active, suspended, and
// pending_verification companies, and must NOT see tombstoned ones).
//
// `pgx.ErrNoRows → ErrCompanyNotFound`; any other error propagates.
//
// The SQL is reused verbatim from `GetCompanyByID` rather than a
// dedicated `GetCompanyForUpdate :one` query (D1 / D2 rationale:
// the column list and predicates are identical; a dedicated query
// would only add a generated row type + interface method with zero
// semantic value). The dedicated port method gives a future drift
// point (e.g. `FOR UPDATE` locking, distinct columns) without
// overloading the public read.
func (r *CompanyRepository) GetCompanyForUpdate(ctx context.Context, companyID uuid.UUID) (*entities.Company, error) {
	row, err := db.New(r.pool).GetCompanyByID(ctx, companyID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, entities.ErrCompanyNotFound
		}
		return nil, err
	}
	return toEntity(row)
}

// UpdateCompany applies the patch atomically, guarded by CAS
// `updated_at = casUpdatedAt` and the row predicates
// (id, deleted_at IS NULL), AND co-writes the supplied audit event
// inside the SAME `pgx.Tx` (companies-audit design D9 — fail-closed
// co-write, mirror of the applications slice).
//
// Operation order (D9):
//  1. pool.Begin
//  2. defer tx.Rollback (canonical; covers every error path below)
//  3. db.New(tx).UpdateCompany — SQL UPDATE
//  4. mapUpdateCompanyError — 23514 → size/founded_year VO sentinel
//  5. if updated == 0 → return ErrCompanyNotFound (NO append; the
//     use case re-reads and either maps to 404 or 409-with-view)
//  6. r.audit.Append(ctx, tx, event) — audit INSERT inside the
//     same tx; an append failure wraps to "co-write audit: <err>"
//     and aborts the tx via the deferred Rollback
//  7. tx.Commit — both writes become visible atomically
//
// The D3 SQL sets `updated_at = clock_timestamp()` on a successful
// update, so the authoritative post-write value is the next
// `GetCompanyForUpdate`'s result (the use case re-reads to obtain it
// — design D12 step 7).
//
// Returns:
//
//	nil                                  on success (1 row affected +
//	                                     1 audit row appended)
//	entities.ErrCompanyNotFound          on 0 rows affected
//	                                     (CAS lost / cross-company /
//	                                     soft-delete race — NO append)
//	other error                          propagated unchanged (HTTP 500)
func (r *CompanyRepository) UpdateCompany(ctx context.Context, companyID uuid.UUID, patch repositories.UpdateCompanyPatch, casUpdatedAt time.Time, event auditentities.AuditEvent) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	updated, err := db.New(tx).UpdateCompany(ctx, buildUpdateCompanyParams(companyID, patch, casUpdatedAt))
	if err != nil {
		return mapUpdateCompanyError(err)
	}
	if updated == 0 {
		return entities.ErrCompanyNotFound
	}

	// Fail-closed: an audit INSERT failure aborts the whole transaction
	// (the deferred Rollback restores pre-state; no company mutation
	// is visible).
	if err := r.audit.Append(ctx, tx, event); err != nil {
		return fmt.Errorf("co-write audit: %w", err)
	}

	return tx.Commit(ctx)
}

// SoftDeleteCompany tombstones the row (`deleted_at = now()`,
// `updated_at = clock_timestamp()`) AND transactionally closes every
// non-closed, non-tombstoned job of the company in ONE pgx.Tx
// (design D4 / D5), AND co-writes the supplied audit event inside
// the SAME tx with the `jobs_closed` rowcount finalized into the
// metadata (companies-audit design D1 / D9 — the post-write scalar
// that only the adapter can observe). The minimal SET list
// preserves every other column as audit history (`rfc`, `industry_id`,
// `status`, `created_at`, `id`, the 12 profile columns); the
// partial unique index `companies_rfc_unique ON (rfc) WHERE
// deleted_at IS NULL` permits RFC reuse after the tombstone.
//
// Operation order (D9):
//  1. pool.Begin
//  2. defer tx.Rollback (covers every error path below)
//  3. db.New(tx).SoftDeleteCompany — SQL UPDATE
//  4. mapSoftDeleteCompanyError — 23514 → ErrInvalidCompanyStatusTransition
//  5. if deleted == 0 → return ErrCompanyNotFound (NO append; NO inline close)
//  6. db.New(tx).CloseCompanyJobs — inline close; the rowcount
//     becomes the `jobs_closed` metadata value via
//     `auditentities.CompanyDeletedMetadata(int(closedCount))`
//  7. finalize event.Metadata (the use case built the event with
//     `Metadata: nil` — the explicit "finalize me" handshake, D1)
//  8. r.audit.Append(ctx, tx, event) — audit INSERT; failure wraps
//     to "co-write audit: <err>" and aborts the tx
//  9. tx.Commit — all three writes (soft-delete + inline close +
//     audit append) become visible atomically
//
// The inline close rowcount IS now branched on (D1 — was "telemetry
// only" in companies-write D5; companies-audit promotes it to the
// single source of `jobs_closed`). The rowcount of zero is a
// legitimate success path; `CompanyDeletedMetadata(0)` returns
// `{"jobs_closed": "0"}` (the always-present key invariant — pinned
// by `TestCompanyDeletedMetadata_AlwaysPresentKey` at the domain
// layer).
//
// Returns:
//
//	nil                                  on success (soft-delete +
//	                                     inline close + audit append
//	                                     committed)
//	entities.ErrCompanyNotFound          on 0 rows affected
//	                                     (CAS lost / cross-company /
//	                                     already-soft-deleted — NO
//	                                     append, NO inline close)
//	other error                          propagated unchanged (HTTP 500)
func (r *CompanyRepository) SoftDeleteCompany(ctx context.Context, companyID uuid.UUID, casUpdatedAt time.Time, event auditentities.AuditEvent) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	deleted, err := db.New(tx).SoftDeleteCompany(ctx, buildSoftDeleteCompanyParams(companyID, casUpdatedAt))
	if err != nil {
		return mapSoftDeleteCompanyError(err)
	}
	if deleted == 0 {
		return entities.ErrCompanyNotFound
	}

	// Inline close — runs in the same tx. The rowcount becomes the
	// `jobs_closed` metadata value (D1 / D9).
	closedCount, err := db.New(tx).CloseCompanyJobs(ctx, companyID)
	if err != nil {
		// mapSoftDeleteCompanyError maps SQLSTATE 23514 → entities
		// .ErrInvalidCompanyStatusTransition; pgx.ErrNoRows is
		// unreachable (the :execrows UPDATE always emits a tag);
		// unknown errors pass through. The deferred tx.Rollback
		// undoes the soft-delete write too.
		return mapSoftDeleteCompanyError(err)
	}

	// Finalize the event's `jobs_closed` metadata via the
	// domain-owned pure builder. The use case built the event with
	// `Metadata: nil` — this is the explicit "finalize me"
	// handshake (D1). closedCount is the `int64` rowcount from
	// `db.New(tx).CloseCompanyJobs`; the builder takes a Go `int`.
	event.Metadata = auditentities.CompanyDeletedMetadata(int(closedCount))

	// Fail-closed: an audit INSERT failure aborts the whole
	// transaction. The deferred Rollback restores pre-state; no
	// soft-delete, no job close, no audit row is visible.
	if err := r.audit.Append(ctx, tx, event); err != nil {
		return fmt.Errorf("co-write audit: %w", err)
	}

	return tx.Commit(ctx)
}

// buildCreateParams translates an entity into the sqlc parameter struct. Every
// optional field becomes an invalid pgtype (SQL NULL) when the entity
// pointer is nil so the database CHECK constraints see the same shape the
// domain validation produced.
func buildCreateParams(c *entities.Company) db.CreateCompanyParams {
	year := pgtype.Int2{}
	if c.FoundedYear != nil {
		year = pgtype.Int2{Int16: int16(c.FoundedYear.Value()), Valid: true}
	}

	var sizeStr string
	if c.Size != nil {
		sizeStr = c.Size.String()
	}

	var descStr string
	if c.Description != nil {
		descStr = c.Description.Value()
	}

	return db.CreateCompanyParams{
		ID:            c.ID,
		Name:          c.Name.Value(),
		Rfc:           c.Rfc.Value(),
		IndustryID:    c.IndustryID,
		Website:       textPtrToPgText(c.Website),
		LogoUrl:       textPtrToPgText(c.LogoURL),
		Description:   pgtype.Text{String: descStr, Valid: c.Description != nil},
		Size:          pgtype.Text{String: sizeStr, Valid: c.Size != nil},
		FoundedYear:   year,
		City:          textPtrToPgText(c.City),
		Country:       textPtrToPgText(c.Country),
		LinkedinUrl:   textPtrToPgText(c.LinkedInURL),
		InstagramUrl:  textPtrToPgText(c.InstagramURL),
		FacebookUrl:   textPtrToPgText(c.FacebookURL),
		TwitterUrl:    textPtrToPgText(c.TwitterURL),
		CoverImageUrl: textPtrToPgText(c.CoverImageURL),
	}
}

// toEntity rebuilds the domain entity, reconstructing the value objects.
func toEntity(row db.Company) (*entities.Company, error) {
	name, err := valueobjects.NewCompanyName(row.Name)
	if err != nil {
		return nil, err
	}

	rfc, err := valueobjects.NewCompanyRfc(row.Rfc)
	if err != nil {
		return nil, err
	}

	status, err := valueobjects.ParseCompanyStatus(row.Status)
	if err != nil {
		return nil, err
	}

	var description *valueobjects.CompanyDescription
	if row.Description.Valid {
		desc, err := valueobjects.NewCompanyDescription(row.Description.String)
		if err != nil {
			return nil, err
		}
		description = &desc
	}

	var size *valueobjects.CompanySize
	if row.Size.Valid {
		parsed, err := valueobjects.ParseCompanySize(row.Size.String)
		if err != nil {
			return nil, err
		}
		size = &parsed
	}

	var foundedYear *valueobjects.FoundedYear
	if row.FoundedYear.Valid {
		y, err := valueobjects.NewFoundedYear(int(row.FoundedYear.Int16))
		if err != nil {
			return nil, err
		}
		foundedYear = &y
	}

	return &entities.Company{
		ID:            row.ID,
		Name:          name,
		Rfc:           rfc,
		Status:        status,
		IndustryID:    row.IndustryID,
		Website:       pgTextToTextPtr(row.Website),
		LogoURL:       pgTextToTextPtr(row.LogoUrl),
		Description:   description,
		Size:          size,
		FoundedYear:   foundedYear,
		City:          pgTextToTextPtr(row.City),
		Country:       pgTextToTextPtr(row.Country),
		LinkedInURL:   pgTextToTextPtr(row.LinkedinUrl),
		InstagramURL:  pgTextToTextPtr(row.InstagramUrl),
		FacebookURL:   pgTextToTextPtr(row.FacebookUrl),
		TwitterURL:    pgTextToTextPtr(row.TwitterUrl),
		CoverImageURL: pgTextToTextPtr(row.CoverImageUrl),
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
		DeletedAt:     pgTimestamptzToTimePtr(row.DeletedAt),
	}, nil
}

// --- nullable column helpers: entity pointers <-> pgtype wrappers ---

func textPtrToPgText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func pgTextToTextPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func pgTimestamptzToTimePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}

// mapCompanyCreateError translates Postgres constraint violations on the
// `companies` table into domain errors so the HTTP layer can return 4xx
// instead of leaking 500s for client errors.
//
// The member repository (companyMemberRepository.go) defines its own
// mapCreateError with a SQLSTATE → sentinel mapping specific to the
// `company_members` table; do not collapse them — same SQLSTATE codes
// mean different domain errors on different tables.
func mapCompanyCreateError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505": // unique_violation
			return entities.ErrDuplicateCompany
		case "23503": // foreign_key_violation
			return entities.ErrIndustryNotFound
		}
	}
	return err
}

// --- write-path helpers (companies-write slice, design D10 / D13) ----------

// buildUpdateCompanyParams translates the domain UpdateCompanyPatch
// into the sqlc `UpdateCompanyParams` struct. Three field shapes per
// the D3 SQL:
//
//   - `Name` via textPtrToPgText (matches buildCreateParams's Name
//     handling).
//   - The twelve profile columns via optionalStringToText (string
//     columns) or optionalIntToInt2 (founded_year). Set=false →
//     flag false AND value invalid (untouched); Set=true, Valid=false
//     → flag true AND value invalid (clear to NULL);
//     Set=true, Valid=true → flag true AND value valid (set to value).
//   - Identity columns (CompanyID, CasToken) are always populated
//     at the END of the struct — design D10 SET-list-first arg
//     order (the SQL SET list textually precedes the WHERE for the
//     no-active-CTE UpdateCompany).
//
// The use case pre-canonicalizes the values: size is `parsedSize.String()`
// (lowercase for `companies_size_check`), founded_year is the int,
// name/description are the trimmed raw values.
func buildUpdateCompanyParams(companyID uuid.UUID, patch repositories.UpdateCompanyPatch, casUpdatedAt time.Time) db.UpdateCompanyParams {
	return db.UpdateCompanyParams{
		Name:             textPtrToPgText(patch.Name),
		SetWebsite:       patch.Website.Set,
		Website:          optionalStringToPgText(patch.Website),
		SetLogoUrl:       patch.LogoURL.Set,
		LogoUrl:          optionalStringToPgText(patch.LogoURL),
		SetDescription:   patch.Description.Set,
		Description:      optionalStringToPgText(patch.Description),
		SetSize:          patch.Size.Set,
		Size:             optionalStringToPgText(patch.Size),
		SetFoundedYear:   patch.FoundedYear.Set,
		FoundedYear:      optionalIntToPgInt2(patch.FoundedYear),
		SetCity:          patch.City.Set,
		City:             optionalStringToPgText(patch.City),
		SetCountry:       patch.Country.Set,
		Country:          optionalStringToPgText(patch.Country),
		SetLinkedinUrl:   patch.LinkedInURL.Set,
		LinkedinUrl:      optionalStringToPgText(patch.LinkedInURL),
		SetInstagramUrl:  patch.InstagramURL.Set,
		InstagramUrl:     optionalStringToPgText(patch.InstagramURL),
		SetFacebookUrl:   patch.FacebookURL.Set,
		FacebookUrl:      optionalStringToPgText(patch.FacebookURL),
		SetTwitterUrl:    patch.TwitterURL.Set,
		TwitterUrl:       optionalStringToPgText(patch.TwitterURL),
		SetCoverImageUrl: patch.CoverImageURL.Set,
		CoverImageUrl:    optionalStringToPgText(patch.CoverImageURL),
		CompanyID:        companyID,
		CasToken:         pgtype.Timestamptz{Time: casUpdatedAt, Valid: true},
	}
}

// buildSoftDeleteCompanyParams translates `(companyID, casUpdatedAt)`
// into the sqlc `SoftDeleteCompanyParams` struct. The arg order is
// trivial (no SET-list args): CompanyID first (WHERE), CasToken
// second (WHERE).
func buildSoftDeleteCompanyParams(companyID uuid.UUID, casUpdatedAt time.Time) db.SoftDeleteCompanyParams {
	return db.SoftDeleteCompanyParams{
		CompanyID: companyID,
		CasToken:  pgtype.Timestamptz{Time: casUpdatedAt, Valid: true},
	}
}

// optionalStringToPgText renders the tri-state Optional[string] into a
// pgtype.Text. Set=false → invalid pgtype (CASE branch: ELSE col —
// untouched). Set=true, Valid=false → invalid pgtype with Set=true
// (CASE branch: THEN narg → NULL — clear). Set=true, Valid=true →
// valid pgtype with the value.
func optionalStringToPgText(o sharedvalueobjects.Optional[string]) pgtype.Text {
	if !o.Set {
		return pgtype.Text{}
	}
	if !o.Valid {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: o.Value, Valid: true}
}

// optionalIntToPgInt2 renders the tri-state Optional[int] into a
// pgtype.Int2. Same semantics as optionalStringToPgText; the SQL
// column `founded_year` is SMALLINT (int2), matching buildCreateParams's
// year handling.
func optionalIntToPgInt2(o sharedvalueobjects.Optional[int]) pgtype.Int2 {
	if !o.Set {
		return pgtype.Int2{}
	}
	if !o.Valid {
		return pgtype.Int2{Valid: false}
	}
	return pgtype.Int2{Int16: int16(o.Value), Valid: true}
}

// mapUpdateCompanyError translates Postgres errors surfaced by
// UpdateCompany into domain sentinels (companies-write slice, design
// D13). pgx.ErrNoRows is checked BEFORE the errors.As into
// *pgconn.PgError so the two checks coexist (pgx.ErrNoRows is not a
// *pgconn.PgError).
//
// Mapping contract:
//
//	nil                            → nil (pass-through)
//	pgx.ErrNoRows                  → entities.ErrCompanyNotFound
//	                                 (defense-in-depth; the :one
//	                                 scalar SELECT always yields
//	                                 one row)
//	23514 + companies_size_check   → valueobjects.ErrInvalidCompanySize
//	23514 + companies_founded_year_check → valueobjects.ErrFoundedYearOutOfRange
//	any other PgError               → pass-through (HTTP 500)
//	any non-pg error                → pass-through (HTTP 500)
//
// NO branch for `ErrCompanyNameTooShort` or `ErrCompanyDescriptionTooLong`
// (D13 — those are VO-level and the use case fires them before SQL;
// the DB has no CHECK on `name` length or `description` length — see
// `db/migrations/00003_companies_profile.sql`).
// NO 23503 mapping (PATCH does not insert or reassign FKs).
func mapUpdateCompanyError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrCompanyNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23514":
			switch pgErr.ConstraintName {
			case "companies_size_check":
				return valueobjects.ErrInvalidCompanySize
			case "companies_founded_year_check":
				return valueobjects.ErrFoundedYearOutOfRange
			}
		}
	}
	return err
}

// mapSoftDeleteCompanyError translates Postgres errors surfaced by
// SoftDeleteCompany (and the inline CloseCompanyJobs) into domain
// sentinels (companies-write slice, design D13). pgx.ErrNoRows is
// checked BEFORE the errors.As into *pgconn.PgError so the two
// checks coexist.
//
// Mapping contract:
//
//	nil                            → nil (pass-through)
//	pgx.ErrNoRows                  → entities.ErrCompanyNotFound
//	                                 (defense-in-depth)
//	23514                          → entities.ErrInvalidCompanyStatusTransition
//	                                 (defense-in-depth; the only
//	                                 plausible CHECK is
//	                                 jobs_status_check and 'closed'
//	                                 satisfies it)
//	any other PgError               → pass-through (HTTP 500)
//	any non-pg error                → pass-through (HTTP 500)
//
// NO 23503 mapping (D13 — soft-delete never reassigns FKs).
func mapSoftDeleteCompanyError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrCompanyNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23514":
			return entities.ErrInvalidCompanyStatusTransition
		}
	}
	return err
}
