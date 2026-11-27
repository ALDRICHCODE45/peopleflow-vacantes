package email

import (
	"errors"

	"github.com/google/uuid"
)

// LinkKind is the inbox link descriptor kind (inbox/link.go, v1 §Endpoints).
type LinkKind string

const (
	LinkVacancy           LinkKind = "vacancy"
	LinkVacancyCandidates LinkKind = "vacancy_candidates"
	LinkParticipation     LinkKind = "participation"
	LinkVacancyDelivery   LinkKind = "vacancy_delivery"
	LinkApplication       LinkKind = "application"
	LinkAssessment        LinkKind = "assessment"
)

// Link is the descriptor of the delivery's group, derived by the caller with
// the inbox rule (count = 1 with a participation → participation, else
// vacancy_candidates; vacancy_unassigned / candidate items may have none).
type Link struct {
	Kind            LinkKind
	JobID           uuid.UUID
	ParticipationID uuid.UUID
	InvitationID    uuid.UUID
}

// Fixed paths of the Q3 path map (§Path map), appended to APP_BASE_URL.
const (
	// PathMemberUnassignedFallback is vacancy_unassigned with a null link (L5).
	PathMemberUnassignedFallback = "/empresa"
	// PathCandidateFallback is a candidate item with a null link (L6).
	PathCandidateFallback    = "/candidato/postulaciones"
	PathMemberPreferences    = "/empresa/configuracion/notificaciones"
	PathCandidatePreferences = "/candidato/configuracion/notificaciones"
	// PathUnsubscribeLanding takes ?token= (the footer link).
	PathUnsubscribeLanding = "/notificaciones/baja"
)

var errLinkIDs = errors.New("email: link without its ids")

// linkPath is the §Path map of a link descriptor. Ids are UUIDs, so the path
// needs no escaping.
func linkPath(l Link) (string, error) {
	switch l.Kind {
	case LinkVacancy, LinkVacancyCandidates:
		if l.JobID == uuid.Nil {
			return "", errLinkIDs
		}
		return "/empresa/vacantes/" + l.JobID.String() + "/pipeline", nil
	case LinkParticipation:
		if l.JobID == uuid.Nil || l.ParticipationID == uuid.Nil {
			return "", errLinkIDs
		}
		return "/empresa/vacantes/" + l.JobID.String() + "/pipeline?candidato=" + l.ParticipationID.String(), nil
	case LinkVacancyDelivery:
		if l.JobID == uuid.Nil {
			return "", errLinkIDs
		}
		return "/empresa/vacantes/" + l.JobID.String() + "/configuracion/entrega", nil
	case LinkApplication:
		if l.ParticipationID == uuid.Nil {
			return "", errLinkIDs
		}
		return "/candidato/postulaciones?postulacion=" + l.ParticipationID.String(), nil
	case LinkAssessment:
		if l.InvitationID == uuid.Nil {
			return "", errLinkIDs
		}
		return "/candidato/evaluaciones/" + l.InvitationID.String(), nil
	}
	return "", errors.New("email: unknown link kind")
}
