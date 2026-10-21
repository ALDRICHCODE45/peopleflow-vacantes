package board

import (
	"encoding/json"
	intake "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/google/uuid"
	"strings"
	"time"
)

// Profile is a recruiter-only read projection of the immutable code snapshot.
type Profile struct {
	Location          *geo.ReadLocation `json:"location"`
	Skills            []string          `json:"skills"`
	YearsOfExperience *int              `json:"years_of_experience"`
	EducationLevel    *string           `json:"education_level"`
}

type ScreeningAnswer struct {
	QuestionID string `json:"question_id"`
	OptionID   string `json:"option_id"`
}
type ScreeningFilter struct {
	QuestionID string          `json:"question_id"`
	Prompt     string          `json:"prompt"`
	Options    []intake.Option `json:"options"`
}

// ChoiceAnswers projects only identifiers, retaining the stored answers' order.
// Question types come from the frozen safe questions, never the live questionnaire.
func ChoiceAnswers(questions []intake.Question, answers []intake.Answer) []ScreeningAnswer {
	choices := map[string]bool{}
	for _, q := range questions {
		choices[strings.ToLower(q.ID)] = q.Type == "single_choice"
	}
	out := []ScreeningAnswer{}
	for _, a := range answers {
		if choices[strings.ToLower(a.QuestionID)] {
			out = append(out, ScreeningAnswer{QuestionID: a.QuestionID, OptionID: a.OptionID})
		}
	}
	return out
}

// MarshalJSON keeps mutation responses on their pre-§19 allowlist. Private
// filter data belongs only on board/detail reads, not every item-shaped response.
func (m Moved) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		SubstateID *string   `json:"substate_id"`
		ID         uuid.UUID `json:"id"`
		StageID    string    `json:"stage_id"`
		Version    string    `json:"version"`
		ETag       string    `json:"etag"`
		Candidate  Candidate `json:"candidate"`
		AddedBy    *AddedBy  `json:"added_by"`
		AppliedAt  time.Time `json:"applied_at"`
		Source     string    `json:"source"`
		CV         CV        `json:"cv"`
		MovedAt    time.Time `json:"moved_at"`
		Discard    *Discard  `json:"discard"`
		Coverage   Coverage  `json:"coverage"`
		Delivery   Delivery  `json:"delivery"`
	}{SubstateID: m.SubstateID, ID: m.ID, StageID: m.StageID, Version: m.Version, ETag: m.ETag, Candidate: m.Candidate, AddedBy: m.AddedBy, AppliedAt: m.AppliedAt, Source: m.Source, CV: m.CV, MovedAt: m.MovedAt, Discard: m.Item.Discard, Coverage: m.Coverage, Delivery: m.Delivery})
}

func ChoiceFilters(form intake.Screening) []ScreeningFilter {
	out := []ScreeningFilter{}
	for _, q := range form.Questions {
		if q.Type == "single_choice" {
			out = append(out, ScreeningFilter{QuestionID: q.ID, Prompt: q.Prompt, Options: append([]intake.Option{}, q.Options...)})
		}
	}
	return out
}
