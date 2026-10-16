package substatecatalog

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// Store reuses draft results and errors. Implementations authorize the draft
// before checking If-Match, and co-write catalog/version/audit transactionally.
// GET is pure; only stored normalized no-ops avoid writes and audit events.
type Store interface {
	GetSubstates(ctx context.Context, companyID, actorID, draftID uuid.UUID) (drafts.Result, error)
	PutSubstates(ctx context.Context, companyID, actorID, draftID uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error)
}
