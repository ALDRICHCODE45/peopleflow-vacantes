package scoring_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/scoring"
)

func ptr[T any](v T) *T { return &v }
func fixture(t *testing.T) (*content.Artifact, scoring.Input) {
	t.Helper()
	a, err := content.Load(content.Version)
	if err != nil {
		t.Fatal(err)
	}
	in := scoring.Input{Answers: map[int]int{}}
	n := 0
	for _, p := range a.Snapshot().Order {
		if strings.HasPrefix(p.ID, "attention.") {
			continue
		}
		in.Answers[p.Position] = n%5 + 1
		n++
	}
	for _, c := range a.Snapshot().Attention {
		in.Answers[c.Position] = c.Expected
	}
	syncEvents(&in)
	return a, in
}
func syncEvents(in *scoring.Input) {
	in.Events = nil
	for p := 1; p <= 63; p++ {
		if v, ok := in.Answers[p]; ok {
			in.Events = append(in.Events, scoring.AnswerEvent{Position: p, Value: ptr(v), ElapsedMS: ptr(int64(2000))})
		}
	}
}
func score(t *testing.T, a *content.Artifact, in scoring.Input) scoring.Result {
	t.Helper()
	r, err := scoring.Score(a, in)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func setFacet(a *content.Artifact, in *scoring.Input, id string, sum int) {
	remaining := sum - 4
	for _, it := range a.Snapshot().Items {
		if it.FacetID != id {
			continue
		}
		v := 1
		if remaining > 4 {
			v = 5
			remaining -= 4
		} else {
			v += remaining
			remaining = 0
		}
		if it.Key == "-" {
			v = 6 - v
		}
		for _, p := range a.Snapshot().Order {
			if p.ID == it.ID {
				in.Answers[p.Position] = v
			}
		}
	}
}
func competency(r scoring.Result, id string) scoring.Competency {
	for _, c := range r.Competencies {
		if c.CompetencyID == id {
			return c
		}
	}
	panic(id)
}
func profile(a *content.Artifact) *scoring.Profile {
	p := &scoring.Profile{Version: "2"}
	for _, c := range a.Snapshot().Competencies {
		p.Competencies = append(p.Competencies, scoring.Requirement{CompetencyID: c.ID, Importance: "importance.no_relevante"})
	}
	return p
}
func relevant(p *scoring.Profile, id, importance, band string) {
	for i := range p.Competencies {
		if p.Competencies[i].CompetencyID == id {
			p.Competencies[i].Importance = importance
			p.Competencies[i].DesiredBand = ptr(band)
		}
	}
}

func TestScoringBoundaries(t *testing.T) {
	for _, tc := range []struct {
		sum, n      int
		index, band string
	}{
		{8, 2, "4.0", "low"}, {19, 2, "9.5", "low"}, {20, 2, "10.0", "medium"}, {29, 2, "14.5", "medium"}, {30, 2, "15.0", "high"}, {40, 2, "20.0", "high"},
		{12, 3, "4.0", "low"}, {29, 3, "9.7", "low"}, {30, 3, "10.0", "medium"}, {44, 3, "14.7", "medium"}, {45, 3, "15.0", "high"}, {60, 3, "20.0", "high"},
	} {
		t.Run(tc.index+tc.band, func(t *testing.T) {
			a, in := fixture(t)
			id := "comp.organizacion"
			if tc.n == 3 {
				id = "comp.presion"
			}
			var links []content.FacetLink
			for _, c := range a.Snapshot().Competencies {
				if c.ID == id {
					links = c.Facets
				}
			}
			rest := tc.sum - 4*tc.n
			wantSums := []int{}
			wantIDs := []string{}
			for _, l := range links {
				s := 4
				add := min(rest, 16)
				s += add
				rest -= add
				wantSums = append(wantSums, s)
				wantIDs = append(wantIDs, l.ID)
				if l.Direction == "negative" {
					s = 24 - s
				}
				setFacet(a, &in, l.ID, s)
			}
			syncEvents(&in)
			r := score(t, a, in)
			c := competency(r, id)
			if c.Index != tc.index || c.Band != "band."+tc.band || c.OrientedSum != tc.sum || c.FacetCount != tc.n || !reflect.DeepEqual(c.OrientedSums, wantSums) || !reflect.DeepEqual(c.FacetIDs, wantIDs) {
				t.Fatalf("competency: %+v", c)
			}
			if len(r.Facets) != 15 || len(r.Competencies) != 7 || len(r.Interpretations) != 7 {
				t.Fatal("catalog counts")
			}
			for _, i := range r.Interpretations {
				if i.Prepend != a.Snapshot().InterpretationPrepend || i.Hypothesis != a.Snapshot().Hypothesis || !reflect.DeepEqual(i.Headings, a.Snapshot().InterpretationHeadings) {
					t.Fatal("required interpretation text lost")
				}
				found := false
				for _, l := range a.Snapshot().Library {
					if l.ID == i.ID {
						found = true
						if i.WorkText != l.WorkText || i.StrengthsText != l.StrengthsText || i.DevelopmentText != l.DevelopmentText {
							t.Fatal("snapshot changed")
						}
					}
				}
				if !found {
					t.Fatal("library lookup")
				}
			}
		})
	}
	for _, tc := range []struct {
		sum  int
		band string
	}{{4, "low"}, {9, "low"}, {10, "medium"}, {14, "medium"}, {15, "high"}, {20, "high"}} {
		t.Run("facet"+tc.band, func(t *testing.T) {
			a, in := fixture(t)
			setFacet(a, &in, "facet.c2", tc.sum)
			syncEvents(&in)
			r := score(t, a, in)
			for _, f := range r.Facets {
				if f.FacetID == "facet.c2" && (f.Sum != tc.sum || f.Band != "band."+tc.band) {
					t.Fatalf("facet: %+v", f)
				}
			}
		})
	}
}

func TestQualityBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, id, severity string
		count              int
	}{
		{"attention0", "attention", "none", 0}, {"attention1", "attention", "mild", 1}, {"attention2", "attention", "strong", 2}, {"attention3", "attention", "strong", 3},
		{"run6", "long_string", "none", 6}, {"run7", "long_string", "mild", 7}, {"run11", "long_string", "mild", 11}, {"run12", "long_string", "strong", 12},
		{"fast11", "fast", "none", 11}, {"fast12", "fast", "mild", 12}, {"fast29", "fast", "mild", 29}, {"fast30", "fast", "strong", 30},
		{"changes29", "changes", "none", 29}, {"changes30", "changes", "mild", 30},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, in := fixture(t)
			switch tc.id {
			case "attention":
				for i := 0; i < tc.count; i++ {
					c := a.Snapshot().Attention[i]
					in.Answers[c.Position] = c.Expected%5 + 1
				}
				syncEvents(&in)
			case "long_string":
				n := 0
				for _, p := range a.Snapshot().Order {
					if strings.HasPrefix(p.ID, "attention.") {
						continue
					}
					if n >= 12 && n < 12+tc.count {
						in.Answers[p.Position] = 5
					} else {
						in.Answers[p.Position] = 1 + n%2
					}
					n++
				}
				syncEvents(&in)
			case "fast":
				n := 0
				for i := range in.Events {
					if strings.HasPrefix(a.Snapshot().Order[in.Events[i].Position-1].ID, "attention.") {
						continue
					}
					if n < tc.count {
						in.Events[i].ElapsedMS = ptr(int64(1999))
					}
					n++
				}
			case "changes":
				v := in.Answers[1]
				for i := 0; i < tc.count; i++ {
					v = v%5 + 1
					in.Events = append(in.Events, scoring.AnswerEvent{Position: 1, Value: ptr(v), ElapsedMS: ptr(int64(2000))})
				}
				in.Answers[1] = v
			}
			r := score(t, a, in)
			for _, s := range r.Quality.Signals {
				if s.ID != "signal."+tc.id {
					continue
				}
				if s.Severity != tc.severity {
					t.Fatalf("signal: %+v", s)
				}
				raw, _ := json.Marshal(s.Counts)
				var counts map[string]int
				_ = json.Unmarshal(raw, &counts)
				key := map[string]string{"attention": "misses", "long_string": "run", "fast": "fast_count", "changes": "total"}[tc.id]
				if counts[key] != tc.count {
					t.Fatalf("counts: %s", raw)
				}
			}
			tier := "tier.sin"
			if tc.severity == "mild" {
				tier = "tier.algunas"
			}
			if tc.severity == "strong" {
				tier = "tier.relevantes"
			}
			if r.Quality.Tier != tier || r.Quality.Partial {
				t.Fatalf("quality: %+v", r.Quality)
			}
		})
	}
}

