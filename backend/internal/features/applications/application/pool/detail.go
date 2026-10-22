package pool

import (
	"context"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

type Creator struct {
	ID   uuid.UUID `json:"id"`
	Name *string   `json:"name"`
}
type CV struct {
	FileName   string    `json:"file_name"`
	UploadedAt time.Time `json:"uploaded_at"`
}
type Discard struct {
	Reason      board.Reason `json:"reason"`
	Comment     *string      `json:"comment"`
	DiscardedAt time.Time    `json:"discarded_at"`
}
type DetailParticipation struct {
	ID uuid.UUID `json:"id"`
	Participation
	Substate *Stage         `json:"substate"`
	Discard  *Discard       `json:"discard"`
	Source   string         `json:"source"`
	AddedBy  *board.AddedBy `json:"added_by"`
	CV       *CV            `json:"cv"`
}
type Detail struct {
	Kind              string                `json:"kind"`
	ID                uuid.UUID             `json:"id"`
	FullName          string                `json:"full_name"`
	ProfessionalTitle *string               `json:"professional_title"`
	CurrentCompany    *string               `json:"current_company"`
	Contact           board.Contact         `json:"contact"`
	Profile           board.Profile         `json:"profile"`
	Participations    []DetailParticipation `json:"participations"`
	CreatedBy         *Creator              `json:"created_by"`
	CreatedAt         time.Time             `json:"created_at"`
	ETag              string                `json:"etag"`
	UpdatedAt         *time.Time            `json:"updated_at"`
	UpdatedBy         *Creator              `json:"updated_by"`
	CorrectedFields   []string              `json:"corrected_fields"`
	Original          *Original             `json:"original"`
	Skills            []string              `json:"skills"`
	LinkedInURL       *string               `json:"linkedin_url"`
	PortfolioURL      *string               `json:"portfolio_url"`
	Education         []Study               `json:"education"`
}

// Original is the uncorrected organic projection. Studies are unavailable in
// frozen snapshots, which contain only the education summary.
type Original struct {
	FullName          string        `json:"full_name"`
	Contact           board.Contact `json:"contact"`
	ProfessionalTitle *string       `json:"professional_title"`
	CurrentCompany    *string       `json:"current_company"`
	Profile           board.Profile `json:"profile"`
	LinkedInURL       *string       `json:"linkedin_url"`
	PortfolioURL      *string       `json:"portfolio_url"`
	Education         []Study       `json:"education"`
}

func (s *Service) Detail(ctx context.Context, company uuid.UUID, kind string, id uuid.UUID) (Detail, error) {
	return s.reader.Detail(ctx, company, kind, id)
}
func (s *Service) File(ctx context.Context, company uuid.UUID, kind string, id, pid uuid.UUID) (board.File, error) {
	return s.reader.File(ctx, company, kind, id, pid)
}

// DetailReader deliberately has no actor/vacancy authorization port.
type DetailReader interface {
	Detail(context.Context, uuid.UUID, string, uuid.UUID) (Detail, error)
	File(context.Context, uuid.UUID, string, uuid.UUID, uuid.UUID) (board.File, error)
}
