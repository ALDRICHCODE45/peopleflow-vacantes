package domain

import (
	"errors"
	"reflect"
	"testing"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

func TestBuildEventCopiesIdsPerCaptureRule(t *testing.T) {
	company, actor, entity, job, other := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	base := audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &actor, EntityID: entity, CompanyID: &company}

	reassigned := base
	reassigned.EventType = audit.EventVacancyResponsibleReassigned
	reassigned.Metadata = map[string]string{"company_id": company.String(), "reassignment_id": "r1", "from_user_id": "u-from", "to_user_id": other.String(),
		"from_assignment_id": "a1", "to_assignment_id": "a2", "reason": "workload", "previous_responsible": "remove"}
	got, ok, err := BuildEvent(reassigned)
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	want := Event{AuditEventID: reassigned.ID, CompanyID: company, EventType: audit.EventVacancyResponsibleReassigned, ActorUserID: &actor, JobID: entity,
		SubjectUserID: &other, Payload: map[string]any{"reassignment_id": "r1", "from_user_id": "u-from", "reason": "workload"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}

	// System actor (automatic psychometric invitation) → NULL actor; entity id goes to the payload.
	invitation := base
	invitation.ActorType, invitation.ActorID = audit.ActorTypeSystem, nil
	invitation.EventType = audit.EventPsychometricInvitationCreated
	invitation.Metadata = map[string]string{"vacancy_id": job.String(), "participation_id": other.String()}
	got, ok, err = BuildEvent(invitation)
	if err != nil || !ok || got.ActorUserID != nil || got.JobID != job || got.ParticipationID == nil || *got.ParticipationID != other ||
		got.SubjectUserID != nil || !reflect.DeepEqual(got.Payload, map[string]any{"invitation_id": entity.String()}) || got.NeedsHasMessage {
		t.Fatalf("invitation: %+v %v %v", got, ok, err)
	}

	discard := base
	discard.EventType = audit.EventParticipationDiscarded
	discard.Metadata = map[string]string{"vacancy_id": job.String(), "from_stage_id": "s1", "to_stage_id": "s2", "version": "3", "hire": "false", "departure": "false"}
	got, _, err = BuildEvent(discard)
	if err != nil || !got.NeedsHasMessage || *got.ParticipationID != entity || !reflect.DeepEqual(got.Payload, map[string]any{"from_stage_id": "s1", "to_stage_id": "s2"}) {
		t.Fatalf("discard: %+v %v", got, err)
	}
}

func TestBuildEventSkipsNonNotifiableTypes(t *testing.T) {
	company := uuid.New()
	got, ok, err := BuildEvent(audit.AuditEvent{ID: uuid.New(), EventType: audit.EventParticipationSubstateChanged, CompanyID: &company})
	if err != nil || ok || !reflect.DeepEqual(got, Event{}) {
		t.Fatal(got, ok, err)
	}
}

// A notifiable event without the ids its rule needs is refused, so the
// caller's transaction fails closed instead of losing the notification.
// An absent optional id (participation/subject) is captured as NULL: a
// notification gap must never abort the domain write (review R3/R4).
func TestBuildEventAbsentOptionalIdsAreNull(t *testing.T) {
	company := uuid.New()
	event := audit.AuditEvent{ID: uuid.New(), EventType: audit.EventVacancyTeamCreated, EntityID: uuid.New(), CompanyID: &company, Metadata: map[string]string{"mode": "without_responsible"}}
	got, ok, err := BuildEvent(event)
	if !ok || err != nil {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if got.SubjectUserID != nil || got.ParticipationID != nil || got.JobID != event.EntityID {
		t.Fatalf("subject=%v participation=%v job=%v", got.SubjectUserID, got.ParticipationID, got.JobID)
	}
}

func TestBuildEventRefusesMissingIds(t *testing.T) {
	company := uuid.New()
	for name, event := range map[string]audit.AuditEvent{
		"no company":        {ID: uuid.New(), EventType: audit.EventVacancyApplicationSubmitted, EntityID: uuid.New(), Metadata: map[string]string{"vacancy_id": uuid.NewString()}},
		"no job":            {ID: uuid.New(), EventType: audit.EventVacancyApplicationSubmitted, EntityID: uuid.New(), CompanyID: &company, Metadata: map[string]string{}},
		"malformed job":     {ID: uuid.New(), EventType: audit.EventParticipationMoved, EntityID: uuid.New(), CompanyID: &company, Metadata: map[string]string{"vacancy_id": "nope"}},
		"malformed subject": {ID: uuid.New(), EventType: audit.EventVacancyTeamCreated, EntityID: uuid.New(), CompanyID: &company, Metadata: map[string]string{"assignment_id": "a", "responsible_user_id": "nope"}},
		"nil participation": {ID: uuid.New(), EventType: audit.EventPsychometricAssessmentFinished, EntityID: uuid.New(), CompanyID: &company, Metadata: map[string]string{"vacancy_id": uuid.NewString(), "participation_id": uuid.Nil.String()}},
		"nil entity as job": {ID: uuid.New(), EventType: audit.EventVacancyTeamMemberAdded, CompanyID: &company, Metadata: map[string]string{"user_id": uuid.NewString()}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, ok, err := BuildEvent(event); !ok || !errors.Is(err, ErrMissingID) {
				t.Fatalf("ok=%v err=%v", ok, err)
			}
		})
	}
}

// L9 follow-up: actor_user_id is an FK to users, so it is copied only for a
// user actor; any other actor type stores NULL even if an id is present.
func TestBuildEventCopiesActorOnlyForUserActors(t *testing.T) {
	company, actor := uuid.New(), uuid.New()
	event := audit.AuditEvent{ID: uuid.New(), EventType: audit.EventVacancyApplicationSubmitted, EntityID: uuid.New(), CompanyID: &company,
		ActorID: &actor, Metadata: map[string]string{"vacancy_id": uuid.NewString()}}
	for actorType, want := range map[audit.ActorType]bool{audit.ActorTypeUser: true, audit.ActorTypeSystem: false, "": false} {
		event.ActorType = actorType
		got, ok, err := BuildEvent(event)
		if err != nil || !ok {
			t.Fatal(ok, err)
		}
		if (got.ActorUserID != nil) != want || (want && *got.ActorUserID != actor) {
			t.Fatalf("actor type %q: actor_user_id=%v", actorType, got.ActorUserID)
		}
		if got.ActorUserID != nil && got.ActorUserID == event.ActorID {
			t.Fatal("actor id must be copied, not aliased")
		}
	}
}

// L9 follow-up: structured metadata replaces Metadata; string values are read,
// non-string values count as absent, and Metadata is ignored.
func TestBuildEventReadsStructuredMetadata(t *testing.T) {
	company, job, participation := uuid.New(), uuid.New(), uuid.New()
	event := audit.AuditEvent{ID: uuid.New(), EventType: audit.EventPsychometricAssessmentFinished, EntityID: uuid.New(), CompanyID: &company,
		Metadata:           map[string]string{"vacancy_id": uuid.NewString(), "participation_id": uuid.NewString()},
		StructuredMetadata: map[string]any{"vacancy_id": job.String(), "participation_id": participation.String()}}
	got, ok, err := BuildEvent(event)
	if err != nil || !ok || got.JobID != job || got.ParticipationID == nil || *got.ParticipationID != participation {
		t.Fatalf("structured: %+v %v %v", got, ok, err)
	}
	event.StructuredMetadata = map[string]any{"vacancy_id": job.String(), "participation_id": []string{participation.String()}}
	got, ok, err = BuildEvent(event)
	if err != nil || !ok || got.ParticipationID != nil {
		t.Fatalf("non-string value must count as absent: %+v %v %v", got, ok, err)
	}
	event.StructuredMetadata = map[string]any{"participation_id": participation.String()}
	if _, _, err := BuildEvent(event); !errors.Is(err, ErrMissingID) {
		t.Fatalf("metadata must not be read when structured metadata is present: %v", err)
	}
}
