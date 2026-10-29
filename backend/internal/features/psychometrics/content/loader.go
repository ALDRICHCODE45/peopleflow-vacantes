package content

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"
)

//go:embed content.v1.json
var embeddedV1 string

// Artifact holds only a private JSON string. Neither decoding caller-owned bytes
// nor editing a Snapshot can mutate it, including nested slices and pointers.
// The zero value is not a loaded artifact.
type Artifact struct{ encoded string }

// Load validates the pinned embedded version; it never substitutes a latest version.
func Load(version string) (*Artifact, error) {
	if version != Version {
		return nil, fmt.Errorf("psychometrics content: unknown content_version %q", version)
	}
	return Decode([]byte(embeddedV1))
}

// Decode validates a serialized artifact and takes an independent immutable copy.
// It accepts only this package's supported content/scoring pair.
func Decode(raw []byte) (*Artifact, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var d Document
	if err := decoder.Decode(&d); err != nil {
		return nil, fmt.Errorf("psychometrics content: decode: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("psychometrics content: trailing JSON")
	}
	if err := validate(d); err != nil {
		return nil, fmt.Errorf("psychometrics content: %w", err)
	}
	encoded, err := json.Marshal(d)
	if err != nil {
		return nil, fmt.Errorf("psychometrics content: encode: %w", err)
	}
	return &Artifact{encoded: string(encoded)}, nil
}

// Snapshot returns a deep detached copy of the backend-only catalog, not a wire DTO.
func (a *Artifact) Snapshot() Document {
	var d Document
	// encoded was produced by json.Marshal after validation and is never exposed.
	_ = json.Unmarshal([]byte(a.encoded), &d)
	return d
}

func validate(d Document) error {
	if d.ContentVersion != Version {
		return fmt.Errorf("content_version: unsupported %q", d.ContentVersion)
	}
	if d.ScoringVersion != ScoringVersion {
		return fmt.Errorf("scoring_version: unsupported %q", d.ScoringVersion)
	}
	if d.Test != "ipip60-mx" {
		return fmt.Errorf("test: unsupported %q", d.Test)
	}
	if len(d.Items) != 60 {
		return fmt.Errorf("items: want 60, got %d", len(d.Items))
	}
	if len(d.Facets) != 15 {
		return fmt.Errorf("facets: want 15, got %d", len(d.Facets))
	}
	if len(d.Attention) != 3 {
		return fmt.Errorf("attention: want 3, got %d", len(d.Attention))
	}
	if len(d.Order) != 63 {
		return fmt.Errorf("order: want 63, got %d", len(d.Order))
	}
	if len(d.Competencies) != 7 {
		return fmt.Errorf("competencies: want 7, got %d", len(d.Competencies))
	}
	if len(d.Library) != 21 {
		return fmt.Errorf("library: want 21, got %d", len(d.Library))
	}
	if len(d.Questions) != 84 {
		return fmt.Errorf("questions: want 84, got %d", len(d.Questions))
	}
	ids := map[string]bool{}
	unique := func(id string) error {
		if id == "" || ids[id] {
			return fmt.Errorf("id %q: empty or duplicate", id)
		}
		ids[id] = true
		return nil
	}
	facets := map[string]int{}
	for _, f := range d.Facets {
		if err := unique(f.ID); err != nil {
			return err
		}
		if !strings.HasPrefix(f.ID, "facet.") || f.Label == "" || len(f.BandTexts) != 3 || slices.Contains(f.BandTexts, "") {
			return fmt.Errorf("%s: facet label/band text", f.ID)
		}
		facets[f.ID] = 0
	}
	numbers := map[int]bool{}
	prompts := map[string]bool{}
	for _, item := range d.Items {
		if err := unique(item.ID); err != nil {
			return err
		}
		if item.Number < 1 || item.Number > 120 || numbers[item.Number] {
			return fmt.Errorf("%s: number %d invalid/duplicate", item.ID, item.Number)
		}
		numbers[item.Number] = true
		if item.ID != "item.ipip."+strconv.Itoa(item.Number) {
			return fmt.Errorf("%s: number does not match id", item.ID)
		}
		if _, ok := facets[item.FacetID]; !ok {
			return fmt.Errorf("%s: unknown facet %s", item.ID, item.FacetID)
		}
		facets[item.FacetID]++
		if item.Key != "+" && item.Key != "-" {
			return fmt.Errorf("%s: key must be + or -", item.ID)
		}
		if strings.TrimSpace(item.Text) == "" {
			return fmt.Errorf("%s: empty text", item.ID)
		}
		prompts[item.ID] = true
	}
	for _, f := range d.Facets {
		if facets[f.ID] != 4 {
			return fmt.Errorf("%s: want 4 items, got %d", f.ID, facets[f.ID])
		}
	}
	for i, a := range d.Attention {
		if err := unique(a.ID); err != nil {
			return err
		}
		if a.ID != fmt.Sprintf("attention.%d", i+1) || a.Position != (i+1)*16 || a.Expected != []int{2, 5, 3}[i] || a.Text == "" {
			return fmt.Errorf("%s: attention position/expected/text invalid", a.ID)
		}
		prompts[a.ID] = true
	}
	seenPrompts := map[string]bool{}
	lastNumber := 0
	for i, p := range d.Order {
		if p.Position != i+1 {
			return fmt.Errorf("order: position %d at index %d invalid/duplicate", p.Position, i)
		}
		if !prompts[p.ID] || seenPrompts[p.ID] {
			return fmt.Errorf("order: %s unknown or duplicate", p.ID)
		}
		seenPrompts[p.ID] = true
		if p.Position == 16 || p.Position == 32 || p.Position == 48 {
			want := fmt.Sprintf("attention.%d", p.Position/16)
			if p.ID != want {
				return fmt.Errorf("order: %s must occupy position %d", want, p.Position)
			}
		} else {
			n, err := strconv.Atoi(strings.TrimPrefix(p.ID, "item.ipip."))
			if err != nil || n <= lastNumber {
				return fmt.Errorf("order: %s must follow ascending personality numbers", p.ID)
			}
			lastNumber = n
		}
	}
	compIDs := map[string]bool{}
	linked := map[string]bool{}
	for _, c := range d.Competencies {
		if err := unique(c.ID); err != nil {
			return err
		}
		if !slices.Contains([]string{"comp.organizacion", "comp.compromisos", "comp.coordinacion", "comp.colaboracion", "comp.exploracion", "comp.deliberacion", "comp.presion"}, c.ID) {
			return fmt.Errorf("competencies: unknown %s", c.ID)
		}
		compIDs[c.ID] = true
		count := 2
		if c.ID == "comp.presion" {
			count = 3
		}
		if len(c.Facets) != count || c.Name == "" || c.Definition == "" || c.Rationale == "" {
			return fmt.Errorf("%s: facet count or required text", c.ID)
		}
		for i, f := range c.Facets {
			if _, ok := facets[f.ID]; !ok {
				return fmt.Errorf("%s: unknown facet %s", c.ID, f.ID)
			}
			if linked[f.ID] {
				return fmt.Errorf("%s: duplicate facet %s", c.ID, f.ID)
			}
			linked[f.ID] = true
			if f.Direction != "positive" && f.Direction != "negative" {
				return fmt.Errorf("%s: direction for %s invalid", c.ID, f.ID)
			}
			if c.ID == "comp.presion" && (f.ID != []string{"facet.n1", "facet.n2", "facet.n6"}[i] || f.Direction != "negative") {
				return fmt.Errorf("comp.presion: require facet.n1/n2/n6 in order, all negative")
			}
		}
	}
	if len(linked) != 15 {
		return fmt.Errorf("competencies: all 15 facets must be linked")
	}
	bandIDs := []string{"band.low", "band.medium", "band.high"}
	if len(d.Bands) != 3 {
		return fmt.Errorf("bands: want 3")
	}
	for i, b := range d.Bands {
		if err := unique(b.ID); err != nil {
			return err
		}
		if b.ID != bandIDs[i] || b.Min != []int{4, 10, 15}[i] || b.Max != []int{9, 14, 20}[i] || b.Label == "" || b.Explanation == "" {
			return fmt.Errorf("bands: %s invalid boundaries/text", b.ID)
		}
	}
	libraryPairs := map[string]bool{}
	for _, entry := range d.Library {
		if err := unique(entry.ID); err != nil {
			return err
		}
		pair := entry.CompetencyID + "/" + entry.Band
		if !compIDs[entry.CompetencyID] || !slices.Contains(bandIDs, entry.Band) || libraryPairs[pair] {
			return fmt.Errorf("%s: competency/band missing or duplicate", entry.ID)
		}
		libraryPairs[pair] = true
		want := "lib." + strings.TrimPrefix(entry.CompetencyID, "comp.") + "." + strings.TrimPrefix(entry.Band, "band.")
		if entry.ID != want || entry.WorkText == "" || entry.StrengthsText == "" || entry.DevelopmentText == "" {
			return fmt.Errorf("%s: library id/text invalid", entry.ID)
		}
	}
	questionCounts := map[string]int{}
	questionOrdinals := map[string]bool{}
	for _, q := range d.Questions {
		if err := unique(q.ID); err != nil {
			return err
		}
		if !compIDs[q.CompetencyID] {
			return fmt.Errorf("%s: unknown competency %s", q.ID, q.CompetencyID)
		}
		if !slices.Contains([]string{"low", "medium", "high", "adjacent", "distant", "quality"}, q.Selector) {
			return fmt.Errorf("%s: invalid selector %s", q.ID, q.Selector)
		}
		prefix := "q." + strings.TrimPrefix(q.CompetencyID, "comp.") + "." + q.Selector + "."
		ordinal := strings.TrimPrefix(q.ID, prefix)
		if (ordinal != "1" && ordinal != "2") || questionOrdinals[q.ID] || q.Text == "" || q.GoodAnswerChecklist == "" {
			return fmt.Errorf("%s: question id/text/checklist invalid", q.ID)
		}
		questionOrdinals[q.ID] = true
		questionCounts[q.CompetencyID+"/"+q.Selector]++
	}
	for c := range compIDs {
		for _, s := range []string{"low", "medium", "high", "adjacent", "distant", "quality"} {
			if questionCounts[c+"/"+s] != 2 {
				return fmt.Errorf("%s: selector %s requires two questions", c, s)
			}
		}
	}
	if len(d.Scale) != 5 {
		return fmt.Errorf("scale: want 5")
	}
	for i, o := range d.Scale {
		if o.Value != i+1 || o.Label == "" {
			return fmt.Errorf("scale: invalid value/label at %d", i)
		}
	}
	if d.Instruction == "" || d.Attribution == "" || d.InterpretationPrepend == "" || d.Hypothesis == "" || len(d.InterpretationHeadings) != 3 || slices.Contains(d.InterpretationHeadings, "") || d.STAR == "" || d.InterviewIntroduction == "" || d.InterviewerInstruction == "" {
		return fmt.Errorf("rendering: required instruction/attribution/interpretation/STAR text missing")
	}
	if err := validateRules(d); err != nil {
		return err
	}
	if d.Notice.Version != "1" || d.Notice.Text == "" || strings.Contains(d.Notice.Text, "\r") {
		return fmt.Errorf("notice: invalid version/text")
	}
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(d.Notice.Text)))
	if d.Notice.SHA256 != digest {
		return fmt.Errorf("notice.sha256: mismatch")
	}
	return nil
}

