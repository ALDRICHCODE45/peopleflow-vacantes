package scoring

import (
	"fmt"
	"sort"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
)

func compare(d content.Document, competencies []Competency, q Quality, p *Profile, requirements map[string]Requirement) (Comparison, error) {
	c := Comparison{ContentVersion: d.ContentVersion, ScoringVersion: d.ScoringVersion, Competencies: []ComparedCompetency{}, FocusAreas: []FocusArea{}, Guide: []GuideQuestion{}, QuestionIDs: []string{}}
	if p != nil {
		c.ProfileVersion = stringPtr(p.Version)
	}
	for _, v := range competencies {
		// Detach even the nested slices: comparison/result are independent snapshots.
		v.FacetIDs = append([]string{}, v.FacetIDs...)
		v.OrientedSums = append([]int{}, v.OrientedSums...)
		entry := ComparedCompetency{Competency: v}
		if r, ok := requirements[v.CompetencyID]; ok {
			entry.Importance = stringPtr(r.Importance)
			entry.DesiredBand = copyString(r.DesiredBand)
			if r.Importance != "importance.no_relevante" {
				diff := rank(v.Band) - rank(*r.DesiredBand)
				distance := diff
				if distance < 0 {
					distance = -distance
				}
				fit := "fit.alineado"
				if distance > 0 {
					fit = "fit.explorar"
					direction := "above"
					if diff < 0 {
						direction = "below"
					}
					entry.Direction = stringPtr(direction)
				}
				if distance == 2 && r.Importance == "importance.clave" {
					fit = "fit.atencion"
				}
				entry.Fit = stringPtr(fit)
				if distance > 0 {
					kind := "focus.adjacent"
					if distance == 2 {
						kind = "focus.distant"
					}
					c.FocusAreas = append(c.FocusAreas, FocusArea{Type: kind, CompetencyID: stringPtr(v.CompetencyID), ObservedBand: v.Band, DesiredBand: copyString(entry.DesiredBand), Importance: copyString(entry.Importance), Fit: copyString(entry.Fit), ProfileVersion: copyString(c.ProfileVersion)})
				}
			}
		}
		c.Competencies = append(c.Competencies, entry)
	}
	sort.Slice(c.FocusAreas, func(i, j int) bool {
		a, b := c.FocusAreas[i], c.FocusAreas[j]
		if importance(a.Importance) != importance(b.Importance) {
			return importance(a.Importance) < importance(b.Importance)
		}
		if a.Type != b.Type {
			return a.Type == "focus.distant"
		}
		return *a.CompetencyID < *b.CompetencyID
	})
	relevant := []ComparedCompetency{}
	for _, v := range c.Competencies {
		if importance(v.Importance) < 2 {
			relevant = append(relevant, v)
		}
	}
	sort.Slice(relevant, func(i, j int) bool {
		a, b := relevant[i], relevant[j]
		if importance(a.Importance) != importance(b.Importance) {
			return importance(a.Importance) < importance(b.Importance)
		}
		return a.CompetencyID < b.CompetencyID
	})
	if q.Tier != "tier.sin" {
		routed := d.Selection.QualityFallback
		if len(relevant) > 0 {
			routed = relevant[0].CompetencyID
		}
		signals := []string{}
		for _, s := range q.Signals {
			if s.Severity == "mild" || s.Severity == "strong" {
				signals = append(signals, s.ID)
			}
		}
		c.FocusAreas = append(c.FocusAreas, FocusArea{Type: "focus.quality", Tier: q.Tier, SignalIDs: signals, RoutedCompetencyID: routed})
	}
	if err := guide(d, &c, relevant); err != nil {
		return Comparison{}, err
	}
	return c, nil
}

type block struct {
	entry    ComparedCompetency
	selector string
	focus    *FocusArea
}

func focusPriority(selector string) int {
	switch selector {
	case "distant":
		return 0
	case "adjacent":
		return 1
	}
	return 2
}

func guide(d content.Document, c *Comparison, relevant []ComparedCompetency) error {
	ordinary := []block{}
	entries := relevant
	exploratory := len(entries) == 0
	if exploratory {
		entries = c.Competencies
	}
	for _, v := range entries {
		if exploratory {
			v.Importance = nil
			v.Fit = nil
			v.Direction = nil
			v.DesiredBand = nil
		}
		b := block{entry: v, selector: strings.TrimPrefix(v.Band, "band.")}
		for i := range c.FocusAreas {
			f := &c.FocusAreas[i]
			if f.CompetencyID != nil && *f.CompetencyID == v.CompetencyID {
				b.focus = f
				b.selector = strings.TrimPrefix(f.Type, "focus.")
				break
			}
		}
		ordinary = append(ordinary, b)
	}
	sort.Slice(ordinary, func(i, j int) bool {
		a, b := ordinary[i], ordinary[j]
		if importance(a.entry.Importance) != importance(b.entry.Importance) {
			return importance(a.entry.Importance) < importance(b.entry.Importance)
		}
		if focusPriority(a.selector) != focusPriority(b.selector) {
			return focusPriority(a.selector) < focusPriority(b.selector)
		}
		return a.entry.CompetencyID < b.entry.CompetencyID
	})
	var qualityFocus *FocusArea
	for i := range c.FocusAreas {
		if c.FocusAreas[i].Type == "focus.quality" {
			qualityFocus = &c.FocusAreas[i]
		}
	}
	limit := d.Selection.BlockSlots
	if qualityFocus != nil {
		limit = d.Selection.OrdinaryWithQuality
	}
	selected := append([]block{}, ordinary[:min(limit, len(ordinary))]...)
	if qualityFocus != nil {
		found := false
		for _, v := range c.Competencies {
			if v.CompetencyID == qualityFocus.RoutedCompetencyID {
				if exploratory {
					v.Importance = nil
					v.Fit = nil
					v.DesiredBand = nil
				}
				selected = append(selected, block{entry: v, selector: "quality", focus: qualityFocus})
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("psychometrics scoring: missing quality routing competency")
		}
	}
	questions := map[string]content.Question{}
	for _, q := range d.Questions {
		questions[q.ID] = q
	}
	seen := map[string]bool{}
	for _, b := range selected {
		for n := 1; n <= d.Selection.QuestionsPerBlock; n++ {
			id := fmt.Sprintf("q.%s.%s.%d", strings.TrimPrefix(b.entry.CompetencyID, "comp."), b.selector, n)
			q, ok := questions[id]
			if !ok || seen[id] {
				return fmt.Errorf("psychometrics scoring: missing or duplicate guide question %s", id)
			}
			seen[id] = true
			v := GuideQuestion{QuestionID: id, CompetencyID: b.entry.CompetencyID, Text: q.Text + " " + d.STAR, GoodAnswerChecklist: q.GoodAnswerChecklist, ObservedBand: b.entry.Band, DesiredBand: copyString(b.entry.DesiredBand), Importance: copyString(b.entry.Importance), Fit: copyString(b.entry.Fit), Selector: b.selector, SignalIDs: []string{}}
			if b.focus != nil {
				v.OriginatingFocusType = stringPtr(b.focus.Type)
				if b.focus.Type == "focus.quality" {
					v.SignalIDs = append(v.SignalIDs, b.focus.SignalIDs...)
					v.Tier = b.focus.Tier
					v.ContextLabel = "Contexto de respuesta"
				}
			}
			c.Guide = append(c.Guide, v)
			c.QuestionIDs = append(c.QuestionIDs, id)
		}
	}
	if len(c.Guide) > d.Selection.MaxQuestions {
		return fmt.Errorf("psychometrics scoring: guide exceeds pinned maximum")
	}
	return nil
}
