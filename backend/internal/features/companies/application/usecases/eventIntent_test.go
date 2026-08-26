// Unit tests for the companies event-intent builders (companies-audit
// WU2). The builders are the single source of truth for the AuditEvent
// shape on the companies write paths — the structural enforcement of
// the PII-free invariant (the function signatures cannot express PII:
// the PATCH builder takes no company profile fields; the DELETE builder
// takes no jobs profile fields). The closed-vocabulary assertions
// below are the spec compliance proof.
package usecases

import (
	"reflect"
	"testing"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

// TestNewCompanyUpdatedEvent_Shape pins the exact AuditEvent structure
// the use case builds for a successful PATCH (companies-audit design
// D5 / D7):
//   - ID carries the eventID the use case minted with uuid.NewV7().
//   - ActorType is ActorTypeUser (a recruiter's write — CompanyContext.UserID).
//   - ActorID points at userID (the JWT-resolved users.id).
//   - EventType is EventCompanyUpdated (the closed vocabulary).
//   - EntityType is EntityCompany = "company" (singular).
//   - EntityID is companyID (the CompanyContext.CompanyID).
//   - Metadata is non-nil AND empty (`len(Metadata) == 0`) — the
//     PATCH event carries no profile diff; the 200 OK body already
//     carries the post-write state, so a "what changed" diff would
//     leak free-text profile values.
func TestNewCompanyUpdatedEvent_Shape(t *testing.T) {
	eventID := uuid.New()
	companyID := uuid.New()
	userID := uuid.New()

	got := newCompanyUpdatedEvent(eventID, companyID, userID)

	if got.ID != eventID {
		t.Errorf("ID: want %v, got %v", eventID, got.ID)
	}
	if got.ActorType != auditentities.ActorTypeUser {
		t.Errorf("ActorType: want %q, got %q", auditentities.ActorTypeUser, got.ActorType)
	}
	if got.ActorID == nil {
		t.Fatal("ActorID: want non-nil (user actor)")
	}
	if *got.ActorID != userID {
		t.Errorf("ActorID: want %v, got %v", userID, *got.ActorID)
	}
	if got.EventType != auditentities.EventCompanyUpdated {
		t.Errorf("EventType: want %q, got %q", auditentities.EventCompanyUpdated, got.EventType)
	}
	if got.EntityType != auditentities.EntityCompany {
		t.Errorf("EntityType: want %q, got %q", auditentities.EntityCompany, got.EntityType)
	}
	if got.EntityID != companyID {
		t.Errorf("EntityID: want %v, got %v", companyID, got.EntityID)
	}
	if got.Metadata == nil {
		t.Fatal("Metadata: want non-nil empty map (JSONB `{}` invariant), got nil")
	}
	if len(got.Metadata) != 0 {
		t.Errorf("Metadata: want empty (len == 0), got %v", got.Metadata)
	}
}

// TestNewCompanyDeletedEvent_StructureAtBuildTime pins the exact
// AuditEvent structure the use case builds for a successful DELETE at
// BUILD time (before the adapter finalizes the metadata):
//   - ID, ActorType, ActorID, EventType, EntityType, EntityID match
//     the PATCH shape (same actor / entity / event family).
//   - Metadata is nil at build time — the adapter observes the inline
//     CloseCompanyJobs rowcount AFTER the soft-delete write returns
//     in the same tx, so the use case has no count to pass in. The
//     adapter finalizes via auditentities.CompanyDeletedMetadata(int).
//     A non-nil map at build time would lock in an empty-key map that
//     the adapter would then overwrite — the nil sentinel is the
//     explicit "finalize me" handshake.
func TestNewCompanyDeletedEvent_StructureAtBuildTime(t *testing.T) {
	eventID := uuid.New()
	companyID := uuid.New()
	userID := uuid.New()

	got := newCompanyDeletedEvent(eventID, companyID, userID)

	if got.ID != eventID {
		t.Errorf("ID: want %v, got %v", eventID, got.ID)
	}
	if got.ActorType != auditentities.ActorTypeUser {
		t.Errorf("ActorType: want %q, got %q", auditentities.ActorTypeUser, got.ActorType)
	}
	if got.ActorID == nil {
		t.Fatal("ActorID: want non-nil (user actor)")
	}
	if *got.ActorID != userID {
		t.Errorf("ActorID: want %v, got %v", userID, *got.ActorID)
	}
	if got.EventType != auditentities.EventCompanyDeleted {
		t.Errorf("EventType: want %q, got %q", auditentities.EventCompanyDeleted, got.EventType)
	}
	if got.EntityType != auditentities.EntityCompany {
		t.Errorf("EntityType: want %q, got %q", auditentities.EntityCompany, got.EntityType)
	}
	if got.EntityID != companyID {
		t.Errorf("EntityID: want %v, got %v", companyID, got.EntityID)
	}
	if got.Metadata != nil {
		t.Errorf("Metadata at build time: want nil (adapter finalizes), got %v", got.Metadata)
	}
}

// TestEventIntent_ClosedVocabulary_CompanyEvents pins the PII-free
// invariant for company events structurally: the closed-key vocabulary
// is the empty set for CompanyUpdated and `{jobs_closed}` ONLY for
// CompanyDeleted — no company profile field (`description`, `name`,
// `website`, `logo_url`, `size`, `founded_year`, `city`, `country`,
// `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`,
// `cover_image_url`, `rfc`, `industry_id`) can ever leak into the
// metadata. The forbidden-key table is asserted against both events.
func TestEventIntent_ClosedVocabulary_CompanyEvents(t *testing.T) {
	companyID := uuid.New()
	userID := uuid.New()

	// CompanyUpdated → metadata must be the empty object (no keys
	// at all); the wire form is JSONB `{}`.
	patchEvent := newCompanyUpdatedEvent(uuid.New(), companyID, userID)
	if patchEvent.Metadata == nil {
		t.Fatal("CompanyUpdated Metadata: want non-nil empty map, got nil")
	}
	if len(patchEvent.Metadata) != 0 {
		t.Errorf("CompanyUpdated Metadata: want empty (0 keys), got %d keys: %v",
			len(patchEvent.Metadata), patchEvent.Metadata)
	}

	// CompanyDeleted → metadata at build time is nil (the adapter
	// finalizes it). The forbidden-key guard at build time trivially
	// holds (no keys present), but the assertion is kept to prove the
	// use case does NOT pre-populate any key before handoff to the
	// adapter (the adapter finalizes exclusively via
	// auditentities.CompanyDeletedMetadata).
	deleteEvent := newCompanyDeletedEvent(uuid.New(), companyID, userID)
	if deleteEvent.Metadata != nil {
		t.Errorf("CompanyDeleted Metadata at build time: want nil, got %v", deleteEvent.Metadata)
	}

	// Post-finalization shape (the only legitimate CompanyDeleted
	// metadata shape the adapter can produce): {jobs_closed: <n>}.
	finalized := auditentities.CompanyDeletedMetadata(2)
	want := map[string]string{"jobs_closed": "2"}
	if !reflect.DeepEqual(finalized, want) {
		t.Errorf("CompanyDeletedMetadata(2): want %v, got %v", want, finalized)
	}

	// Forbidden key table — the closed-key vocabulary for company
	// events is empty for CompanyUpdated and {jobs_closed} only for
	// CompanyDeleted. None of the company profile fields, nor any
	// application PII field, may appear.
	forbiddenCompanyKeys := []string{
		"description", "name", "website", "logo_url", "size",
		"founded_year", "city", "country",
		"linkedin_url", "instagram_url", "facebook_url", "twitter_url",
		"cover_image_url", "rfc", "industry_id", "status", "rfc",
	}
	for _, key := range forbiddenCompanyKeys {
		if _, ok := finalized[key]; ok {
			t.Errorf("CompanyDeletedMetadata leaks forbidden key %q (PII-free invariant)", key)
		}
	}

	// Sanity: the closed-key vocabulary for the family. Adding a key
	// outside this set is a code change AND requires extending this
	// test — the structural enforcement of the PII-free invariant.
	allowedDeleteKeys := map[string]bool{"jobs_closed": true}
	for key := range finalized {
		if !allowedDeleteKeys[key] {
			t.Errorf("CompanyDeletedMetadata: key %q is outside the closed vocabulary {jobs_closed}", key)
		}
	}
}
