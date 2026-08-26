// Package usecases (companies): event-intent builders (companies-audit
// design D5). These two functions are the ONLY place the
// `AuditEvent` structure for company write paths is assembled. The
// function signatures cannot express PII: the PATCH builder takes no
// company profile fields (the post-write state is in the 200 OK body);
// the DELETE builder takes no jobs profile fields. The metadata
// finalization for `CompanyDeleted` is delegated to the audit_events
// domain's `auditentities.CompanyDeletedMetadata(int)` builder so the
// adapter can call it after observing the inline `CloseCompanyJobs`
// rowcount, without an infra→application import.
//
// The closed-vocabulary invariant is structurally enforced here:
// adding a new metadata key requires changing this signature AND
// extending the unit tests in `eventIntent_test.go` (the structural
// PII-free guard).
package usecases

import (
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

// newCompanyUpdatedEvent assembles the CompanyUpdated AuditEvent the
// use case hands to `repo.UpdateCompany`. The PATCH event has:
//
//   - ID: the fresh UUIDv7 the use case minted (eventID).
//   - ActorType: ActorTypeUser (human owner, CompanyContext.UserID).
//   - ActorID: &userID (pointer; the audit adapter maps non-nil to
//     a valid pgtype.UUID, nil to SQL NULL).
//   - EventType: EventCompanyUpdated (closed vocabulary).
//   - EntityType: EntityCompany = "company" (singular; closed vocabulary).
//   - EntityID: companyID (the CompanyContext.CompanyID).
//   - Metadata: an EMPTY map (`map[string]string{}`) — non-nil so
//     the JSONB column marshals to `{}`, NOT `null`. The post-write
//     state is in the 200 OK body; a "what changed" diff would
//     leak free-text profile values (`name`, `description`, `website`,
//     etc.) and is intentionally omitted.
func newCompanyUpdatedEvent(eventID, companyID, userID uuid.UUID) auditentities.AuditEvent {
	actorID := userID
	return auditentities.AuditEvent{
		ID:         eventID,
		ActorType:  auditentities.ActorTypeUser,
		ActorID:    &actorID,
		EventType:  auditentities.EventCompanyUpdated,
		EntityType: auditentities.EntityCompany,
		EntityID:   companyID,
		Metadata:   map[string]string{},
	}
}

// newCompanyDeletedEvent assembles the CompanyDeleted AuditEvent the
// use case hands to `repo.SoftDeleteCompany`. The DELETE event:
//
//   - carries the same actor / entity / event family as the PATCH
//     event (same writer / company / closed-vocabulary literal);
//   - has Metadata == nil at build time — the use case has NOT
//     observed the inline `CloseCompanyJobs` rowcount (that count
//     only exists inside the adapter's tx, after the soft-delete
//     write returns). The adapter finalizes the metadata via
//     `auditentities.CompanyDeletedMetadata(int(closedCount))`
//     strictly BETWEEN `deleted == 1` and `tx.Commit` (D9).
//
// The nil sentinel at build time is the explicit "finalize me"
// handshake between the use case and the adapter; the adapter's
// `r.audit.Append` only fires after the metadata is finalized, so a
// non-nil map at build time would NOT lock in the empty form (the
// adapter would overwrite it). The nil sentinel keeps the
// responsibility split explicit and one-direction.
func newCompanyDeletedEvent(eventID, companyID, userID uuid.UUID) auditentities.AuditEvent {
	actorID := userID
	return auditentities.AuditEvent{
		ID:         eventID,
		ActorType:  auditentities.ActorTypeUser,
		ActorID:    &actorID,
		EventType:  auditentities.EventCompanyDeleted,
		EntityType: auditentities.EntityCompany,
		EntityID:   companyID,
		Metadata:   nil, // finalized by the adapter with CompanyDeletedMetadata(closedCount)
	}
}
