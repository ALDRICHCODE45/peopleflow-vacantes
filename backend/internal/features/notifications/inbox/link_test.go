package inbox

import (
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

func TestLinkPerType(t *testing.T) {
	job, participation, invitation := uuid.New(), uuid.New(), uuid.New()
	j, p := job.String(), participation.String()
	cases := []struct {
		name    string
		typ     domain.Type
		count   int
		part    *uuid.UUID
		payload map[string]any
		canOpen bool
		want    *Link
	}{
		{"applications group", domain.TypeApplicationReceived, 3, &participation, nil, true, &Link{Kind: "vacancy_candidates", JobID: j}},
		{"single application", domain.TypeApplicationReceived, 1, &participation, nil, true, &Link{Kind: "participation", JobID: j, ParticipationID: p}},
		{"psychometric group", domain.TypePsychometricCompleted, 2, &participation, nil, true, &Link{Kind: "vacancy_candidates", JobID: j}},
		{"single psychometric", domain.TypePsychometricCompleted, 1, &participation, nil, true, &Link{Kind: "participation", JobID: j, ParticipationID: p}},
		{"pending group", domain.TypePsychometricPending, 2, &participation, nil, true, &Link{Kind: "vacancy_candidates", JobID: j}},
		{"single pending", domain.TypePsychometricPending, 1, &participation, nil, true, &Link{Kind: "participation", JobID: j, ParticipationID: p}},
		{"assigned", domain.TypeVacancyAssigned, 1, nil, nil, false, &Link{Kind: "vacancy", JobID: j}},
		{"reassigned", domain.TypeVacancyReassigned, 1, nil, nil, true, &Link{Kind: "vacancy", JobID: j}},
		{"team added", domain.TypeVacancyTeamAdded, 1, nil, nil, true, &Link{Kind: "vacancy", JobID: j}},
		{"unassigned with access", domain.TypeVacancyUnassigned, 1, nil, nil, true, &Link{Kind: "vacancy", JobID: j}},
		{"unassigned without access", domain.TypeVacancyUnassigned, 1, nil, nil, false, nil},
		{"delivery", domain.TypeDeliveryOverdue, 1, nil, nil, true, &Link{Kind: "vacancy_delivery", JobID: j}},
		{"delivery soon", domain.TypeDeliveryDueSoon, 1, nil, nil, true, &Link{Kind: "vacancy_delivery", JobID: j}},
		{"assignment deadline", domain.TypeAssignmentDeadlineOverdue, 1, nil, nil, true, &Link{Kind: "vacancy_delivery", JobID: j}},
		{"assignment deadline soon", domain.TypeAssignmentDeadlineDueSoon, 1, nil, nil, true, &Link{Kind: "vacancy_delivery", JobID: j}},
		{"candidate status", domain.TypeCandidateStatusChanged, 1, &participation, nil, false, &Link{Kind: "application", JobID: j, ParticipationID: p}},
		{"candidate message", domain.TypeCandidateMessageReceived, 1, &participation, nil, false, &Link{Kind: "application", JobID: j, ParticipationID: p}},
		{"candidate test", domain.TypeCandidateTestPending, 1, &participation, map[string]any{"invitation_id": invitation.String()}, false, &Link{Kind: "assessment", InvitationID: invitation.String()}},
	}
	for _, tc := range cases {
		got := linkFor(tc.typ, job, tc.count, tc.part, tc.payload, tc.canOpen)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: link = %+v, want %+v", tc.name, got, tc.want)
		}
	}
}
