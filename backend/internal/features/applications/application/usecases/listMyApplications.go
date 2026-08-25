package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
)

// ListMyApplications is the candidate's GET /me/applications handler. It
// resolves the JWT subject to users.id, then hands the caller's candidate
// id to the repository. The repo caps the result at 100 rows and orders
// `created_at DESC`; empty results are normalized to a non-nil empty slice
// here so the JSON encoder renders `[]` not `null`.
func (s *ApplicationService) ListMyApplications(
	ctx context.Context,
	cognitoSub string,
) ([]entities.MyApplication, error) {
	candidateID, err := s.resolveUserID(ctx, cognitoSub)
	if err != nil {
		return nil, err
	}
	apps, err := s.repo.ListByCandidate(ctx, candidateID)
	if err != nil {
		return nil, err
	}
	if apps == nil {
		apps = []entities.MyApplication{} // non-nil empty slice for JSON `[]`
	}
	return apps, nil
}
