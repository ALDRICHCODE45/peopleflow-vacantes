package vacancyteam

import (
	"context"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// OffboardStore owns vacancy handovers and the membership deletion in one tx.
type OffboardStore interface {
	PreviewOffboard(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error)
	RemoveCompanyMember(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
	OffboardCompanyMember(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (drafts.Result, error)
}
type OffboardTeamMember struct {
	UserID   uuid.UUID `json:"user_id"`
	Name     string    `json:"name"`
	Function string    `json:"function"`
}
type OffboardVacancy struct {
	DraftID   uuid.UUID            `json:"draft_id"`
	Title     string               `json:"title"`
	Lifecycle string               `json:"lifecycle"`
	HandOver  string               `json:"hand_over"`
	Team      []OffboardTeamMember `json:"team"`
}
type OffboardPreview struct {
	User struct {
		ID       uuid.UUID `json:"id"`
		FullName string    `json:"full_name"`
	} `json:"user"`
	Vacancies   []OffboardVacancy `json:"vacancies"`
	OtherTramos int               `json:"other_tramos"`
}
type OffboardVacanciesError struct {
	Code      string
	Vacancies []OffboardVacancy
}

func (e *OffboardVacanciesError) Error() string { return e.Code }

const ErrResponsibleRequired RuleError = "responsible_required"
