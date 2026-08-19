package usecases

import (
	"context"

	candidatesentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
)

// ListMyLanguages returns the caller's stored language rows ordered by
// language name (per the repository contract). Empty result is returned
// as a non-nil empty slice so JSON encoding produces `[]` rather than
// `null`.
func (s *CandidateService) ListMyLanguages(ctx context.Context, cognitoSub string) ([]candidatesentities.Language, error) {
	userID, err := s.resolveUserID(ctx, cognitoSub)
	if err != nil {
		return nil, err
	}

	got, err := s.repository.ListLanguagesByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if got == nil {
		return []candidatesentities.Language{}, nil
	}
	return got, nil
}
