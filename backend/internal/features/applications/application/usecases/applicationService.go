// Package usecases orchestrates the applications application logic. The
// service is the composition target: it depends on the applications repo
// port and the identity user repo port (for cognito_sub → users.id).
//
// All candidate-facing use cases take a `cognitoSub string` as the first
// non-ctx argument; the service resolves it to a stable users.id at the
// edge so the entity layer never sees the JWT subject — the
// IDOR-resistant boundary (mirrors `candidates` and `companies`).
//
// Recruiter-facing use cases take a `companyID` from the middleware-
// injected `CompanyContext`; no JWT subject resolution is needed because
// the middleware already mapped (sub → users.id → company_members.role).
package usecases

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/google/uuid"
)

// ErrUnknownSubject is returned when the JWT `sub` does not match any live
// users.cognito_sub row. The HTTP layer maps this sentinel to 401 with
// the body "unauthenticated" — the same shape the `candidates` slice uses
// for the same condition (mirrors the candidates `ErrUnknownSubject`).
var ErrUnknownSubject = errors.New("unknown JWT subject")

// ApplicationRepoPort is the slice of the applications repository port the
// service actually uses. It mirrors domain/repositories.ApplicationRepository
// so the use case can be wired against either the real adapter or a test
// stub that satisfies the same surface (the test stub is
// stubApplicationRepo in stubs_test.go).
type ApplicationRepoPort interface {
	Create(ctx context.Context, p repositories.CreateParams) (*entities.Application, error)
	GetByID(ctx context.Context, id, jobID, companyID uuid.UUID) (*entities.ApplicationWithCandidate, error)
	ListByJob(ctx context.Context, jobID, companyID uuid.UUID) ([]entities.ApplicationWithCandidate, error)
	ListByCandidate(ctx context.Context, candidateID uuid.UUID) ([]entities.MyApplication, error)
	Transition(
		ctx context.Context,
		id, jobID, companyID uuid.UUID,
		from, to valueobjects.ApplicationStatus,
	) (*entities.Application, error)
}

// ApplicationService bundles the applications use cases that share the
// same repository ports. Construct it once at the composition root with
// the real adapters and pass it around.
type ApplicationService struct {
	repo     ApplicationRepoPort
	userRepo identityrepositories.UserRepository
}

// NewApplicationService wires the use cases around the two repository
// ports. The user repository is the identity slice's UserRepository;
// the service calls GetByCognitoSub at the edge of every candidate-facing
// use case so the rest of the code never sees the JWT subject.
func NewApplicationService(repo ApplicationRepoPort, userRepo identityrepositories.UserRepository) *ApplicationService {
	return &ApplicationService{
		repo:     repo,
		userRepo: userRepo,
	}
}

// resolveUserID is the IDOR-resistant boundary. Every public candidate-
// facing use case MUST call it before touching the applications port; the
// JWT subject never leaves this function. The applications FK resolves
// to users.id, so the returned uuid.UUID is the stable internal key.
//
// Mapping:
//   - identity.ErrUserNotFound → ErrUnknownSubject (401)
//   - any other error           → propagated untouched (500)
func (s *ApplicationService) resolveUserID(ctx context.Context, cognitoSub string) (uuid.UUID, error) {
	user, err := s.userRepo.GetByCognitoSub(ctx, cognitoSub)
	if err != nil {
		if errors.Is(err, identityentities.ErrUserNotFound) {
			return uuid.Nil, ErrUnknownSubject
		}
		return uuid.Nil, err
	}
	return user.ID, nil
}