func TestTransitionsAndUnavailableTelemetry(t *testing.T) {
	a, in := fixture(t)
	// Empty DELETE, first answer, same-value revisit, change, clear twice, reanswer.
	in.Events = []scoring.AnswerEvent{{Position: 1}, {Position: 1, Value: ptr(2)}, {Position: 1, Value: ptr(2)}, {Position: 1, Value: ptr(4)}, {Position: 1}, {Position: 1}, {Position: 1, Value: ptr(3)}}
	in.Answers[1] = 3
	// Attention edits do not enter transitions or timing coverage.
	in.Events = append(in.Events, scoring.AnswerEvent{Position: 16, Value: ptr(1)}, scoring.AnswerEvent{Position: 16}, scoring.AnswerEvent{Position: 16, Value: ptr(2)})
	r := score(t, a, in)
	s := r.Quality.Signals[3]
	raw, _ := json.Marshal(s.Counts)
	if string(raw) != `{"value_changes":1,"clears":1,"reanswers":1,"total":3}` || s.Severity != "none" {
		t.Fatalf("transitions: %s %+v", raw, s)
	}
	if r.Quality.Signals[0].Severity != "none" || r.Quality.Signals[2].Severity != "unknown" || r.Quality.Signals[2].Counts != nil || !r.Quality.Partial || r.Quality.Tier != "tier.sin" {
		t.Fatalf("quality: %+v", r.Quality)
	}
	for _, ms := range []*int64{nil, ptr(int64(-1)), ptr(int64(3600001))} {
		_, in := fixture(t)
		in.Events[0].ElapsedMS = ms
		r := score(t, a, in)
		if r.Quality.Signals[2].Severity != "unknown" || !r.Quality.Partial {
			t.Fatal("invalid timing accepted")
		}
	}
	_, in = fixture(t)
	in.Events = append(in.Events, scoring.AnswerEvent{Position: 1, Value: ptr(in.Answers[1]), ElapsedMS: ptr(int64(1999))})
	r = score(t, a, in)
	raw, _ = json.Marshal(r.Quality.Signals[2].Counts)
	if string(raw) != `{"fast_count":1,"total":60}` {
		t.Fatalf("latest same-value timing: %s", raw)
	}
	in.EventsIncomplete = true
	r = score(t, a, in)
	if r.Quality.Signals[3].Severity != "unknown" || r.Quality.Signals[3].Counts != nil || !r.Quality.Partial {
		t.Fatal("unavailable stream")
	}
	_, in = fixture(t)
	in.Answers[16] = 1
	for i := 0; i < 12; i++ {
		if in.Events[i].Position != 16 {
			in.Events[i].ElapsedMS = ptr(int64(1999))
		}
	}
	r = score(t, a, in)
	if r.Quality.Tier != "tier.relevantes" {
		t.Fatalf("two mild: %+v", r.Quality)
	}
}

