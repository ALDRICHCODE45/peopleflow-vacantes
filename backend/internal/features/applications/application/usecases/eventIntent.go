package usecases

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

// Event-intent builders (design D7). These four functions are the ONLY place
// the audit metadata keys are assembled for the applications write paths: the
// PII-free shape ({job_id[, source]} / {job_id, from_status, to_status}) is
// pinned here and locked by the unit tests in eventIntent_test.go. cover_letter
// and candidate PII are never passed into these builders — the signatures
// simply cannot express them, which is the structural enforcement of the
// PII-free invariant (design D7 / spec "Metadata PII-free").

// buildSubmittedMetadata assembles the ApplicationSubmitted metadata map:
// job_id is always present; source appears ONLY when the candidate supplied
// one (nil source ⇔ the row's source is SQL NULL ⇔ no "source" key).
func buildSubmittedMetadata(jobID uuid.UUID, source *valueobjects.ApplicationSource) map[string]string {
	m := map[string]string{"job_id": jobID.String()}
	if source != nil {
		m["source"] = source.String()
	}
	return m
}

// buildTransitionedMetadata assembles the ApplicationTransitioned metadata
// map: exactly {job_id, from_status, to_status}, each carrying the canonical
// String() form of its VO.
func buildTransitionedMetadata(jobID uuid.UUID, from, to valueobjects.ApplicationStatus) map[string]string {
	return map[string]string{
		"job_id":      jobID.String(),
		"from_status": from.String(),
		"to_status":   to.String(),
	}
}

// newSubmittedEvent builds the ApplicationSubmitted audit event intent for
// repo.Create. The actor is the resolved candidate users.id ('user' type);
// the entity is the application row the caller is about to create; the
// metadata is the PII-free {job_id[, source]} shape. The event id is a fresh
// UUID v7 owned by the use case (the DB has no id default — D1).
func newSubmittedEvent(
	eventID, appID, candidateID, jobID uuid.UUID,
	source *valueobjects.ApplicationSource,
) auditentities.AuditEvent {
	actorID := candidateID
	return auditentities.AuditEvent{
		ID:         eventID,
		ActorType:  auditentities.ActorTypeUser,
		ActorID:    &actorID,
		EventType:  auditentities.EventApplicationSubmitted,
		EntityType: auditentities.EntityApplication,
		EntityID:   appID,
		Metadata:   buildSubmittedMetadata(jobID, source),
	}
}

// newTransitionedEvent builds the ApplicationTransitioned audit event intent
// for repo.Transition. The actor is the CompanyContext.UserID ('user' type —
// the recruiter performing the transition, D8); the metadata is the PII-free
// {job_id, from_status, to_status} shape.
func newTransitionedEvent(
	eventID, applicationID, userID, jobID uuid.UUID,
	from, to valueobjects.ApplicationStatus,
) auditentities.AuditEvent {
	actorID := userID
	return auditentities.AuditEvent{
		ID:         eventID,
		ActorType:  auditentities.ActorTypeUser,
		ActorID:    &actorID,
		EventType:  auditentities.EventApplicationTransitioned,
		EntityType: auditentities.EntityApplication,
		EntityID:   applicationID,
		Metadata:   buildTransitionedMetadata(jobID, from, to),
	}
}
