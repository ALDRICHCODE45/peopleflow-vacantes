package invitations

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

var ErrProfileUnconfirmed = errors.New("psychometric profile unconfirmed")

// ResultsStore is the separately composed employer-report capability. Invitation
// status/list consumers do not need access to result data.
type ResultsStore interface {
	GetResult(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (Result, error)
	CreateComparison(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (Result, error)
}
