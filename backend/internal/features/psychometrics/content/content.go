// Package content owns the version-pinned, backend-only psychometric catalog.
// It has no HTTP, database, or scoring dependencies. Never serialize a Snapshot
// to a candidate: it includes scoring keys and attention answers.
package content

const (
	Version        = "psychometrics.content.v1"
	ScoringVersion = "psychometrics.scoring.v1"
)

// Document is a detached editable copy, not the immutable loaded artifact.
// Catalog slices preserve documentation order; Facets preserve link order.
type Document struct {
	ContentVersion         string           `json:"content_version"`
	ScoringVersion         string           `json:"scoring_version"`
	Test                   string           `json:"test"`
	Instruction            string           `json:"instruction"`
	Attribution            string           `json:"attribution"`
	Scale                  []Option         `json:"scale"`
	Facets                 []Facet          `json:"facets"`
	Items                  []Item           `json:"items"`
	Attention              []AttentionItem  `json:"attention"`
	Order                  []Position       `json:"order"`
	Bands                  []Band           `json:"bands"`
	Competencies           []Competency     `json:"competencies"`
	InterpretationPrepend  string           `json:"interpretation_prepend"`
	Hypothesis             string           `json:"hypothesis"`
	InterpretationHeadings []string         `json:"interpretation_headings"`
	Library                []Interpretation `json:"library"`
	InterviewIntroduction  string           `json:"interview_introduction"`
	InterviewerInstruction string           `json:"interviewer_instruction"`
	STAR                   string           `json:"star"`
	Questions              []Question       `json:"questions"`
	Selection              SelectionRules   `json:"selection"`
	Quality                QualityRules     `json:"quality"`
	Notice                 Notice           `json:"notice"`
}

type Option struct {
	Value int    `json:"value"`
	Label string `json:"label"`
}

type Facet struct {
	ID        string   `json:"id"`
	Label     string   `json:"label"`
	BandTexts []string `json:"band_texts"`
}

type Item struct {
	ID      string `json:"id"`
	Number  int    `json:"number"`
	FacetID string `json:"facet_id"`
	Key     string `json:"key"`
	Text    string `json:"text"`
}

type AttentionItem struct {
	ID       string `json:"id"`
	Text     string `json:"text"`
	Expected int    `json:"expected"`
	Position int    `json:"position"`
}

type Position struct {
	Position int    `json:"position"`
	ID       string `json:"id"`
}

type Band struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Min         int    `json:"min"`
	Max         int    `json:"max"`
	Explanation string `json:"explanation"`
}

type FacetLink struct {
	ID        string `json:"id"`
	Direction string `json:"direction"`
}

type Competency struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Definition string      `json:"definition"`
	Facets     []FacetLink `json:"facets"`
	Rationale  string      `json:"rationale"`
}

type Interpretation struct {
	ID              string `json:"id"`
	CompetencyID    string `json:"competency_id"`
	Band            string `json:"band"`
	WorkText        string `json:"work_text"`
	StrengthsText   string `json:"strengths_text"`
	DevelopmentText string `json:"development_text"`
}

type Question struct {
	ID                  string `json:"id"`
	CompetencyID        string `json:"competency_id"`
	Selector            string `json:"selector"`
	Text                string `json:"text"`
	GoodAnswerChecklist string `json:"good_answer_checklist"`
}

type SelectionRules struct {
	MaxQuestions        int      `json:"max_questions"`
	BlockSlots          int      `json:"block_slots"`
	OrdinaryWithQuality int      `json:"ordinary_with_quality"`
	QuestionsPerBlock   int      `json:"questions_per_block"`
	ImportanceOrder     []string `json:"importance_order"`
	FocusOrder          []string `json:"focus_order"`
	QualityFallback     string   `json:"quality_fallback"`
	Rules               string   `json:"rules"`
}

type Signal struct {
	ID                     string `json:"id"`
	Calculation            string `json:"calculation"`
	Mild                   string `json:"mild"`
	Strong                 string `json:"strong"`
	MildMin                int    `json:"mild_min"`
	StrongMin              *int   `json:"strong_min"`
	Denominator            int    `json:"denominator"`
	FastBelowMS            int    `json:"fast_below_ms"`
	RequiresCompleteTiming bool   `json:"requires_complete_timing"`
	AlwaysKnownV1          bool   `json:"always_known_v1"`
}

type Tier struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Rule  string `json:"rule"`
}

type Message struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type QualityRules struct {
	Signals           []Signal  `json:"signals"`
	Tiers             []Tier    `json:"tiers"`
	RelevantMildMin   int       `json:"relevant_mild_min"`
	RelevantStrongMin int       `json:"relevant_strong_min"`
	SomeMildCount     int       `json:"some_mild_count"`
	Semantics         string    `json:"semantics"`
	Messages          []Message `json:"messages"`
}

type Notice struct {
	Version string `json:"version"`
	Text    string `json:"text"`
	SHA256  string `json:"sha256"`
}
