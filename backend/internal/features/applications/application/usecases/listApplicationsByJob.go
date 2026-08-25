package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/google/uuid"
)

// ListApplicationsByJob is the recruiter's GET /jobs/{jobId}/applications
// handler. The caller is a recruiter of `companyID` (already resolved by
// the middleware-injected CompanyContext); the adapter performs a
// two-step same-company scope check (design D5) and returns
// ErrApplicationNotFound for cross-company / non-existent jobs.
func (s *ApplicationService) ListApplicationsByJob(
	ctx context.Context,
	companyID, jobID uuid.UUID,
) ([]entities.ApplicationWithCandidate, error) {
	return s.repo.ListByJob(ctx, jobID, companyID)
}
