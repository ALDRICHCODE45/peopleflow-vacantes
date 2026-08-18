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
)

// CompanyRepository is the PostgreSQL adapter for the repositories.CompanyRepository port.
type CompanyRepository struct {
	queries *db.Queries
}

// NewCompanyRepository wraps the sqlc-generated data layer.
func NewCompanyRepository(queries *db.Queries) *CompanyRepository {
	return &CompanyRepository{queries: queries}
}

// Compile-time assertion: the adapter satisfies the domain port.
var _ repositories.CompanyRepository = (*CompanyRepository)(nil)

// Create persists a new company, mapping the entity's value objects into sqlc params.
func (r *CompanyRepository) Create(ctx context.Context, company *entities.Company) error {
	_, err := r.queries.CreateCompany(ctx, buildCreateParams(company))
	return mapCreateError(err)
}

// GetByID fetches a company and rebuilds the domain entity from the sqlc row.
func (r *CompanyRepository) GetByID(ctx context.Context, id uuid.UUID) (*entities.Company, error) {
	row, err := r.queries.GetCompanyByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, entities.ErrCompanyNotFound
		}
		return nil, err
	}

	return toEntity(row)
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

// mapCreateError translates Postgres constraint violations into domain errors
// so the HTTP layer can return 4xx instead of leaking 500s for client errors.
func mapCreateError(err error) error {
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
