package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
)

func (s *CompanyService) CreateCompany(ctx context.Context, params dtos.CreateCompanyDto) (*entities.Company, error) {
	company, err := entities.NewCompany(
		params.Name,
		params.Rfc,
		params.IndustryID,
		params.Website,
		params.LogoURL,
	)
	if err != nil {
		return nil, err
	}

	if err := s.repository.Create(ctx, company); err != nil {
		return nil, err
	}

	return company, nil
}
