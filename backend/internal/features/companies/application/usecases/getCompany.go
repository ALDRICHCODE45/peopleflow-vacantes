package usecases

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/google/uuid"
)

// GetPublishedSiteSlug returns the current slug, or nil for an unpublished/absent site.
func (s *CompanyService) GetPublishedSiteSlug(ctx context.Context, id uuid.UUID) (*string, error) {
	reader, ok := s.repository.(repositories.CompanyPublishedSiteReader)
	if !ok {
		return nil, errors.New("company published site reader not configured")
	}
	return reader.GetPublishedSiteSlug(ctx, id)
}

// GetCompanyByID returns a company by its ID, or entities.ErrCompanyNotFound.
func (s *CompanyService) GetCompanyByID(ctx context.Context, id uuid.UUID) (*entities.Company, error) {
	return s.repository.GetByID(ctx, id)
}
