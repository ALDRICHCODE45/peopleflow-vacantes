package deliveryconfig

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// Store authorizes before comparing preconditions, locks the parent draft for
// writes, and co-writes delivery values, independent version and audit atomically.
type Store interface {
	GetDelivery(ctx context.Context, companyID, actorID, draftID uuid.UUID) (drafts.Result, error)
	PutDelivery(ctx context.Context, companyID, actorID, draftID uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error)
}
