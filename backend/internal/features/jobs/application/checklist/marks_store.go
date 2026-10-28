package checklist

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type MarkedBy struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
}

type Mark struct {
	ParticipationID uuid.UUID `json:"participation_id"`
	CriterionID     uuid.UUID `json:"criterion_id"`
	Verdict         string    `json:"verdict"`
	Note            *string   `json:"note"`
	MarkedBy        MarkedBy  `json:"marked_by"`
	MarkedAt        time.Time `json:"marked_at"`
}

// MarksStore shares the draft's authorization and serialization boundary.
// No-ops preserve the original author/timestamp and append no audit event.
type MarksStore interface {
	GetChecklistMarks(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]Mark, error)
	PutChecklistMark(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, []byte) (Mark, error)
	DeleteChecklistMark(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error
}
