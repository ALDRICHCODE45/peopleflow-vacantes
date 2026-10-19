package pipelineconfig_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

var draftID = uuid.MustParse("11111111-1111-4111-8111-111111111111")

func replacement(t *testing.T, c pipelineconfig.Configuration) []byte {
	t.Helper()
	stages := make([]map[string]any, len(c.Stages))
	for i, s := range c.Stages {
		stages[i] = map[string]any{"id": s.ID, "name": s.Name}
	}
	raw, err := json.Marshal(map[string]any{"stages": stages, "exit": map[string]any{"id": c.Exit.ID, "name": c.Exit.Name}})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestDefaults_DeterministicDraftScopedUUIDv5(t *testing.T) {
	a := pipelineconfig.Defaults(draftID)
	if !reflect.DeepEqual(a, pipelineconfig.Defaults(draftID)) {
		t.Fatal("defaults must be deterministic")
	}
	other := pipelineconfig.Defaults(uuid.New())
	kinds := []string{"new", "screening", "screening_ok", "in_process", "placement", "discarded"}
	names := []string{"Nuevos", "Screening", "Screening OK", "En proceso", "Placement", "Descartados"}
	for i, s := range append(a.Stages, a.Exit) {
		id := uuid.MustParse(s.ID)
		if s.Kind != kinds[i] || s.Name != names[i] || id != uuid.NewSHA1(draftID, []byte(s.Kind)) || id.Version() != 5 {
			t.Fatalf("default %d = %+v", i, s)
		}
		if i < len(other.Stages) && s.ID == other.Stages[i].ID {
			t.Fatal("ids must be draft scoped")
		}
	}
}

func TestReplace_StrictDecode(t *testing.T) {
	c := pipelineconfig.Defaults(draftID)
	valid := string(replacement(t, c))
	cases := []struct{ name, body string }{
		{"malformed", `{"stages":`},
		{"trailing", valid + `{}`},
		{"unknown root", strings.Replace(valid, `"stages":`, `"extra":1,"stages":`, 1)},
		{"duplicate root", strings.Replace(valid, `"stages":`, `"stages":[],"stages":`, 1)},
		{"client kind", strings.Replace(valid, `"name":"Nuevos"`, `"kind":"new","name":"Nuevos"`, 1)},
		{"duplicate nested escaped", strings.Replace(valid, `"name":"Nuevos"`, `"na\u006de":"X","name":"Nuevos"`, 1)},
		{"invalid utf8", strings.Replace(valid, "Nuevos", string([]byte{0xff}), 1)},
		{"invalid surrogate", strings.Replace(valid, "Nuevos", `\uD800`, 1)},
		{"null root", `null`},
		{"missing fields", `{}`},
		{"null stages", strings.Replace(valid, `"stages":[`, `"stages":null,"ignored":[`, 1)},
		{"name type", strings.Replace(valid, `"name":"Nuevos"`, `"name":1`, 1)},
		{"id type", strings.Replace(valid, `"id":"`+c.Exit.ID+`"`, `"id":null`, 1)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := pipelineconfig.Replace(c, []byte(tc.body), draftID, 0)
			if !errors.Is(err, drafts.ErrInvalidRequest) || !reflect.DeepEqual(got, pipelineconfig.Configuration{}) {
				t.Fatalf("got %+v, %v; want zero and invalid_request", got, err)
			}
		})
	}
}

