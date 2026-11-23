package documents

import "github.com/google/uuid"

// Target is where a document lives (D1): a vacancy (the draft id) or one participation of that vacancy's process. Both scopes
// share every endpoint shape; only the prefix and the rule that `pid` belongs to `{id}` differ (D3, D5).
type Target struct {
	DraftID uuid.UUID
	// ParticipationID is nil for the vacancy scope.
	ParticipationID *uuid.UUID
}

// VacancyTarget is the vacancy scope of draftID: `V/documents`.
func VacancyTarget(draftID uuid.UUID) Target { return Target{DraftID: draftID} }

// ParticipationTarget is the scope of one participation of draftID's process: `V/participations/{pid}/documents`.
func ParticipationTarget(draftID, participationID uuid.UUID) Target {
	return Target{DraftID: draftID, ParticipationID: &participationID}
}

// Kind tells which of the two scopes the target is.
func (t Target) Kind() ScopeKind {
	if t.ParticipationID != nil {
		return ScopeParticipation
	}
	return ScopeVacancy
}
