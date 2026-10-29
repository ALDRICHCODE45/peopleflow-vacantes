package postgres

import (
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/scoring"
	"github.com/google/uuid"
)

// Wire DTOs deliberately do not embed complete scoring snapshots: those retain
// backend rendering metadata that the strict employer contract does not expose.
type resultInterpretation struct {
	ID              string `json:"id"`
	CompetencyID    string `json:"competency_id"`
	Band            string `json:"band"`
	IntroText       string `json:"intro_text"`
	WorkText        string `json:"work_text"`
	StrengthsText   string `json:"strengths_text"`
	DevelopmentText string `json:"development_text"`
	HypothesisText  string `json:"hypothesis_text"`
}
type resultQuestion struct {
	QuestionID           string   `json:"question_id"`
	CompetencyID         string   `json:"competency_id"`
	Text                 string   `json:"text"`
	GoodAnswerChecklist  string   `json:"good_answer_checklist"`
	ObservedBand         string   `json:"observed_band"`
	DesiredBand          *string  `json:"desired_band"`
	Importance           *string  `json:"importance"`
	Fit                  *string  `json:"fit"`
	Selector             string   `json:"selector"`
	OriginatingFocusType *string  `json:"originating_focus_type"`
	SignalIDs            []string `json:"signal_ids"`
}
type comparisonSummary struct {
	ID             uuid.UUID `json:"id"`
	ProfileVersion *string   `json:"profile_version"`
}
type resultComparison struct {
	comparisonSummary
	CreatedAt      time.Time                    `json:"created_at"`
	ContentVersion string                       `json:"content_version"`
	ScoringVersion string                       `json:"scoring_version"`
	Competencies   []scoring.ComparedCompetency `json:"competencies"`
	FocusAreas     []scoring.FocusArea          `json:"focus_areas"`
	Guide          []resultQuestion             `json:"guide"`
}
type employerResult struct {
	InvitationID     uuid.UUID              `json:"invitation_id"`
	ContentVersion   string                 `json:"content_version"`
	ScoringVersion   string                 `json:"scoring_version"`
	FinishedAt       time.Time              `json:"finished_at"`
	Facets           []scoring.Facet        `json:"facets"`
	Competencies     []scoring.Competency   `json:"competencies"`
	Interpretations  []resultInterpretation `json:"interpretations"`
	Quality          scoring.Quality        `json:"quality"`
	LatestComparison resultComparison       `json:"latest_comparison"`
	Comparisons      []comparisonSummary    `json:"comparisons"`
}

func comparisonProjection(id uuid.UUID, at time.Time, c scoring.Comparison) resultComparison {
	guide := make([]resultQuestion, 0, len(c.Guide))
	for _, q := range c.Guide {
		guide = append(guide, resultQuestion{q.QuestionID, q.CompetencyID, q.Text, q.GoodAnswerChecklist, q.ObservedBand, q.DesiredBand, q.Importance, q.Fit, q.Selector, q.OriginatingFocusType, q.SignalIDs})
	}
	return resultComparison{comparisonSummary{id, c.ProfileVersion}, at.UTC(), c.ContentVersion, c.ScoringVersion, c.Competencies, c.FocusAreas, guide}
}
func resultProjection(iid uuid.UUID, at time.Time, r scoring.Result, latest resultComparison, history []comparisonSummary) employerResult {
	interpretations := make([]resultInterpretation, 0, len(r.Interpretations))
	for _, v := range r.Interpretations {
		interpretations = append(interpretations, resultInterpretation{v.ID, v.CompetencyID, v.Band, v.Prepend, v.WorkText, v.StrengthsText, v.DevelopmentText, v.Hypothesis})
	}
	return employerResult{iid, r.ContentVersion, r.ScoringVersion, at.UTC(), r.Facets, r.Competencies, interpretations, r.Quality, latest, history}
}
