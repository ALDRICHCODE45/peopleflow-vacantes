package scoring

import (
	"fmt"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
)

func document(a *content.Artifact) (content.Document, error) {
	if a == nil {
		return content.Document{}, fmt.Errorf("psychometrics scoring: nil artifact")
	}
	d := a.Snapshot()
	if d.ContentVersion != content.Version || d.ScoringVersion != content.ScoringVersion {
		return content.Document{}, fmt.Errorf("psychometrics scoring: unloaded or unsupported artifact")
	}
	return d, nil
}

// MissingPositions returns unanswered or invalid positions in pinned presentation
// order. Invalid extra positions are rejected by Score, not included here.
// An unloaded artifact yields no positions; Score rejects it separately.
func MissingPositions(a *content.Artifact, answers map[int]int) []int {
	missing := []int{}
	if a == nil {
		return missing
	}
	for _, p := range a.Snapshot().Order {
		if v := answers[p.Position]; v < 1 || v > 5 {
			missing = append(missing, p.Position)
		}
	}
	return missing
}

// Score requires every final answer and produces detached snapshots. It never
// modifies inputs or the artifact. Every error returns a zero Result.
func Score(a *content.Artifact, in Input) (Result, error) {
	d, err := document(a)
	if err != nil {
		return Result{}, err
	}
	// Unknown keys take priority; their generic error is independent of map order.
	for p := range in.Answers {
		if p < 1 || p > len(d.Order) {
			return Result{}, fmt.Errorf("psychometrics scoring: answer position outside 1..%d", len(d.Order))
		}
	}
	for _, p := range d.Order {
		if v, exists := in.Answers[p.Position]; exists && (v < 1 || v > 5) {
			return Result{}, fmt.Errorf("psychometrics scoring: answer value outside 1..5")
		}
	}
	if missing := MissingPositions(a, in.Answers); len(missing) > 0 {
		return Result{}, &IncompleteError{MissingPositions: missing}
	}
	requirements, err := validateProfile(d, in.Profile)
	if err != nil {
		return Result{}, err
	}
	for i, e := range in.Events {
		if e.Position < 1 || e.Position > len(d.Order) || e.Value != nil && (*e.Value < 1 || *e.Value > 5) {
			return Result{}, fmt.Errorf("psychometrics scoring: invalid accepted event at index %d", i)
		}
	}
	sums := map[string]int{}
	items := map[string]content.Item{}
	for _, it := range d.Items {
		items[it.ID] = it
	}
	for _, p := range d.Order {
		if it, ok := items[p.ID]; ok {
			v := in.Answers[p.Position]
			if it.Key == "-" {
				v = 6 - v
			}
			sums[it.FacetID] += v
		}
	}
	r := Result{ContentVersion: d.ContentVersion, ScoringVersion: d.ScoringVersion, Facets: []Facet{}, Competencies: []Competency{}, Interpretations: []Interpretation{}}
	for _, f := range d.Facets {
		r.Facets = append(r.Facets, Facet{FacetID: f.ID, Sum: sums[f.ID], Band: band(sums[f.ID], 1)})
	}
	for _, c := range d.Competencies {
		v := Competency{CompetencyID: c.ID, FacetIDs: []string{}, OrientedSums: []int{}, FacetCount: len(c.Facets)}
		for _, f := range c.Facets {
			s := sums[f.ID]
			if f.Direction == "negative" {
				s = 24 - s
			}
			v.FacetIDs = append(v.FacetIDs, f.ID)
			v.OrientedSums = append(v.OrientedSums, s)
			v.OrientedSum += s
		}
		v.Band = band(v.OrientedSum, v.FacetCount)
		// Round positive rational S/n to tenths half-up, using integer arithmetic.
		tenths := (20*v.OrientedSum + v.FacetCount) / (2 * v.FacetCount)
		v.Index = strconv.Itoa(tenths/10) + "." + strconv.Itoa(tenths%10)
		r.Competencies = append(r.Competencies, v)
		found := false
		for _, l := range d.Library {
			if l.CompetencyID == c.ID && l.Band == v.Band {
				found = true
				r.Interpretations = append(r.Interpretations, Interpretation{ID: l.ID, CompetencyID: c.ID, Band: v.Band, Prepend: d.InterpretationPrepend, Headings: append([]string{}, d.InterpretationHeadings...), WorkText: l.WorkText, StrengthsText: l.StrengthsText, DevelopmentText: l.DevelopmentText, Hypothesis: d.Hypothesis})
				break
			}
		}
		if !found {
			return Result{}, fmt.Errorf("psychometrics scoring: missing interpretation for %s/%s", c.ID, v.Band)
		}
	}
	r.Quality = quality(d, in)
	r.Comparison, err = compare(d, r.Competencies, r.Quality, in.Profile, requirements)
	if err != nil {
		return Result{}, err
	}
	return r, nil
}

func band(sum, n int) string {
	if sum < 10*n {
		return "band.low"
	}
	if sum < 15*n {
		return "band.medium"
	}
	return "band.high"
}
func rank(b string) int {
	switch b {
	case "band.low":
		return 0
	case "band.medium":
		return 1
	case "band.high":
		return 2
	}
	return -1
}
func importance(s *string) int {
	if s != nil {
		if *s == "importance.clave" {
			return 0
		}
		if *s == "importance.importante" {
			return 1
		}
	}
	return 2
}
func copyString(s *string) *string {
	if s == nil {
		return nil
	}
	v := *s
	return &v
}
func stringPtr(s string) *string { return &s }

func validateProfile(d content.Document, p *Profile) (map[string]Requirement, error) {
	out := map[string]Requirement{}
	if p == nil {
		return out, nil
	}
	bad := func() (map[string]Requirement, error) {
		return nil, fmt.Errorf("psychometrics scoring: invalid confirmed profile")
	}
	if p.Version == "" || len(p.Competencies) != len(d.Competencies) {
		return bad()
	}
	// Profile versions are decimal counters, kept as strings without integer overflow.
	for _, r := range p.Version {
		if r < '0' || r > '9' {
			return bad()
		}
	}
	known := map[string]bool{}
	for _, c := range d.Competencies {
		known[c.ID] = true
	}
	for _, r := range p.Competencies {
		if !known[r.CompetencyID] {
			return bad()
		}
		if _, ok := out[r.CompetencyID]; ok {
			return bad()
		}
		switch r.Importance {
		case "importance.no_relevante":
			if r.DesiredBand != nil {
				return bad()
			}
		case "importance.clave", "importance.importante":
			if r.DesiredBand == nil || rank(*r.DesiredBand) < 0 {
				return bad()
			}
		default:
			return bad()
		}
		r.DesiredBand = copyString(r.DesiredBand)
		out[r.CompetencyID] = r
	}
	return out, nil
}
