// Package usecases orchestrates the candidates application logic. The
// service is the composition target: it depends on the candidates repo
// port and the identity user repo port (for cognito_sub → users.id).
//
// All use cases take a `cognitoSub string` as the first non-ctx argument.
// The service resolves it to a stable users.id at the edge so the entity
// layer never sees the JWT subject — that is the IDOR-resistant boundary.
package usecases

import (
	"context"
	"errors"

	candidatesentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/google/uuid"
)

// ErrUnknownSubject is returned when the JWT `sub` does not match any live
// users.cognito_sub row. The HTTP layer maps this to 401 per the spec
// scenario "unknown cognito_sub is not 5xx".
var ErrUnknownSubject = errors.New("unknown JWT subject")

// CandidateService bundles the candidates use cases that share the same
// repository ports. Construct it once at the composition root with the
// real adapters and pass it around.
type CandidateService struct {
	repository CandidateRepoPort
	userRepo   identityrepositories.UserRepository
}

// CandidateRepoPort is the slice of the candidates repository port the
// service actually uses. It mirrors domain/repositories.CandidateRepository
// so the use case can be wired against either the real adapter or a test
// fake that satisfies the same surface.
type CandidateRepoPort interface {
	UpsertProfile(ctx context.Context, p *candidatesentities.CandidateProfile) (*candidatesentities.CandidateProfile, error)
	GetProfileByUserID(ctx context.Context, id uuid.UUID) (*candidatesentities.CandidateProfile, error)
	ListLanguagesByUserID(ctx context.Context, id uuid.UUID) ([]candidatesentities.Language, error)
	ReplaceLanguagesByUserID(ctx context.Context, id uuid.UUID, langs []candidatesentities.Language) error
}

// NewCandidateService wires the use cases around the two repository ports.
// The user repository is the identity slice's UserRepository; the service
// calls GetByCognitoSub at the edge of every use case so the rest of the
// code never sees the JWT subject.
func NewCandidateService(repo CandidateRepoPort, userRepo identityrepositories.UserRepository) *CandidateService {
	return &CandidateService{
		repository: repo,
		userRepo:   userRepo,
	}
}

// resolveUserID is the IDOR-resistant boundary. Every public use case MUST
// call it before touching the candidates port; the JWT subject never
// leaves this function. The candidate_profiles FK resolves to users.id,
// so the returned uuid.UUID is the stable internal key.
func (s *CandidateService) resolveUserID(ctx context.Context, cognitoSub string) (uuid.UUID, error) {
	user, err := s.userRepo.GetByCognitoSub(ctx, cognitoSub)
	if err != nil {
		// Identity-domain "user not found" is the spec scenario "unknown
		// cognito_sub is not 5xx". Map it to ErrUnknownSubject so the
		// HTTP layer can translate to 401.
		if errors.Is(err, identityentities.ErrUserNotFound) {
			return uuid.Nil, ErrUnknownSubject
		}
		return uuid.Nil, err
	}
	return user.ID, nil
}
