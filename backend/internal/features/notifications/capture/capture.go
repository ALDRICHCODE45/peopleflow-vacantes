// Package capture is the notifications capture point (notifications-v1 D1):
// a decorator of the audit port that, after the inner Append succeeded, writes
// one notification_events row in the same caller-owned transaction when the
// audit type is notifiable (D2). It opens no transaction of its own; any
// capture failure is returned so the caller rolls the domain write and its
// audit row back (fail-closed). Fan-out happens later (N2).
package capture

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Decorator wraps the production audit adapter; it satisfies the same port so
// no emitter changes (wired in cmd/api/main.go).
type Decorator struct {
	inner auditrepositories.AuditEventRepository
}

var _ auditrepositories.AuditEventRepository = (*Decorator)(nil)

// New decorates inner with the notifications capture.
func New(inner auditrepositories.AuditEventRepository) *Decorator {
	return &Decorator{inner: inner}
}

// Append appends the audit event through the inner port, then captures it.
func (d *Decorator) Append(ctx context.Context, tx pgx.Tx, event audit.AuditEvent) error {
	if err := d.inner.Append(ctx, tx, event); err != nil {
		return err
	}
	captured, ok, err := domain.BuildEvent(event)
	if err != nil {
		return fmt.Errorf("capture notification event: %w", err)
	}
	if !ok {
		return nil
	}
	if err := insert(ctx, db.New(tx), captured); err != nil {
		return fmt.Errorf("capture notification event %s: %w", event.EventType, err)
	}
	return nil
}

func insert(ctx context.Context, q *db.Queries, e domain.Event) error {
	if e.NeedsHasMessage {
		// D3: same tx, after the discard UPDATE; the text itself is never read.
		has, err := q.ParticipationHasCandidateMessage(ctx, *e.ParticipationID)
		if err != nil {
			return fmt.Errorf("read has_message: %w", err)
		}
		e.Payload["has_message"] = has
	}
	payload, err := json.Marshal(e.Payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	return q.InsertNotificationEvent(ctx, db.InsertNotificationEventParams{
		ID:              uuid.Must(uuid.NewV7()),
		AuditEventID:    e.AuditEventID,
		CompanyID:       e.CompanyID,
		EventType:       e.EventType,
		ActorUserID:     nullable(e.ActorUserID),
		JobID:           e.JobID,
		ParticipationID: nullable(e.ParticipationID),
		SubjectUserID:   nullable(e.SubjectUserID),
		Payload:         payload,
	})
}

func nullable(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}