func TestReplace_Invariants(t *testing.T) {
	base := pipelineconfig.Defaults(draftID)
	cases := []struct {
		name   string
		mutate func(*pipelineconfig.Configuration)
	}{
		{"missing new", func(c *pipelineconfig.Configuration) { c.Stages = c.Stages[1:] }},
		{"missing screening", func(c *pipelineconfig.Configuration) { c.Stages = append(c.Stages[:1], c.Stages[2:]...) }},
		{"missing screening ok", func(c *pipelineconfig.Configuration) { c.Stages = append(c.Stages[:2], c.Stages[3:]...) }},
		{"missing in process", func(c *pipelineconfig.Configuration) { c.Stages = append(c.Stages[:3], c.Stages[4:]...) }},
		{"missing placement", func(c *pipelineconfig.Configuration) { c.Stages = c.Stages[:4] }},
		{"unknown id", func(c *pipelineconfig.Configuration) { c.Stages[1].ID = uuid.NewString() }},
		{"bad id", func(c *pipelineconfig.Configuration) { c.Stages[1].ID = "no" }},
		{"duplicate id", func(c *pipelineconfig.Configuration) { c.Stages[1] = c.Stages[2] }},
		{"new not first", func(c *pipelineconfig.Configuration) { c.Stages[0], c.Stages[1] = c.Stages[1], c.Stages[0] }},
		{"placement not last", func(c *pipelineconfig.Configuration) { c.Stages[3], c.Stages[4] = c.Stages[4], c.Stages[3] }},
		{"discarded in progression", func(c *pipelineconfig.Configuration) { c.Stages[1], c.Exit = c.Exit, c.Stages[1] }},
		{"idless exit", func(c *pipelineconfig.Configuration) { c.Exit.ID = "" }},
		{"empty name", func(c *pipelineconfig.Configuration) { c.Stages[1].Name = " \u00a0\t" }},
		{"long name", func(c *pipelineconfig.Configuration) { c.Stages[1].Name = strings.Repeat("é", 41) }},
		{"control name", func(c *pipelineconfig.Configuration) { c.Stages[1].Name = "x\x00y" }},
		{"duplicate exit name", func(c *pipelineconfig.Configuration) { c.Exit.Name = "  NUEVOS\u00a0" }},
		{"casefold duplicate", func(c *pipelineconfig.Configuration) { c.Stages[1].Name, c.Stages[2].Name = "Straße", "STRASSE" }},
		{"nfc duplicate", func(c *pipelineconfig.Configuration) { c.Stages[1].Name, c.Stages[2].Name = "ÁREA", "A\u0301rea" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := pipelineconfig.Defaults(draftID)
			tc.mutate(&c)
			body := replacement(t, c)
			// Empty id means omitted, as required for new custom stages.
			body = []byte(strings.ReplaceAll(string(body), `"id":"",`, ""))
			got, err := pipelineconfig.Replace(base, body, draftID, 0)
			if !errors.Is(err, drafts.ErrValidation) || !reflect.DeepEqual(got, pipelineconfig.Configuration{}) {
				t.Fatalf("got %+v, %v; want zero and validation_error", got, err)
			}
		})
	}
}

func TestReplace_NormalizationOrderCustomLifecycleAndNoOp(t *testing.T) {
	base := pipelineconfig.Defaults(draftID)
	c := pipelineconfig.Defaults(draftID)
	c.Stages[1], c.Stages[3] = c.Stages[3], c.Stages[1]
	c.Stages[1].Name = "  A\u0301rea\u00a0\tTI "
	c.Stages[2].Name = "Area TI" // accents preserved, not a duplicate
	c.Exit.Name = "Fuera\u200b"
	body := string(replacement(t, c))
	body = strings.Replace(body, `"stages":[`, `"stages":[`, 1)
	// Insert three id-less custom entries immediately before Placement.
	placement := `{"id":"` + c.Stages[4].ID + `"`
	body = strings.Replace(body, placement, `{"name":"Uno"},{"name":"Dos"},{"name":"`+strings.Repeat("e\\u0301", 40)+`"},`+placement, 1)
	// Use a literal 40-codepoint name after NFC, not escaped backslashes.
	body = strings.Replace(body, strings.Repeat("e\\u0301", 40), strings.Repeat("e\u0301", 40), 1)
	got, err := pipelineconfig.Replace(base, []byte(body), draftID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Stages[1].ID != c.Stages[1].ID || got.Stages[1].Kind != "in_process" || got.Stages[1].Name != "Área TI" || got.Exit.Name != c.Exit.Name || len(got.Stages) != 8 {
		t.Fatalf("order/normalization = %+v", got)
	}
	for _, s := range got.Stages[4:7] {
		if s.Kind != "custom" || uuid.MustParse(s.ID).Version() != 5 {
			t.Fatalf("custom = %+v", s)
		}
	}
	noop, err := pipelineconfig.Replace(got, replacement(t, got), draftID, 1)
	if err != nil || !got.Equal(noop) {
		t.Fatalf("no-op = %+v %v", noop, err)
	}
	four := strings.Replace(string(replacement(t, got)), placement, `{"name":"Cuatro"},`+placement, 1)
	if _, err := pipelineconfig.Replace(got, []byte(four), draftID, 1); !errors.Is(err, drafts.ErrValidation) {
		t.Fatalf("four custom = %v", err)
	}
	removed, err := pipelineconfig.Replace(got, replacement(t, base), draftID, 1)
	if err != nil || len(removed.Retired) != 3 || removed.Retired[0].Stage != got.Stages[4] || removed.Retired[0].Position != 4 {
		t.Fatalf("remove custom = %+v %v", removed, err)
	}
	if _, err := pipelineconfig.Replace(removed, replacement(t, got), draftID, 2); !errors.Is(err, drafts.ErrValidation) {
		t.Fatalf("removed ids cannot be resurrected: %v", err)
	}
	if base.Equal(got) {
		t.Fatal("changes must not compare equal")
	}
}
