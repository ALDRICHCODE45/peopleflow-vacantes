package content_test

import (
	"encoding/json"
	"flag"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
)

var update = flag.Bool("update-content", false, "rebuild content.v1.json from repository documentation")

func TestDocumentationDrift(t *testing.T) {
	want := documentFromDocs(t)
	if *update {
		raw, err := json.MarshalIndent(want, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile("content.v1.json", append(raw, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
		return
	}
	artifact, err := content.Load(content.Version)
	if err != nil {
		t.Fatal(err)
	}
	compareJSON(t, "artifact", want, artifact.Snapshot())
}

func compareJSON(t *testing.T, path string, want, got any) {
	t.Helper()
	a, _ := json.Marshal(want)
	b, _ := json.Marshal(got)
	var left, right any
	if err := json.Unmarshal(a, &left); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &right); err != nil {
		t.Fatal(err)
	}
	compareValue(t, path, left, right)
}

func compareValue(t *testing.T, path string, want, got any) {
	t.Helper()
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			t.Errorf("%s: expected object", path)
			return
		}
		if id, ok := w["id"].(string); ok {
			path += "[" + id + "]"
		}
		for key, value := range w {
			compareValue(t, path+"."+key, value, g[key])
		}
		for key := range g {
			if _, ok := w[key]; !ok {
				t.Errorf("%s.%s: unexpected field", path, key)
			}
		}
	case []any:
		g, ok := got.([]any)
		if !ok || len(w) != len(g) {
			t.Errorf("%s: length want %d, got %v", path, len(w), got)
			return
		}
		for i := range w {
			compareValue(t, path, w[i], g[i])
		}
	default:
		if !reflect.DeepEqual(want, got) {
			t.Errorf("%s: documentation wants %v, embedded value %v", path, want, got)
		}
	}
}

func TestLoadAndIsolation(t *testing.T) {
	for _, version := range []string{"", "psychometrics.content.v2", content.ScoringVersion} {
		if got, err := content.Load(version); err == nil || got != nil {
			t.Fatalf("Load(%q) = %v, %v", version, got, err)
		}
	}
	a, err := content.Load(content.Version)
	if err != nil {
		t.Fatal(err)
	}
	first := a.Snapshot()
	pristine := a.Snapshot()
	first.Items[0].Text = "changed"
	first.Competencies[0].Facets[0].ID = "changed"
	first.Facets[0].BandTexts[0] = "changed"
	first.Selection.ImportanceOrder[0] = "changed"
	*first.Quality.Signals[0].StrongMin = 99
	compareJSON(t, "immutable snapshot", pristine, a.Snapshot())
	b, err := content.Load(content.Version)
	if err != nil {
		t.Fatal(err)
	}
	compareJSON(t, "independent load", pristine, b.Snapshot())
}

func TestRejectInvalidArtifacts(t *testing.T) {
	tests := []struct {
		name, field string
		mutate      func(*content.Document)
	}{
		{"version", "content_version", func(d *content.Document) { d.ContentVersion = "unknown" }},
		{"scoring", "scoring_version", func(d *content.Document) { d.ScoringVersion = "unknown" }},
		{"test", "test", func(d *content.Document) { d.Test = "unknown" }},
		{"item count", "items", func(d *content.Document) { d.Items = d.Items[:59] }},
		{"facet count", "facets", func(d *content.Document) { d.Facets = d.Facets[:14] }},
		{"item duplicate", "item.ipip.1", func(d *content.Document) { d.Items[1].ID = d.Items[0].ID }},
		{"original duplicate", "number", func(d *content.Document) { d.Items[1].Number = d.Items[0].Number }},
		{"facet duplicate", "facet.n1", func(d *content.Document) { d.Facets[1].ID = d.Facets[0].ID }},
		{"four per facet", "facet.n1", func(d *content.Document) { d.Items[0].FacetID = d.Facets[1].ID }},
		{"unknown facet", "facet.missing", func(d *content.Document) { d.Items[0].FacetID = "facet.missing" }},
		{"key", "key", func(d *content.Document) { d.Items[0].Key = "?" }},
		{"empty text", "text", func(d *content.Document) { d.Items[0].Text = "" }},
		{"order count", "order", func(d *content.Document) { d.Order = d.Order[:62] }},
		{"position duplicate", "position", func(d *content.Document) { d.Order[1].Position = 1 }},
		{"position outside", "position", func(d *content.Document) { d.Order[0].Position = 0 }},
		{"order reference", "missing", func(d *content.Document) { d.Order[0].ID = "missing" }},
		{"order duplicate", "item.ipip.1", func(d *content.Document) { d.Order[1].ID = d.Order[0].ID }},
		{"order sorting", "order", func(d *content.Document) { d.Order[0].ID, d.Order[1].ID = d.Order[1].ID, d.Order[0].ID }},
		{"attention count", "attention", func(d *content.Document) { d.Attention = d.Attention[:2] }},
		{"attention position", "attention.1", func(d *content.Document) { d.Order[15].ID, d.Order[16].ID = d.Order[16].ID, d.Order[15].ID }},
		{"attention expected", "attention.1", func(d *content.Document) { d.Attention[0].Expected = 3 }},
		{"competency count", "competencies", func(d *content.Document) { d.Competencies = d.Competencies[:6] }},
		{"competency facet", "facet.missing", func(d *content.Document) { d.Competencies[0].Facets[0].ID = "facet.missing" }},
		{"direction", "direction", func(d *content.Document) { d.Competencies[0].Facets[0].Direction = "?" }},
		{"pressure", "comp.presion", func(d *content.Document) { d.Competencies[6].Facets[0].Direction = "positive" }},
		{"library count", "library", func(d *content.Document) { d.Library = d.Library[:20] }},
		{"library duplicate", "lib.organizacion.low", func(d *content.Document) { d.Library[1].ID = d.Library[0].ID }},
		{"library coverage", "band", func(d *content.Document) { d.Library[1].Band = d.Library[0].Band }},
		{"question count", "questions", func(d *content.Document) { d.Questions = d.Questions[:83] }},
		{"question duplicate", "q.organizacion.low.1", func(d *content.Document) { d.Questions[1].ID = d.Questions[0].ID }},
		{"selector coverage", "selector", func(d *content.Document) { d.Questions[1].Selector = "bogus" }},
		{"question membership", "competency", func(d *content.Document) { d.Questions[0].CompetencyID = "missing" }},
		{"scale", "scale", func(d *content.Document) { d.Scale[0].Value = 2 }},
		{"bands", "bands", func(d *content.Document) { d.Bands[0].Max = 10 }},
		{"hash", "sha256", func(d *content.Document) { d.Notice.Text += "\n" }},
		{"threshold", "quality", func(d *content.Document) { d.Quality.Signals[0].MildMin = 0 }},
		{"selection", "selection", func(d *content.Document) { d.Selection.MaxQuestions = 9 }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := documentFromDocs(t)
			tt.mutate(&d)
			raw, err := json.Marshal(d)
			if err != nil {
				t.Fatal(err)
			}
			got, err := content.Decode(raw)
			if err == nil || got != nil || !strings.Contains(err.Error(), tt.field) {
				t.Fatalf("expected rejection naming %q, got %v, %v", tt.field, got, err)
			}
		})
	}
	for _, raw := range []string{"{", `{} `} {
		if got, err := content.Decode([]byte(raw)); err == nil || got != nil {
			t.Fatalf("accepted %q", raw)
		}
	}
}