func TestFitTable(t *testing.T) {
	for _, tc := range []struct {
		observed, desired, importance, fit, direction string
		gap                                           bool
	}{
		{"medium", "medium", "clave", "alineado", "", false}, {"low", "medium", "clave", "explorar", "below", true}, {"high", "medium", "importante", "explorar", "above", true}, {"low", "high", "clave", "atencion", "below", true}, {"high", "low", "importante", "explorar", "above", true}, {"low", "high", "importante", "explorar", "below", true}, {"medium", "", "no_relevante", "", "", false},
	} {
		t.Run(tc.observed+tc.desired+tc.importance, func(t *testing.T) {
			a, in := fixture(t)
			s := map[string]int{"low": 8, "medium": 12, "high": 18}[tc.observed]
			setFacet(a, &in, "facet.c2", s)
			setFacet(a, &in, "facet.c5", s)
			syncEvents(&in)
			in.Profile = profile(a)
			if tc.desired != "" {
				relevant(in.Profile, "comp.organizacion", "importance."+tc.importance, "band."+tc.desired)
			}
			r := score(t, a, in)
			for _, c := range r.Comparison.Competencies {
				if c.CompetencyID != "comp.organizacion" {
					continue
				}
				if tc.fit == "" {
					if c.Fit != nil || c.Direction != nil {
						t.Fatal("no relevante fit")
					}
				} else if c.Fit == nil || *c.Fit != "fit."+tc.fit {
					t.Fatalf("fit: %+v", c)
				}
				if tc.direction == "" {
					if c.Direction != nil {
						t.Fatal("direction must be null")
					}
				} else if c.Direction == nil || *c.Direction != tc.direction {
					t.Fatal("direction")
				}
			}
			gaps := 0
			for _, f := range r.Comparison.FocusAreas {
				if f.Type != "focus.quality" {
					gaps++
					if f.CompetencyID == nil || *f.CompetencyID != "comp.organizacion" || f.ProfileVersion == nil || *f.ProfileVersion != "2" || f.ObservedBand != "band."+tc.observed {
						t.Fatalf("gap: %+v", f)
					}
				}
			}
			if (gaps == 1) != tc.gap {
				t.Fatal("gap count")
			}
		})
	}
	a, in := fixture(t)
	r := score(t, a, in)
	for _, c := range r.Comparison.Competencies {
		if c.Fit != nil || c.Direction != nil || c.DesiredBand != nil || c.Importance != nil {
			t.Fatal("nil profile")
		}
	}
	if r.Comparison.ProfileVersion != nil || len(r.Comparison.FocusAreas) != 0 {
		t.Fatal("nil profile focus")
	}
}

