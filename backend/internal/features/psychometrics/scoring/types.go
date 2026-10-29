// Package scoring computes deterministic backend-only psychometric snapshots.
// It performs no persistence, clock reads, network calls or candidate projection.
package scoring

// Input holds final answers and the already ordered, accepted, deduplicated server
// writes. EventsIncomplete is reserved for imports without a complete server stream;
// normal v1 callers leave it false. Nil Profile means no confirmed profile.
type Input struct {
	Answers          map[int]int
	Events           []AnswerEvent
	EventsIncomplete bool
	Profile          *Profile
}

// AnswerEvent is a PUT when Value is nonnil and a DELETE otherwise. ElapsedMS is
// the cumulative visible time on that PUT, not a delta. A missing/invalid latest
// duration is unavailable, never inferred from previous writes or receipt times.
// UUID deduplication and ordering belong to the accepting writer, not scoring.
type AnswerEvent struct {
	Position  int
	Value     *int
	ElapsedMS *int64
}

// Profile is a confirmed scoring projection, not a profile-write DTO. The caller
// validates confirmation/rationale/task; scoring validates all seven requirements.
type Profile struct {
	Version      string        `json:"profile_version"`
	Competencies []Requirement `json:"competencies"`
}

type Requirement struct {
	CompetencyID string  `json:"competency_id"`
	Importance   string  `json:"importance"`
	DesiredBand  *string `json:"desired_band"`
}

// Result omits persistence-owned invitation ids, timestamps and comparison history.
type Result struct {
	ContentVersion  string           `json:"content_version"`
	ScoringVersion  string           `json:"scoring_version"`
	Facets          []Facet          `json:"facets"`
	Competencies    []Competency     `json:"competencies"`
	Interpretations []Interpretation `json:"interpretations"`
	Quality         Quality          `json:"quality"`
	Comparison      Comparison       `json:"latest_comparison"`
}

type Facet struct {
	FacetID string `json:"facet_id"`
	Sum     int    `json:"sum"`
	Band    string `json:"band"`
}

type Competency struct {
	CompetencyID string   `json:"competency_id"`
	FacetIDs     []string `json:"facet_ids"`
	OrientedSums []int    `json:"oriented_sums"`
	OrientedSum  int      `json:"oriented_sum"`
	FacetCount   int      `json:"facet_count"`
	Index        string   `json:"index"`
	Band         string   `json:"band"`
}

// The three bank sections remain byte-for-byte snapshots; the separate required
// framing fields must be rendered before/after those sections, respectively.
type Interpretation struct {
	ID              string   `json:"id"`
	CompetencyID    string   `json:"competency_id"`
	Band            string   `json:"band"`
	Prepend         string   `json:"prepend"`
	Headings        []string `json:"headings"`
	WorkText        string   `json:"work_text"`
	StrengthsText   string   `json:"strengths_text"`
	DevelopmentText string   `json:"development_text"`
	Hypothesis      string   `json:"hypothesis"`
}

type Quality struct {
	Tier    string   `json:"tier"`
	Partial bool     `json:"partial"`
	Signals []Signal `json:"signals"`
}

// Counts is one of the four count structs below, or nil for unknown telemetry.
// Counts is never a map, keeping stable JSON field ordering.
type Signal struct {
	ID       string `json:"id"`
	Severity string `json:"severity"`
	Counts   any    `json:"counts"`
}

type AttentionCounts struct {
	Misses int `json:"misses"`
	Total  int `json:"total"`
}
type LongStringCounts struct {
	Run int `json:"run"`
}
type FastCounts struct {
	FastCount int `json:"fast_count"`
	Total     int `json:"total"`
}
type ChangeCounts struct {
	ValueChanges int `json:"value_changes"`
	Clears       int `json:"clears"`
	Reanswers    int `json:"reanswers"`
	Total        int `json:"total"`
}

type Comparison struct {
	ProfileVersion *string              `json:"profile_version"`
	ContentVersion string               `json:"content_version"`
	ScoringVersion string               `json:"scoring_version"`
	Competencies   []ComparedCompetency `json:"competencies"`
	FocusAreas     []FocusArea          `json:"focus_areas"`
	Guide          []GuideQuestion      `json:"guide"`
	QuestionIDs    []string             `json:"question_ids"`
}

type ComparedCompetency struct {
	Competency
	DesiredBand *string `json:"desired_band"`
	Importance  *string `json:"importance"`
	Direction   *string `json:"direction"`
	Fit         *string `json:"fit"`
}

// FocusArea is a tagged union: gap fields are present only for adjacent/distant;
// tier/signal_ids/routed_competency_id only for quality. CompetencyID is explicitly
// null for quality, not the routing context.
type FocusArea struct {
	Type               string   `json:"type"`
	CompetencyID       *string  `json:"competency_id"`
	ObservedBand       string   `json:"observed_band,omitempty"`
	DesiredBand        *string  `json:"desired_band,omitempty"`
	Importance         *string  `json:"importance,omitempty"`
	Fit                *string  `json:"fit,omitempty"`
	ProfileVersion     *string  `json:"profile_version,omitempty"`
	Tier               string   `json:"tier,omitempty"`
	SignalIDs          []string `json:"signal_ids,omitempty"`
	RoutedCompetencyID string   `json:"routed_competency_id,omitempty"`
}

type GuideQuestion struct {
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
	Tier                 string   `json:"tier,omitempty"`
	ContextLabel         string   `json:"context_label,omitempty"`
}

// IncompleteError is suitable for the later finish adapter's missing_positions.
type IncompleteError struct {
	MissingPositions []int `json:"missing_positions"`
}

func (e *IncompleteError) Error() string { return "psychometrics scoring: incomplete answers" }
