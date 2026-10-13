package dtos

import (
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
)

// ErrCandidateScreeningType rejects an unsupported employer question variant.
var ErrCandidateScreeningType = errors.New("dtos: unsupported candidate screening question type")

// CandidateScreeningOption contains only candidate-visible option fields.
type CandidateScreeningOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// CandidateScreeningQuestion deliberately has no embedded employer object,
// answer key, evaluation flag or score. Open questions omit options entirely.
type CandidateScreeningQuestion struct {
	ID      string                     `json:"id"`
	Type    string                     `json:"type"`
	Prompt  string                     `json:"prompt"`
	Options []CandidateScreeningOption `json:"options,omitempty"`
}

// ProjectCandidateScreeningV2 reduces an already validated employer collection.
// Validation and authorization must happen upstream; this function is not a
// decoder or validator. It does not publish drafts or register endpoints.
// It preserves IDs, text and order without mutation or option-slice aliasing.
// Unknown variants reject the whole collection rather than falling back.
// Nil or empty input returns a non-nil empty collection (JSON []), not null.
func ProjectCandidateScreeningV2(questions []draftfields.ScreeningQuestionV2) ([]CandidateScreeningQuestion, error) {
	result := make([]CandidateScreeningQuestion, 0, len(questions))
	for _, question := range questions {
		candidate := CandidateScreeningQuestion{ID: question.ID, Prompt: question.Prompt}
		switch question.Type {
		case "open":
			candidate.Type = "open"
		case "single_choice_informative", "single_choice_evaluated":
			candidate.Type = "single_choice"
			candidate.Options = make([]CandidateScreeningOption, len(question.Options))
			for i, option := range question.Options {
				candidate.Options[i] = CandidateScreeningOption{ID: option.ID, Label: option.Label}
			}
		default:
			return nil, ErrCandidateScreeningType
		}
		result = append(result, candidate)
	}
	return result, nil
}
