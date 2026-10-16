package pipelineconfig

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// Store reuses the draft result and error catalog. Implementations re-check
// live authorization in the operation transaction before evaluating If-Match.
// Reads never create rows. Writes atomically persist configuration, independent
// pipeline version and one audit event; normalized no-ops do none of those.
type Store interface {
	GetPipeline(ctx context.Context, companyID, actorID, draftID uuid.UUID) (drafts.Result, error)
	PutPipeline(ctx context.Context, companyID, actorID, draftID uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error)
}
