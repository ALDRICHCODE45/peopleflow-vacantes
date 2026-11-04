// Package entities holds the audit_events domain model (design D3): the
// AuditEvent entity, the ActorType value object, and the closed event-type
// vocabulary for this cycle. The entity deliberately carries no OccurredAt —
// the DB now() DEFAULT supplies server time at insert.
//
// companies-audit WU1: the closed event-type vocabulary expands from two
// events to four (`ApplicationSubmitted`, `ApplicationTransitioned`,
// `CompanyUpdated`, `CompanyDeleted`). The companion entity-type set
// expands from `application` to `application` + `company`. Future-only
// constants (`EventCompanyCreated`, `CompanyRestored`,
// `CompanySoftDeleted`) stay deferred — adding one for a non-existent
// emitter would violate the closed-vocabulary invariant pinned by
// `TestEventVocabularyIsClosed`.
package entities

import (
	"strconv"

	"github.com/google/uuid"
)

// ActorType is the closed actor vocabulary, mirrored by the
// audit_events_actor_type_check CHECK at the DB boundary.
type ActorType string

const (
	ActorTypeUser   ActorType = "user"
	ActorTypeSystem ActorType = "system"
)

func (a ActorType) String() string { return string(a) }

// Entity-type constants — companion to the closed event set.
//
// companies-audit: `EntityCompany = "company"` (singular) sits alongside
// the existing `EntityApplication = "application"`. The singular form is
// the closed vocabulary; the legacy plural literal (`"companies"`) lives
// only in the existing companies-write test fixtures and is cleaned up
// alongside the rest of the seam (see companies-write apply-progress.md
// §"Cleanup predicate widening").
const (
	EntityApplication = "application"
	EntityCompany     = "company"
	EntityCompanySite = "company_site"
	// EntityJobDraft is the private draft authoring resource entity type.
	EntityJobDraft = "job_draft"
	// EntityJobDraftRequester is the requester catalog entry entity type.
	EntityJobDraftRequester = "job_draft_requester"
)

// CompanyDeletedMetadata assembles the PII-free CompanyDeleted metadata
// map (companies-audit design D7). The `jobs_closed` key is ALWAYS
// present, even when the rowcount is zero, so the metadata shape is
// stable and machine-parseable (audit_events spec
// "Metadata Shape (PII-Free)" — Scenario "CompanyDeleted metadata always
// carries jobs_closed, even when zero"). The key set is closed to
// `{jobs_closed}`; no other key can be added without changing this
// signature, which is the structural enforcement of the PII-free
// invariant.
//
// The wire value is the stringified integer via `strconv.Itoa`, NOT the
// bare int and NOT a fmt.Sprintf("%v") variant — the audit_events
// postgres adapter marshals `map[string]string` to JSONB and the
// downstream consumers parse the value as a string (the SQL test asserts
// `metadata->>'jobs_closed' = '<n>'`).
//
// This function is the single source of truth for the CompanyDeleted
// metadata shape; the companies slice's adapter calls it after observing
// the inline `CloseCompanyJobs` rowcount (the use case cannot observe
// the count because it has not yet entered the adapter's tx).
func CompanyDeletedMetadata(closedCount int) map[string]string {
	return map[string]string{"jobs_closed": strconv.Itoa(closedCount)}
}

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
	// CompanyID and VacancyID are the company and vacancy the event belongs to
	// (audit-log-v1 §1). nil stores NULL. ip, user_agent and ip_source are not
	// fields: the adapter reads them from the request context.
	CompanyID *uuid.UUID
	VacancyID *uuid.UUID
	// StructuredMetadata supports ID/code arrays (placement recipients). When
	// present it replaces Metadata; legacy emitters retain string-only values.
	StructuredMetadata map[string]any
}
