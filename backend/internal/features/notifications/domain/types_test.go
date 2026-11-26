package domain

import (
	"testing"
)

// The contract's §Kind and urgency table (D12) plus the relation (§Recipients)
// and group rule (D11) of every stage-1 type, row by row.
func TestTypeTableMatchesContract(t *testing.T) {
	want := []Spec{
		{TypeApplicationReceived, KindOperational, UrgencyNormal, RecipientMember, RelationTeam, GroupApplications, false},
		{TypeDeliveryDueSoon, KindOperational, UrgencyDueSoon, RecipientMember, RelationTeam, GroupSingle, true},
		{TypeDeliveryOverdue, KindMandatory, UrgencyOverdue, RecipientMember, RelationTeam, GroupSingle, true},
		{TypeAssignmentDeadlineDueSoon, KindOperational, UrgencyDueSoon, RecipientMember, RelationAssignee, GroupSingle, true},
		{TypeAssignmentDeadlineOverdue, KindMandatory, UrgencyOverdue, RecipientMember, RelationAssignee, GroupSingle, true},
		{TypeVacancyAssigned, KindMandatory, UrgencyNormal, RecipientMember, RelationAssignee, GroupSingle, false},
		{TypeVacancyReassigned, KindMandatory, UrgencyNormal, RecipientMember, RelationAssignee, GroupSingle, false},
		{TypeVacancyUnassigned, KindMandatory, UrgencyNormal, RecipientMember, RelationPreviousAssignee, GroupSingle, false},
		{TypeVacancyTeamAdded, KindMandatory, UrgencyNormal, RecipientMember, RelationAssignee, GroupSingle, false},
		{TypePsychometricCompleted, KindOperational, UrgencyNormal, RecipientMember, RelationTeam, GroupPsychometrics, false},
		{TypePsychometricPending, KindOperational, UrgencyNormal, RecipientMember, RelationTeam, GroupPsychometricsPending, false},
		{TypeCandidateStatusChanged, KindOperational, UrgencyNormal, RecipientCandidate, RelationCandidate, GroupSingle, false},
		{TypeCandidateMessageReceived, KindOperational, UrgencyNormal, RecipientCandidate, RelationCandidate, GroupSingle, false},
		{TypeCandidateTestPending, KindOperational, UrgencyNormal, RecipientCandidate, RelationCandidate, GroupSingle, false},
	}
	got := Types()
	if len(got) != len(want) {
		t.Fatalf("types = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d = %+v, want %+v", i, got[i], want[i])
		}
		spec, ok := Lookup(want[i].Type)
		if !ok || spec != want[i] {
			t.Errorf("Lookup(%s) = %+v %v", want[i].Type, spec, ok)
		}
	}
	if _, ok := Lookup("team_added"); ok {
		t.Error("S2 name team_added must not exist (D9)")
	}
}

// The migration CHECK lists exactly these values; a drift breaks inserts.
func TestTypeTableClosedVocabulary(t *testing.T) {
	seen := map[Type]bool{}
	for _, s := range Types() {
		if seen[s.Type] {
			t.Fatalf("duplicate type %s", s.Type)
		}
		seen[s.Type] = true
		if s.Kind == KindInformative {
			t.Errorf("%s: no informative type in stage 1", s.Type)
		}
		if s.Scheduled != (s.Urgency != UrgencyNormal) {
			t.Errorf("%s: scheduled types are exactly the deadline types", s.Type)
		}
		if (s.RecipientKind == RecipientCandidate) != (s.Relation == RelationCandidate) {
			t.Errorf("%s: candidate recipient kind iff candidate relation", s.Type)
		}
	}
	got := Types()
	got[0].Kind = KindInformative
	if Types()[0].Kind == KindInformative {
		t.Fatal("Types must return a copy")
	}
}
