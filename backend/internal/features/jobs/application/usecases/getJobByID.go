package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/google/uuid"
)

// GetJobByID implements the GET /jobs/{id} contract. It is a thin
// delegate: the use case adds no behavior beyond propagating the
// repo's result so the HTTP layer sees the exact sentinel and shape
// the persistence layer produces. The visibility rule
// (status='published', deleted_at IS NULL, owning company.status='active')
// is enforced in SQL — the use case MUST NOT re-check it, otherwise
// the two layers can drift.
//
// ErrJobNotFound from the repo surfaces unchanged so the HTTP layer
// can map it to 404 per the spec scenario "GET /jobs/{id} hides
// non-visible jobs". Any other error propagates unchanged so the HTTP
// layer can map it to 500.
func (s *JobService) GetJobByID(ctx context.Context, id uuid.UUID) (*entities.Job, error) {
	job, err := s.repo.GetByID(ctx, id)
	if err != nil {
		// No wrapping: the HTTP layer must see the exact sentinel.
		return nil, err
	}
	return job, nil
}