func TestGuideOrderingSnapshotsAndDeterminism(t *testing.T) {
	a, in := fixture(t)
	r := score(t, a, in)
	want := []string{"comp.colaboracion", "comp.compromisos", "comp.coordinacion", "comp.deliberacion"}
	for i, id := range want {
		if r.Comparison.Guide[2*i].CompetencyID != id {
			t.Fatal("exploratory order")
		}
	}
	in.Profile = profile(a)
	// All medium; importance precedes distance, then id.
	for _, f := range a.Snapshot().Facets {
		setFacet(a, &in, f.ID, 12)
	}
	relevant(in.Profile, "comp.presion", "importance.clave", "band.low")
	relevant(in.Profile, "comp.organizacion", "importance.clave", "band.high")
	relevant(in.Profile, "comp.colaboracion", "importance.importante", "band.low")
	relevant(in.Profile, "comp.compromisos", "importance.importante", "band.high")
	relevant(in.Profile, "comp.exploracion", "importance.importante", "band.low")
	setFacet(a, &in, "facet.a3", 20)
	setFacet(a, &in, "facet.a4", 20)
	syncEvents(&in)
	in.Answers[16] = 1
	r = score(t, a, in)
	expected := []string{"comp.organizacion", "comp.presion", "comp.colaboracion", "comp.compromisos", "comp.exploracion", ""}
	for i, f := range r.Comparison.FocusAreas {
		if i >= len(expected) {
			t.Fatal("extra focus")
		}
		if expected[i] == "" {
			if f.Type != "focus.quality" || f.CompetencyID != nil || f.RoutedCompetencyID != "comp.organizacion" || !reflect.DeepEqual(f.SignalIDs, []string{"signal.attention", "signal.long_string"}) {
				t.Fatalf("quality routing: %+v", f)
			}
		} else if f.CompetencyID == nil || *f.CompetencyID != expected[i] {
			t.Fatalf("focus order: %+v", r.Comparison.FocusAreas)
		}
	}
	if len(r.Comparison.Guide) != 8 {
		t.Fatal("guide cap")
	}
	ids := []string{}
	seen := map[string]bool{}
	for i, q := range r.Comparison.Guide {
		ids = append(ids, q.QuestionID)
		if seen[q.QuestionID] {
			t.Fatal("duplicate question")
		}
		seen[q.QuestionID] = true
		if !strings.HasSuffix(q.Text, " "+a.Snapshot().STAR) || q.GoodAnswerChecklist == "" {
			t.Fatal("resolved question")
		}
		if i >= 6 && (q.Selector != "quality" || q.OriginatingFocusType == nil || *q.OriginatingFocusType != "focus.quality" || q.Tier != "tier.relevantes" || q.ContextLabel != "Contexto de respuesta") {
			t.Fatalf("quality metadata: %+v", q)
		}
	}
	if !reflect.DeepEqual(ids, r.Comparison.QuestionIDs) {
		t.Fatal("ordered ids")
	}
	before, _ := json.Marshal(in)
	b1, _ := json.Marshal(r)
	for i := 0; i < 5; i++ {
		b2, _ := json.Marshal(score(t, a, in))
		if !bytes.Equal(b1, b2) {
			t.Fatal("nondeterministic")
		}
	}
	after, _ := json.Marshal(in)
	if !bytes.Equal(before, after) {
		t.Fatal("input mutated")
	}
	// No relevant entries uses exploratory blocks and null importance, quality fallback.
	in.Profile = profile(a)
	r = score(t, a, in)
	if len(r.Comparison.Guide) != 8 {
		t.Fatal("fallback cap")
	}
	f := r.Comparison.FocusAreas[0]
	if f.RoutedCompetencyID != "comp.organizacion" {
		t.Fatal("fallback routing")
	}
	for _, q := range r.Comparison.Guide {
		if q.Importance != nil || q.Fit != nil {
			t.Fatal("exploratory metadata")
		}
	}
	in.Profile = nil
	r = score(t, a, in)
	if r.Comparison.FocusAreas[0].RoutedCompetencyID != "comp.organizacion" {
		t.Fatal("nil fallback")
	}
	// Named pressure-only example, with/without quality, no irrelevant padding.
	a, in = fixture(t)
	in.Profile = profile(a)
	relevant(in.Profile, "comp.presion", "importance.clave", "band.high")
	for _, f := range []string{"facet.n1", "facet.n2", "facet.n6"} {
		setFacet(a, &in, f, 20)
	}
	syncEvents(&in)
	for _, quality := range []bool{false, true} {
		if quality {
			in.Answers[16] = 1
		} else {
			in.Answers[16] = 2
		}
		r = score(t, a, in)
		want := []string{"q.presion.distant.1", "q.presion.distant.2"}
		if quality {
			want = append(want, "q.presion.quality.1", "q.presion.quality.2")
		}
		if !reflect.DeepEqual(r.Comparison.QuestionIDs, want) {
			t.Fatalf("pressure guide: %v", r.Comparison.QuestionIDs)
		}
	}
}

