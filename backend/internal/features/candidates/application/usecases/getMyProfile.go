package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
)

// GetMyProfile returns the caller's profile. The caller MUST pass the JWT
// `sub` claim; the service resolves it to a users.id and forwards. Returns
// entities.ErrProfileNotFound when no row exists for that user.
func (s *CandidateService) GetMyProfile(ctx context.Context, cognitoSub string) (*entities.CandidateProfile, error) {
	userID, err := s.resolveUserID(ctx, cognitoSub)
	if err != nil {
		return nil, err
	}
	return s.repository.GetProfileByUserID(ctx, userID)
}
