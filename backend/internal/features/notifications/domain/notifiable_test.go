package domain

import (
	"reflect"
	"slices"
	"testing"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
)

// D2: every notifiable key is an audit catalog type and every metadata key a
// rule reads is in that type's closed metadata set, so a catalog rename breaks
// this test instead of silently stopping notifications.
func TestNotifiableMapIsClosedOverAuditCatalog(t *testing.T) {
	keys := NotifiableAuditTypes()
	if len(keys) != 9 {
		t.Fatalf("notifiable audit types = %d, want 9: %v", len(keys), keys)
	}
	for _, key := range keys {
		spec, ok := audit.LookupEvent(key)
		if !ok {
			t.Errorf("%s is not in the audit catalog", key)
			continue
		}
		if !spec.CompanyScoped {
			t.Errorf("%s: every notifiable type must be company-scoped (notification_events.company_id NOT NULL)", key)
		}
		rule, _ := Rule(key)
		sources := append([]string{rule.Job, rule.Participation, rule.Subject}, rule.payloadSources()...)
		for _, source := range sources {
			if source == "" || source == SourceEntityID {
				continue
			}
			if !slices.Contains(spec.MetadataKeys, source) {
				t.Errorf("%s reads metadata key %q outside the catalog set %v", key, source, spec.MetadataKeys)
			}
		}
		if len(rule.Types) == 0 {
			t.Errorf("%s maps to no notification type", key)
		}
		for _, typ := range rule.Types {
			spec, ok := Lookup(typ)
			if !ok || spec.Scheduled {
				t.Errorf("%s maps to %s, which is not an immediate type", key, typ)
			}
		}
	}
}

// §Capture table, row by row.
func TestNotifiableMapMatchesContract(t *testing.T) {
	want := map[string]CaptureRule{
		audit.EventVacancyApplicationSubmitted: {Types: []Type{TypeApplicationReceived}, Job: "vacancy_id", Participation: SourceEntityID},
		audit.EventVacancyTeamCreated:          {Types: []Type{TypeVacancyAssigned}, Job: SourceEntityID, Subject: "responsible_user_id", Payload: []Field{{"assignment_id", "assignment_id"}}},
		audit.EventVacancyResponsibleReassigned: {Types: []Type{TypeVacancyReassigned, TypeVacancyUnassigned}, Job: SourceEntityID, Subject: "to_user_id",
			Payload: []Field{{"reassignment_id", "reassignment_id"}, {"from_user_id", "from_user_id"}, {"reason", "reason"}}},
		audit.EventVacancyTeamMemberAdded:         {Types: []Type{TypeVacancyTeamAdded}, Job: SourceEntityID, Subject: "user_id", Payload: []Field{{"assignment_id", "assignment_id"}, {"function", "function"}}},
		audit.EventPsychometricAssessmentFinished: {Types: []Type{TypePsychometricCompleted}, Job: "vacancy_id", Participation: "participation_id", Payload: []Field{{"invitation_id", SourceEntityID}}},
		audit.EventPsychometricInvitationCreated:  {Types: []Type{TypePsychometricPending, TypeCandidateTestPending}, Job: "vacancy_id", Participation: "participation_id", Payload: []Field{{"invitation_id", SourceEntityID}}},
		audit.EventParticipationMoved:             {Types: []Type{TypeCandidateStatusChanged}, Job: "vacancy_id", Participation: SourceEntityID, Payload: []Field{{"from_stage_id", "from_stage_id"}, {"to_stage_id", "to_stage_id"}}},
		audit.EventParticipationRecovered:         {Types: []Type{TypeCandidateStatusChanged}, Job: "vacancy_id", Participation: SourceEntityID, Payload: []Field{{"from_stage_id", "from_stage_id"}, {"to_stage_id", "to_stage_id"}}},
		audit.EventParticipationDiscarded: {Types: []Type{TypeCandidateStatusChanged, TypeCandidateMessageReceived}, Job: "vacancy_id", Participation: SourceEntityID,
			Payload: []Field{{"from_stage_id", "from_stage_id"}, {"to_stage_id", "to_stage_id"}}, HasMessage: true},
	}
	for key, rule := range want {
		got, ok := Rule(key)
		if !ok || !reflect.DeepEqual(got, rule) {
			t.Errorf("Rule(%s) = %+v %v, want %+v", key, got, ok, rule)
		}
	}
	for _, key := range []string{audit.EventVacancyCandidateAddedManually, audit.EventParticipationSubstateChanged, audit.EventVacancyCandidateCarried,
		audit.EventApplicationSubmitted, audit.EventVacancyDeliveryFulfilled, audit.EventVacancyTeamMemberRemoved, audit.EventCompanyUpdated} {
		if _, ok := Rule(key); ok {
			t.Errorf("%s must not notify in stage 1", key)
		}
	}
	got, _ := Rule(audit.EventParticipationDiscarded)
	got.Types[0], got.Payload[0].Key = "x", "x"
	if again, _ := Rule(audit.EventParticipationDiscarded); again.Types[0] == "x" || again.Payload[0].Key == "x" {
		t.Fatal("Rule must return a copy")
	}
}
