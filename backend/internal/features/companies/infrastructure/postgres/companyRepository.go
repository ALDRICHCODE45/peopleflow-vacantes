// Package postgres implements the companies persistence ports against PostgreSQL.
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
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
// The full body of `UpdateCompany` / `SoftDeleteCompany` lands in WU5;
// WU3 only needs the signatures + the `var _` assertion to compile.
// The WU3 stubs are intentionally `return nil` so legacy tests
// (which never exercise the new methods) stay green through the
// atomic compile-break repair.
type CompanyRepository struct {
	pool *pgxpool.Pool
}

// NewCompanyRepository wraps the pgxpool.Pool. The adapter owns its
// own transactions for the write paths (companies-write slice, design
// D15) so the constructor takes a pool, not a `*db.Queries` handle.
// Composition root: `postgres.NewCompanyRepository(pool)` (D15).
func NewCompanyRepository(pool *pgxpool.Pool) *CompanyRepository {
	return &CompanyRepository{pool: pool}
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
// `updated_at = casUpdatedAt` and the row predicates (id, deleted_at IS NULL).
//
// WU3 stub: the full body lands in WU5 (transactional pool-based UPDATE +
// rowcount dispatch). The stub keeps the port satisfied so the atomic
// compile-break repair stays green; legacy tests never exercise it.
func (r *CompanyRepository) UpdateCompany(ctx context.Context, companyID uuid.UUID, patch repositories.UpdateCompanyPatch, casUpdatedAt time.Time) error {
	return nil
}

// SoftDeleteCompany tombstones the row AND transactionally closes every
// non-closed, non-tombstoned job of the company in ONE pgx.Tx.
//
// WU3 stub: the full body lands in WU5 (pool.Begin → soft-delete → inline
// close → commit; deferred rollback on any error). The stub keeps the port
// satisfied so the atomic compile-break repair stays green; legacy tests
// never exercise it.
func (r *CompanyRepository) SoftDeleteCompany(ctx context.Context, companyID uuid.UUID, casUpdatedAt time.Time) error {
	return nil
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
