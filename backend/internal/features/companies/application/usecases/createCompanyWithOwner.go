package usecases

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
)

// CreateCompanyWithOwner creates a company AND promotes its creator to owner
// atomically. It is the application-level bootstrap for the business rule
// "the creator is owner by default": the JWT subject resolves to a users.id,
// the company is built from the DTO, and both the company and its founding
// owner membership are persisted in a single transaction via the
// CompanyBootstrapRepository — a company can never be left without an owner.
//
// Error contract:
//   - unknown subject (sub not in users)          → entities.ErrUnknownSubject (401)
//   - invalid company fields (name/rfc/industry)  → the VO sentinel unchanged (400)
//   - duplicate RFC / missing industry / missing user → the adapter's sentinel (409/400/404)
//
// Sub resolution mirrors the identity slice: the service is the only layer
// that sees the raw cognito_sub; the repositories never do. The owner
// membership is always valueobjects.OwnerRole.
func (s *CompanyService) CreateCompanyWithOwner(ctx context.Context, cognitoSub string, params dtos.CreateCompanyDto) (*entities.Company, error) {
	user, err := s.userRepo.GetByCognitoSub(ctx, cognitoSub)
	if err != nil {
		if errors.Is(err, identityentities.ErrUserNotFound) {
			return nil, entities.ErrUnknownSubject
		}
		return nil, err
	}

	company, err := buildCompany(params)
	if err != nil {
		return nil, err
	}

	owner, err := entities.NewCompanyMember(user.ID, company.ID, valueobjects.OwnerRole)
	if err != nil {
		return nil, err
	}

	if err := s.bootstrapRepo.CreateWithOwner(ctx, company, owner); err != nil {
		return nil, err
	}

	return company, nil
}
