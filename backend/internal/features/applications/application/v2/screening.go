package v2

import "github.com/google/uuid"

type Company struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}
type Option struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}
type Question struct {
	ID      string   `json:"id"`
	Prompt  string   `json:"prompt"`
	Type    string   `json:"type"`
	Options []Option `json:"options"`
}
type Screening struct {
	Revision  string     `json:"questionnaire_revision"`
	Questions []Question `json:"questions"`
}

// VacancyRules bridges the published questionnaire and immutable pipeline
// identities at the composition root. No sibling feature internals leak here.
type VacancyRules interface {
	Screening([]byte) (Screening, error)
	InitialStage(uuid.UUID) uuid.UUID
}
