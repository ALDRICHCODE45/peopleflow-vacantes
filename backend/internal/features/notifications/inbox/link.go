package inbox

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

// Link is the navigation descriptor of an item (§Endpoints link.kind per
// type); the frontend maps kinds to paths.
type Link struct {
	Kind            string `json:"kind"`
	JobID           string `json:"job_id,omitempty"`
	ParticipationID string `json:"participation_id,omitempty"`
	InvitationID    string `json:"invitation_id,omitempty"`
}

// LinkFor derives the link of a group from its type. Grouped types point to
// the vacancy candidates, or to the participation for a single-member group
// (psychometric_pending is grouped since Q3 and follows the same rule);
// vacancy_unassigned has no link once the caller can no longer open the
// vacancy (D19). The inbox and the email sender (notifications-v2 §Content)
// share this one rule.
func LinkFor(t domain.Type, job uuid.UUID, count int, participation *uuid.UUID, payload map[string]any, canOpen bool) *Link {
	j := job.String()
	switch t {
	case domain.TypeApplicationReceived, domain.TypePsychometricCompleted, domain.TypePsychometricPending:
		if count == 1 && participation != nil {
			return &Link{Kind: "participation", JobID: j, ParticipationID: participation.String()}
		}
		return &Link{Kind: "vacancy_candidates", JobID: j}
	case domain.TypeVacancyUnassigned:
		if !canOpen {
			return nil
		}
		return &Link{Kind: "vacancy", JobID: j}
	case domain.TypeVacancyAssigned, domain.TypeVacancyReassigned, domain.TypeVacancyTeamAdded:
		return &Link{Kind: "vacancy", JobID: j}
	case domain.TypeDeliveryDueSoon, domain.TypeDeliveryOverdue, domain.TypeAssignmentDeadlineDueSoon, domain.TypeAssignmentDeadlineOverdue:
		return &Link{Kind: "vacancy_delivery", JobID: j}
	case domain.TypeCandidateStatusChanged, domain.TypeCandidateMessageReceived:
		if participation == nil {
			return nil
		}
		return &Link{Kind: "application", JobID: j, ParticipationID: participation.String()}
	case domain.TypeCandidateTestPending:
		invitation, _ := payload["invitation_id"].(string)
		if _, err := uuid.Parse(invitation); err != nil {
			return nil
		}
		return &Link{Kind: "assessment", InvitationID: invitation}
	}
	return nil
}
