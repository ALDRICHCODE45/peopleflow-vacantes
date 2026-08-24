// Package usecases orchestrates the companies application logic.
package usecases

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
)

type CompanyService struct {
	repository repositories.CompanyRepository

	// Bootstrap collaborators — nil when the service is built with
	// NewCompanyService (the legacy read/create path); populated by
	// NewCompanyServiceWithBootstrap for the CreateCompanyWithOwner flow.
	userRepo      identityrepositories.UserRepository
	bootstrapRepo repositories.CompanyBootstrapRepository
}

// NewCompanyService wires only the company repository. It backs the
// read-oriented and legacy create paths; it does NOT enable
// CreateCompanyWithOwner (those collaborators are nil here).
func NewCompanyService(repository repositories.CompanyRepository) *CompanyService {
	return &CompanyService{
		repository: repository,
	}
}

// NewCompanyServiceWithBootstrap wires the full dependency set for the
// CreateCompanyWithOwner flow: the company repository (for reads), the
// identity user repository (sub → users.id), and the transactional
// bootstrap repository (company + owner atomic write).
func NewCompanyServiceWithBootstrap(
	repository repositories.CompanyRepository,
	userRepo identityrepositories.UserRepository,
	bootstrapRepo repositories.CompanyBootstrapRepository,
) *CompanyService {
	return &CompanyService{
		repository:    repository,
		userRepo:      userRepo,
		bootstrapRepo: bootstrapRepo,
	}
}