// Quality never changes bands, interpretations or fit; snapshots do not retain
// profile pointers and a new explicit comparison cannot rewrite an old output.
func TestSnapshotsAndQualityIsolation(t *testing.T) {
	a, in := fixture(t)
	in.Profile = profile(a)
	relevant(in.Profile, "comp.presion", "importance.clave", "band.high")
	baseline := score(t, a, in)
	before, _ := json.Marshal(baseline)
	in.Events[0].ElapsedMS = nil
	partial := score(t, a, in)
	if !partial.Quality.Partial || partial.Quality.Tier != "tier.sin" || len(partial.Comparison.FocusAreas) != len(baseline.Comparison.FocusAreas) {
		t.Fatal("unknown alone must not add a quality focus")
	}
	in.Answers[16], in.Answers[32] = 1, 1
	strong := score(t, a, in)
	if strong.Quality.Tier != "tier.relevantes" || !reflect.DeepEqual(baseline.Facets, strong.Facets) || !reflect.DeepEqual(baseline.Competencies, strong.Competencies) || !reflect.DeepEqual(baseline.Interpretations, strong.Interpretations) || !reflect.DeepEqual(baseline.Comparison.Competencies, strong.Comparison.Competencies) {
		t.Fatal("quality affected substantive scores/fit")
	}
	for _, q := range strong.Comparison.Guide {
		found := false
		for _, authored := range a.Snapshot().Questions {
			if authored.ID == q.QuestionID {
				found = true
				if q.Text != authored.Text+" "+a.Snapshot().STAR || q.GoodAnswerChecklist != authored.GoodAnswerChecklist || q.CompetencyID != authored.CompetencyID || q.Selector != authored.Selector {
					t.Fatal("question snapshot differs from artifact")
				}
			}
		}
		if !found {
			t.Fatal("invented question")
		}
	}
	in.Profile.Version = "3"
	for i := range in.Profile.Competencies {
		if in.Profile.Competencies[i].DesiredBand != nil {
			*in.Profile.Competencies[i].DesiredBand = "band.low"
		}
	}
	_ = score(t, a, in)
	after, _ := json.Marshal(baseline)
	if !bytes.Equal(before, after) {
		t.Fatal("profile mutation changed prior snapshot")
	}
	baseline.Comparison.Competencies[0].FacetIDs[0] = "mutated"
	if baseline.Competencies[0].FacetIDs[0] == "mutated" {
		t.Fatal("comparison/result slices alias")
	}
	// Exact nulls and tagged focus shape through the public JSON representation.
	raw, _ := json.Marshal(partial.Quality.Signals[2])
	if string(raw) != `{"id":"signal.fast","severity":"unknown","counts":null}` {
		t.Fatalf("unknown shape: %s", raw)
	}
	focus := strong.Comparison.FocusAreas[len(strong.Comparison.FocusAreas)-1]
	raw, _ = json.Marshal(focus)
	if string(raw) != `{"type":"focus.quality","competency_id":null,"tier":"tier.relevantes","signal_ids":["signal.attention"],"routed_competency_id":"comp.presion"}` {
		t.Fatalf("quality tagged shape: %s", raw)
	}
	// Input map insertion and profile ordering must not affect output bytes.
	a, in = fixture(t)
	in.Profile = profile(a)
	original, _ := json.Marshal(score(t, a, in))
	answers := map[int]int{}
	for p := 63; p >= 1; p-- {
		answers[p] = in.Answers[p]
	}
	in.Answers = answers
	for i, j := 0, len(in.Profile.Competencies)-1; i < j; i, j = i+1, j-1 {
		in.Profile.Competencies[i], in.Profile.Competencies[j] = in.Profile.Competencies[j], in.Profile.Competencies[i]
	}
	reordered, _ := json.Marshal(score(t, a, in))
	if !bytes.Equal(original, reordered) {
		t.Fatal("input container order leaked")
	}
}

