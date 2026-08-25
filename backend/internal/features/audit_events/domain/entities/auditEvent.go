// Package entities holds the audit_events domain model (design D3): the
// AuditEvent entity, the ActorType value object, and the closed event-type
// vocabulary for this cycle. The entity deliberately carries no OccurredAt —
// the DB now() DEFAULT supplies server time at insert.
package entities

import "github.com/google/uuid"

// ActorType is the closed actor vocabulary, mirrored by the
// audit_events_actor_type_check CHECK at the DB boundary.
type ActorType string

const (
	ActorTypeUser   ActorType = "user"
	ActorTypeSystem ActorType = "system"
)

func (a ActorType) String() string { return string(a) }

// Event-type constants — the CLOSED SET for this cycle. event_type has no
// DB CHECK (§1.3 exception), so adding a future event type is a code
// change, not a migration.
const (
	EventApplicationSubmitted    = "ApplicationSubmitted"
	EventApplicationTransitioned = "ApplicationTransitioned"
)

// EntityApplication is the only entity_type this slice writes.
const EntityApplication = "application"

// AuditEvent is the append-only audit event the emitting write path builds.
// OccurredAt is NOT a field: the DB now() DEFAULT supplies server time.
type AuditEvent struct {
	ID         uuid.UUID
	ActorType  ActorType
	ActorID    *uuid.UUID // nil ⇔ actor_type = 'system'
	EventType  string
	EntityType string
	EntityID   uuid.UUID
	Metadata   map[string]string // PII-free; exact keys pinned by D7 tests
}
