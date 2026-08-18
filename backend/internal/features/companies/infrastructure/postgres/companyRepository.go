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
	_, err := r.queries.CreateCompany(ctx, db.CreateCompanyParams{
		ID:         company.ID,
		Name:       company.Name.Value(),
		Rfc:        company.Rfc.Value(),
		IndustryID: company.IndustryID,
		Website:    textPtrToPgText(company.Website),
		LogoUrl:    textPtrToPgText(company.LogoURL),
	})
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

	return &entities.Company{
		ID:         row.ID,
		Name:       name,
		Rfc:        rfc,
		Status:     status,
		IndustryID: row.IndustryID,
		Website:    pgTextToTextPtr(row.Website),
		LogoURL:    pgTextToTextPtr(row.LogoUrl),
		CreatedAt:  row.CreatedAt.Time,
		UpdatedAt:  row.UpdatedAt.Time,
		DeletedAt:  pgTimestamptzToTimePtr(row.DeletedAt),
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
