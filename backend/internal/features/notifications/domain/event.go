package domain

import (
	"errors"
	"fmt"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

// ErrMissingID: a notifiable audit event lacks an id its capture rule needs.
// Errors name the audit type and source, never a value.
var ErrMissingID = errors.New("notifiable audit event lacks a required id")

// Event is the notification_events row captured with one audit event (D3):
// ids and enums only. NeedsHasMessage asks the adapter to add the
// `has_message` flag read inside the same transaction.
type Event struct {
	AuditEventID    uuid.UUID
	CompanyID       uuid.UUID
	EventType       string
	ActorUserID     *uuid.UUID
	JobID           uuid.UUID
	ParticipationID *uuid.UUID
	SubjectUserID   *uuid.UUID
	Payload         map[string]any
	NeedsHasMessage bool
}

// BuildEvent maps an audit event through its capture rule. ok is false (and
// the error nil) for a non-notifiable type. A notifiable event without its
// company, job or a declared participation/subject id is refused with
// ErrMissingID so the caller's transaction fails closed.
func BuildEvent(event audit.AuditEvent) (Event, bool, error) {
	rule, ok := notifiable[event.EventType]
	if !ok {
		return Event{}, false, nil
	}
	if event.CompanyID == nil || *event.CompanyID == uuid.Nil {
		return Event{}, true, fmt.Errorf("%w: %s.company_id", ErrMissingID, event.EventType)
	}
	job, err := requiredID(event, rule.Job)
	if err != nil {
		return Event{}, true, err
	}
	out := Event{AuditEventID: event.ID, CompanyID: *event.CompanyID, EventType: event.EventType, JobID: job, Payload: map[string]any{}, NeedsHasMessage: rule.HasMessage}
	if event.ActorID != nil {
		actor := *event.ActorID
		out.ActorUserID = &actor
	}
	if out.ParticipationID, err = optionalID(event, rule.Participation); err != nil {
		return Event{}, true, err
	}
	if out.SubjectUserID, err = optionalID(event, rule.Subject); err != nil {
		return Event{}, true, err
	}
	for _, f := range rule.Payload {
		if v, ok := source(event, f.From); ok {
			out.Payload[f.Key] = v
		}
	}
	return out, true, nil
}

// optionalID returns nil when the rule declares no source or the value is
// absent (captured as NULL; the fan-out then finds no recipient), and refuses
// only a present but malformed or nil id.
func optionalID(event audit.AuditEvent, from string) (*uuid.UUID, error) {
	if from == "" {
		return nil, nil
	}
	if _, present := source(event, from); !present {
		return nil, nil
	}
	id, err := requiredID(event, from)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func requiredID(event audit.AuditEvent, from string) (uuid.UUID, error) {
	raw, _ := source(event, from)
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil {
		return uuid.Nil, fmt.Errorf("%w: %s.%s", ErrMissingID, event.EventType, from)
	}
	return id, nil
}

// source reads entity_id or a metadata key (string metadata, or a string
// value of structured metadata). Absent or empty values report ok=false.
func source(event audit.AuditEvent, from string) (string, bool) {
	if from == SourceEntityID {
		if event.EntityID == uuid.Nil {
			return "", false
		}
		return event.EntityID.String(), true
	}
	var v string
	if event.StructuredMetadata != nil {
		v, _ = event.StructuredMetadata[from].(string)
	} else {
		v = event.Metadata[from]
	}
	return v, v != ""
}
