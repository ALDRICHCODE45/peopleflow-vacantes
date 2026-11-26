package domain

import (
	"sort"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
)

// SourceEntityID reads the audit event's entity_id; any other source names an
// audit metadata key.
const SourceEntityID = "entity_id"

// Field copies one id/enum into the notification_events payload.
type Field struct {
	Key  string // payload key
	From string // SourceEntityID or a metadata key
}

// CaptureRule is one row of the §Capture table: which notification types an
// audit type produces (resolved at fan-out) and where the captured ids come
// from. Empty Participation/Subject means the column stays NULL. HasMessage
// asks the capture to record whether the participation holds a candidate
// message (D3, ParticipationDiscarded only).
type CaptureRule struct {
	Types         []Type
	Job           string
	Participation string
	Subject       string
	Payload       []Field
	HasMessage    bool
}

func (r CaptureRule) payloadSources() []string {
	out := make([]string, 0, len(r.Payload))
	for _, f := range r.Payload {
		out = append(out, f.From)
	}
	return out
}

func (r CaptureRule) clone() CaptureRule {
	r.Types = append([]Type(nil), r.Types...)
	r.Payload = append([]Field(nil), r.Payload...)
	return r
}

var stageMove = []Field{{"from_stage_id", "from_stage_id"}, {"to_stage_id", "to_stage_id"}}

// notifiable is the closed map audit type → capture rule (D2). Every other
// audit type, including manual adds, substate changes, legacy job events and
// the delivery/deadline types the scheduler only resolves, notifies nothing.
var notifiable = map[string]CaptureRule{
	audit.EventVacancyApplicationSubmitted: {Types: []Type{TypeApplicationReceived}, Job: "vacancy_id", Participation: SourceEntityID},
	audit.EventVacancyTeamCreated: {Types: []Type{TypeVacancyAssigned}, Job: SourceEntityID, Subject: "responsible_user_id",
		Payload: []Field{{"assignment_id", "assignment_id"}}},
	// D10: the new responsible (subject) and the previous one (payload.from_user_id).
	audit.EventVacancyResponsibleReassigned: {Types: []Type{TypeVacancyReassigned, TypeVacancyUnassigned}, Job: SourceEntityID, Subject: "to_user_id",
		Payload: []Field{{"reassignment_id", "reassignment_id"}, {"from_user_id", "from_user_id"}, {"reason", "reason"}}},
	audit.EventVacancyTeamMemberAdded: {Types: []Type{TypeVacancyTeamAdded}, Job: SourceEntityID, Subject: "user_id",
		Payload: []Field{{"assignment_id", "assignment_id"}, {"function", "function"}}},
	audit.EventPsychometricAssessmentFinished: {Types: []Type{TypePsychometricCompleted}, Job: "vacancy_id", Participation: "participation_id",
		Payload: []Field{{"invitation_id", SourceEntityID}}},
	audit.EventPsychometricInvitationCreated: {Types: []Type{TypePsychometricPending, TypeCandidateTestPending}, Job: "vacancy_id", Participation: "participation_id",
		Payload: []Field{{"invitation_id", SourceEntityID}}},
	// D7: only a visible status change notifies; decided at fan-out.
	audit.EventParticipationMoved:     {Types: []Type{TypeCandidateStatusChanged}, Job: "vacancy_id", Participation: SourceEntityID, Payload: stageMove},
	audit.EventParticipationRecovered: {Types: []Type{TypeCandidateStatusChanged}, Job: "vacancy_id", Participation: SourceEntityID, Payload: stageMove},
	// D8: has_message selects candidate_message_received, otherwise candidate_status_changed.
	audit.EventParticipationDiscarded: {Types: []Type{TypeCandidateStatusChanged, TypeCandidateMessageReceived}, Job: "vacancy_id", Participation: SourceEntityID,
		Payload: stageMove, HasMessage: true},
}

// Rule returns a copy of the capture rule of an audit type; ok is false for
// every type that does not notify.
func Rule(auditType string) (CaptureRule, bool) {
	r, ok := notifiable[auditType]
	if !ok {
		return CaptureRule{}, false
	}
	return r.clone(), true
}

// NotifiableAuditTypes returns the notifiable audit types, sorted.
func NotifiableAuditTypes() []string {
	out := make([]string, 0, len(notifiable))
	for k := range notifiable {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