func TestFinishAndInvalidInputs(t *testing.T) {
	a, in := fixture(t)
	delete(in.Answers, 1)
	delete(in.Answers, 16)
	delete(in.Answers, 63)
	if got := scoring.MissingPositions(a, in.Answers); !reflect.DeepEqual(got, []int{1, 16, 63}) {
		t.Fatalf("missing: %v", got)
	}
	r, err := scoring.Score(a, in)
	var incomplete *scoring.IncompleteError
	if !errors.As(err, &incomplete) || !reflect.DeepEqual(incomplete.MissingPositions, []int{1, 16, 63}) || !reflect.DeepEqual(r, scoring.Result{}) {
		t.Fatalf("incomplete: %+v %v", r, err)
	}
	for _, kind := range []string{"value", "position", "event", "nil artifact", "zero artifact", "profile duplicate", "profile missing", "profile unknown", "profile band", "profile importance", "profile version"} {
		t.Run(kind, func(t *testing.T) {
			a, in := fixture(t)
			switch kind {
			case "value":
				in.Answers[1] = 6
			case "position":
				in.Answers[64] = 1
			case "event":
				in.Events[0].Value = ptr(0)
			case "nil artifact":
				a = nil
			case "zero artifact":
				a = &content.Artifact{}
			default:
				in.Profile = profile(a)
				switch kind {
				case "profile duplicate":
					in.Profile.Competencies[0] = in.Profile.Competencies[1]
				case "profile missing":
					in.Profile.Competencies = in.Profile.Competencies[:6]
				case "profile unknown":
					in.Profile.Competencies[0].CompetencyID = "unknown"
				case "profile band":
					relevant(in.Profile, "comp.presion", "importance.clave", "bad")
				case "profile importance":
					in.Profile.Competencies[0].Importance = "bad"
				case "profile version":
					in.Profile.Version = ""
				}
			}
			before, _ := json.Marshal(in)
			r, err := scoring.Score(a, in)
			after, _ := json.Marshal(in)
			if err == nil || !reflect.DeepEqual(r, scoring.Result{}) || !bytes.Equal(before, after) {
				t.Fatalf("invalid not rejected atomically: %+v %v", r, err)
			}
		})
	}
}
