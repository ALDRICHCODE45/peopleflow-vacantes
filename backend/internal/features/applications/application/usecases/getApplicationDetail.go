package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/google/uuid"
)

// GetApplicationDetail is the recruiter's GET /jobs/{jobId}/applications/{id}
// handler. The adapter scopes the read by (id, job_id, company_id) so a
// cross-company or non-existent application surfaces as
// ErrApplicationNotFound (404) without leaking the row's existence.
func (s *ApplicationService) GetApplicationDetail(
	ctx context.Context,
	companyID, jobID, applicationID uuid.UUID,
) (*entities.ApplicationWithCandidate, error) {
	return s.repo.GetByID(ctx, applicationID, jobID, companyID)
}
