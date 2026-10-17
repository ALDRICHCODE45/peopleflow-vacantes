package publicjobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/google/uuid"
)

type ScreeningQuestion struct {
	ID      string                          `json:"id"`
	Prompt  string                          `json:"prompt"`
	Type    string                          `json:"type"`
	Options []dtos.CandidateScreeningOption `json:"options"`
}
type ScreeningLimits struct {
	OpenAnswerMaxLength int `json:"open_answer_max_length"`
}
type Screening struct {
	Revision  string              `json:"questionnaire_revision"`
	Questions []ScreeningQuestion `json:"questions"`
	Limits    ScreeningLimits     `json:"limits"`
}
type ScreeningReader interface {
	Screening(context.Context, uuid.UUID) (Screening, error)
}

func (c *Catalog) Screening(ctx context.Context, id uuid.UUID) (Screening, error) {
	reader, ok := c.reader.(ScreeningReader)
	if !ok {
		return Screening{}, ErrNotFound
	}
	return reader.Screening(ctx, id)
}

// BuildScreening validates persisted content then uses the existing safe
// projector. Hash ONLY safe questions: hashing answer keys would permit a
// candidate to brute-force their small option space from the public revision.
func BuildScreening(stored []byte) (Screening, error) {
	if err := draftinput.ValidatePersistedDraftV2(stored); err != nil {
		return Screening{}, err
	}
	value, err := draftjson.Decode(stored)
	if err != nil {
		return Screening{}, err
	}
	fields := value.(map[string]any)["fields"].(map[string]any)
	questions, err := draftfields.ValidateScreeningQuestionsV2(fields["screening_questions"])
	if err != nil {
		return Screening{}, err
	}
	safe, err := dtos.ProjectCandidateScreeningV2(questions)
	if err != nil {
		return Screening{}, err
	}
	out := Screening{Questions: make([]ScreeningQuestion, len(safe)), Limits: ScreeningLimits{2000}}
	for i, q := range safe {
		out.Questions[i] = ScreeningQuestion{q.ID, q.Prompt, q.Type, q.Options}
	}
	canonical, err := json.Marshal(out.Questions)
	if err != nil {
		return Screening{}, err
	}
	sum := sha256.Sum256(canonical)
	out.Revision = hex.EncodeToString(sum[:])
	return out, nil
}
