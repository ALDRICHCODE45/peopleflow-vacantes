// Package usecases orchestrates the companies application logic.
package usecases

import (
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
)

// ErrMissingActorIdentity is returned by the owner-only company write
// use cases (UpdateCompany, SoftDeleteCompany) when the caller passes
// `userID == uuid.Nil`. It is the FIRST-step guard of both use cases
// (design D6): the sentinel fires BEFORE any DB read (GetCompanyForUpdate)
// and BEFORE the CAS compare, so a zero-actor request costs no query and
// never attempts an audit append. The HTTP classifier maps it to
// `500 internal server error` with a generic message (no existence
// leak — a missing actor is an internal mis-wiring, not a client
// error).
//
// Distinct from `entities.ErrCompanyNotFound` and
// `entities.ErrConcurrencyConflict` — the `errors.Is` chain in the
// classifier relies on the three sentinels being independent.
var ErrMissingActorIdentity = errors.New("missing actor identity")

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
