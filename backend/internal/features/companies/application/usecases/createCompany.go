package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
)

// CreateCompany parses the optional profile fields into their value objects
// and delegates aggregate construction to entities.NewCompany. Validation
// errors from any VO constructor are returned unchanged so the HTTP layer can
// translate them into 4xx responses.
func (s *CompanyService) CreateCompany(ctx context.Context, params dtos.CreateCompanyDto) (*entities.Company, error) {
	profile, err := buildCompanyProfile(params)
	if err != nil {
		return nil, err
	}

	company, err := entities.NewCompany(
		params.Name,
		params.Rfc,
		params.IndustryID,
		profile,
	)
	if err != nil {
		return nil, err
	}

	if err := s.repository.Create(ctx, company); err != nil {
		return nil, err
	}

	return company, nil
}

// buildCompanyProfile turns the raw DTO inputs into the typed entity profile.
// Each VO constructor is its own validation gate; the first one to fail short
// circuits the rest.
func buildCompanyProfile(p dtos.CreateCompanyDto) (entities.CompanyProfile, error) {
	profile := entities.CompanyProfile{
		Website:       p.Website,
		LogoURL:       p.LogoURL,
		City:          p.City,
		Country:       p.Country,
		LinkedInURL:   p.LinkedInURL,
		InstagramURL:  p.InstagramURL,
		FacebookURL:   p.FacebookURL,
		TwitterURL:    p.TwitterURL,
		CoverImageURL: p.CoverImageURL,
	}

	if p.Description != nil {
		desc, err := valueobjects.NewCompanyDescription(*p.Description)
		if err != nil {
			return entities.CompanyProfile{}, err
		}
		profile.Description = &desc
	}

	if p.Size != nil {
		size, err := valueobjects.ParseCompanySize(*p.Size)
		if err != nil {
			return entities.CompanyProfile{}, err
		}
		profile.Size = &size
	}

	if p.FoundedYear != nil {
		year, err := valueobjects.NewFoundedYear(*p.FoundedYear)
		if err != nil {
			return entities.CompanyProfile{}, err
		}
		profile.FoundedYear = &year
	}

	return profile, nil
}
