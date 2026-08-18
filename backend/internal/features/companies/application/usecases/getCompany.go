package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/google/uuid"
)

// GetCompanyByID returns a company by its ID, or entities.ErrCompanyNotFound.
func (s *CompanyService) GetCompanyByID(ctx context.Context, id uuid.UUID) (*entities.Company, error) {
	return s.repository.GetByID(ctx, id)
}
