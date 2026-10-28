package checklist

import (
	"context"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// Store authorizes before validating and co-writes the checklist and audit.
type Store interface {
	GetChecklist(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error)
	PutChecklist(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (drafts.Result, error)
}
