package v2

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

// DeliveryRecorder co-writes automatic attainment inside the intake transaction.
// The caller holds the authoring draft and process locks before invoking it.
type DeliveryRecorder interface {
	RecordDelivery(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, time.Time) error
}
