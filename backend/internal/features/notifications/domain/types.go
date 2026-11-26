// Package domain holds the notifications vocabulary (notifications-v1): the
// closed table of the 14 stage-1 notification types with the kind, urgency,
// recipient kind, recipient relation and group rule each one implies (D5, D11,
// D12), and the closed notifiable map from audit event types to the
// notification types they produce (§Capture, D2).
package domain

// Type is one notification type; the set mirrors the notifications.type CHECK
// of migration 00068.
type Type string

const (
	TypeApplicationReceived       Type = "application_received"
	TypeDeliveryDueSoon           Type = "delivery_due_soon"
	TypeDeliveryOverdue           Type = "delivery_overdue"
	TypeAssignmentDeadlineDueSoon Type = "assignment_deadline_due_soon"
	TypeAssignmentDeadlineOverdue Type = "assignment_deadline_overdue"
	TypeVacancyAssigned           Type = "vacancy_assigned"
	TypeVacancyReassigned         Type = "vacancy_reassigned"
	TypeVacancyUnassigned         Type = "vacancy_unassigned"
	TypeVacancyTeamAdded          Type = "vacancy_team_added"
	TypePsychometricCompleted     Type = "psychometric_completed"
	TypePsychometricPending       Type = "psychometric_pending"
	TypeCandidateStatusChanged    Type = "candidate_status_changed"
	TypeCandidateMessageReceived  Type = "candidate_message_received"
	TypeCandidateTestPending      Type = "candidate_test_pending"
)

// Kind classifies a type for the inbox and for stage-2 preferences (D12).
type Kind string

const (
	KindMandatory   Kind = "mandatory"
	KindOperational Kind = "operational"
	KindInformative Kind = "informative" // reserved for stage 2/3
)

// Urgency drives the attention section (D12, D13).
type Urgency string

const (
	UrgencyNormal  Urgency = "normal"
	UrgencyDueSoon Urgency = "due_soon"
	UrgencyOverdue Urgency = "overdue"
)

// RecipientKind mirrors notifications.recipient_kind.
type RecipientKind string

const (
	RecipientMember    RecipientKind = "member"
	RecipientCandidate RecipientKind = "candidate"
)

// Relation is how the resolver finds recipients (D5); it mirrors
// notifications.recipient_reason. Stage 3 adds a role relation.
type Relation string

const (
	RelationTeam             Relation = "team"
	RelationAssignee         Relation = "assignee"
	RelationPreviousAssignee Relation = "previous_assignee"
	RelationCandidate        Relation = "candidate"
)

// GroupRule is the group_key prefix of a type (D11): grouped types use
// `<prefix>:<job_id>:<YYYY-MM-DD>`, GroupSingle uses `n:<notification_id>`.
type GroupRule string

const (
	GroupApplications         GroupRule = "applications"
	GroupPsychometrics        GroupRule = "psychometrics"
	GroupPsychometricsPending GroupRule = "psychometrics_pending"
	GroupSingle               GroupRule = "n"
)

// Spec is one row of the closed type table. Scheduled types come from the
// scheduler (no source event, a commitment date); the rest from captured events.
type Spec struct {
	Type          Type
	Kind          Kind
	Urgency       Urgency
	RecipientKind RecipientKind
	Relation      Relation
	Group         GroupRule
	Scheduled     bool
}

// types follows the order of the contract's §Kind and urgency table.
var types = []Spec{
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

var typeIndex = func() map[Type]Spec {
	index := make(map[Type]Spec, len(types))
	for _, s := range types {
		index[s.Type] = s
	}
	return index
}()

// Types returns a copy of the ordered type table.
func Types() []Spec { return append([]Spec(nil), types...) }

// Lookup returns the table row of a type.
func Lookup(t Type) (Spec, bool) {
	s, ok := typeIndex[t]
	return s, ok
}