func validateRules(d Document) error {
	s := d.Selection
	if s.MaxQuestions != 8 || s.BlockSlots != 4 || s.OrdinaryWithQuality != 3 || s.QuestionsPerBlock != 2 || !slices.Equal(s.ImportanceOrder, []string{"Clave", "Importante", "null"}) || !slices.Equal(s.FocusOrder, []string{"distant", "adjacent", "none"}) || s.QualityFallback != "comp.organizacion" || s.Rules == "" {
		return fmt.Errorf("selection: invalid v1 block rules")
	}
	q := d.Quality
	if len(q.Signals) != 4 || len(q.Tiers) != 3 || q.RelevantMildMin != 2 || q.RelevantStrongMin != 1 || q.SomeMildCount != 1 || q.Semantics == "" || len(q.Messages) != 7 {
		return fmt.Errorf("quality: invalid signal/tier definitions")
	}
	for i, sig := range q.Signals {
		strong := []int{2, 12, 30, 0}[i]
		if sig.ID != []string{"signal.attention", "signal.long_string", "signal.fast", "signal.changes"}[i] || sig.MildMin != []int{1, 7, 12, 30}[i] || sig.Denominator != []int{3, 0, 60, 60}[i] || sig.FastBelowMS != []int{0, 0, 2000, 0}[i] || sig.RequiresCompleteTiming != (i == 2) || sig.AlwaysKnownV1 != (i == 3) || sig.Calculation == "" || sig.Mild == "" || sig.Strong == "" {
			return fmt.Errorf("quality: %s invalid thresholds/semantics", sig.ID)
		}
		if (strong == 0 && sig.StrongMin != nil) || (strong != 0 && (sig.StrongMin == nil || *sig.StrongMin != strong)) {
			return fmt.Errorf("quality: %s invalid strong threshold", sig.ID)
		}
	}
	tierIDs := []string{"tier.relevantes", "tier.algunas", "tier.sin"}
	for i, tier := range q.Tiers {
		if tier.ID != tierIDs[i] || tier.Label == "" || tier.Rule == "" {
			return fmt.Errorf("quality: %s invalid tier", tier.ID)
		}
	}
	messageIDs := []string{"tier.sin", "tier.algunas", "tier.relevantes", "signal.attention", "signal.long_string", "signal.fast", "signal.changes"}
	for i, m := range q.Messages {
		if m.ID != messageIDs[i] || m.Text == "" {
			return fmt.Errorf("quality: %s invalid message", m.ID)
		}
	}
	return nil
}
