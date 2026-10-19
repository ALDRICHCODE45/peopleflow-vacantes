package vacancymanagement

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// Store authorizes before preconditions and co-writes configuration and audit
// while holding the shared parent-draft lock used by all configuration writers.
type Store interface {
	GetManagement(ctx context.Context, companyID, actorID, draftID uuid.UUID) (drafts.Result, error)
	PutManagement(ctx context.Context, companyID, actorID, draftID uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error)
}
