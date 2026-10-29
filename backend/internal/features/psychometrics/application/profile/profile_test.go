package profile_test

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/profile"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
)

func body(t *testing.T, p profile.Profile) map[string]any {
	t.Helper()
	b, _ := json.Marshal(p)
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	delete(m, "confirmed_at")
	return m
}
func encoded(m map[string]any) []byte { b, _ := json.Marshal(m); return b }
func TestDefaultsAndReplacement(t *testing.T) {
	p := profile.Empty()
	a, err := content.Load(content.Version)
	if err != nil {
		t.Fatal(err)
	}
	d := a.Snapshot()
	if p.Test != "ipip60-mx" || p.Enabled || p.Confirmed || p.ConfirmedAt != nil || p.ExpiresInDays != 7 || len(p.AutoSendStageIDs) != 0 || len(p.Competencies) != 7 {
		t.Fatal(p)
	}
	for i, c := range p.Competencies {
		if c.CompetencyID != d.Competencies[i].ID || c.Importance != "importance.no_relevante" || c.DesiredBand != nil || c.Rationale != "" || c.Task != nil {
			t.Fatal(c)
		}
	}
	next, err := profile.Replace(encoded(body(t, p)), nil)
	if err != nil || !reflect.DeepEqual(p, next) {
		t.Fatal(next, err)
	}
}

func TestValidationRules(t *testing.T) {
	cases := []struct {
		name, field, code string
		change            func(map[string]any)
	}{
		{"missing enabled", "enabled", "required", func(m map[string]any) { delete(m, "enabled") }},
		{"unknown", "extra", "not_allowed", func(m map[string]any) { m["extra"] = true }},
		{"version owned", "version", "not_allowed", func(m map[string]any) { m["version"] = "0" }},
		{"timestamp owned", "confirmed_at", "not_allowed", func(m map[string]any) { m["confirmed_at"] = nil }},
		{"test", "test", "invalid", func(m map[string]any) { m["test"] = "other" }},
		{"expiry low", "expires_in_days", "invalid", func(m map[string]any) { m["expires_in_days"] = 0 }},
		{"expiry high", "expires_in_days", "invalid", func(m map[string]any) { m["expires_in_days"] = 31 }},
		{"expiry fraction", "expires_in_days", "invalid", func(m map[string]any) { m["expires_in_days"] = 1.5 }},
		{"missing catalog", "competencies", "required", func(m map[string]any) { m["competencies"] = m["competencies"].([]any)[:6] }},
		{"duplicate catalog", "competencies[6].competency_id", "duplicate", func(m map[string]any) {
			cs := m["competencies"].([]any)
			cs[6].(map[string]any)["competency_id"] = cs[0].(map[string]any)["competency_id"]
		}},
		{"unknown catalog", "competencies[0].competency_id", "invalid", func(m map[string]any) { entry(m)["competency_id"] = "comp.unknown" }},
		{"importance", "competencies[0].importance", "invalid", func(m map[string]any) { entry(m)["importance"] = "clave" }},
		{"irrelevant band", "competencies[0].desired_band", "invalid", func(m map[string]any) { entry(m)["desired_band"] = "band.high" }},
		{"relevant band required", "competencies[0].desired_band", "required", func(m map[string]any) { entry(m)["importance"] = "importance.importante" }},
		{"band canonical", "competencies[0].desired_band", "invalid", func(m map[string]any) {
			entry(m)["importance"] = "importance.importante"
			entry(m)["desired_band"] = "high"
		}},
		{"rationale required", "competencies[0].rationale", "required", func(m map[string]any) { confirm(m); entry(m)["rationale"] = "  " }},
		{"rationale long", "competencies[0].rationale", "too_long", func(m map[string]any) { entry(m)["rationale"] = strings.Repeat("á", 1001) }},
		{"key task required", "competencies[0].task", "required", func(m map[string]any) {
			confirm(m)
			entry(m)["importance"] = "importance.clave"
			entry(m)["desired_band"] = "band.low"
		}},
		{"task long", "competencies[0].task", "too_long", func(m map[string]any) { entry(m)["task"] = strings.Repeat("á", 301) }},
		{"optional task empty on confirmation", "competencies[0].task", "required", func(m map[string]any) { confirm(m); entry(m)["task"] = " " }},
		{"unknown entry key", "competencies[0].extra", "not_allowed", func(m map[string]any) { entry(m)["extra"] = false }},
		{"exit or retired stage", "auto_send_stage_ids[0]", "invalid", func(m map[string]any) { m["auto_send_stage_ids"] = []string{"exit"} }},
		{"duplicate stage", "auto_send_stage_ids[1]", "duplicate", func(m map[string]any) { m["auto_send_stage_ids"] = []string{"stage", "stage"} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := body(t, profile.Empty())
			tc.change(m)
			_, err := profile.Replace(encoded(m), []string{"stage"})
			inv, ok := err.(*profile.Invalid)
			if !ok {
				t.Fatalf("error=%v", err)
			}
			found := false
			for _, f := range inv.Fields {
				if f.Field == tc.field && f.Code == tc.code {
					found = true
				}
			}
			if !found {
				t.Fatalf("fields=%v want=%s %s", inv.Fields, tc.field, tc.code)
			}
		})
	}
}
func entry(m map[string]any) map[string]any { return m["competencies"].([]any)[0].(map[string]any) }
func confirm(m map[string]any) {
	m["confirmed"] = true
	for _, c := range m["competencies"].([]any) {
		c.(map[string]any)["rationale"] = "Trabajo"
	}
}
func TestTrimUnicodeBoundariesAndDrafts(t *testing.T) {
	for _, days := range []int{1, 30} {
		m := body(t, profile.Empty())
		confirm(m)
		entry(m)["importance"] = "importance.clave"
		entry(m)["desired_band"] = "band.high"
		entry(m)["rationale"] = "  " + strings.Repeat("á", 1000) + "  "
		entry(m)["task"] = " " + strings.Repeat("ñ", 300) + " "
		m["expires_in_days"] = days
		p, err := profile.Replace(encoded(m), nil)
		if err != nil || len([]rune(p.Competencies[0].Rationale)) != 1000 || len([]rune(*p.Competencies[0].Task)) != 300 {
			t.Fatal(p, err)
		}
	}
	m := body(t, profile.Empty())
	entry(m)["importance"] = "importance.clave"
	entry(m)["desired_band"] = "band.low"
	entry(m)["task"] = " "
	if _, err := profile.Replace(encoded(m), nil); err != nil {
		t.Fatal(err)
	}
}
func TestMalformedAndExactJSON(t *testing.T) {
	for _, b := range []string{`null`, `[]`, `{} {}`, `{"enabled":true,"enabled":false}`, `{"competencies":[{"task":null,"task":"x"}]}`} {
		if _, err := profile.Replace([]byte(b), nil); err == nil {
			t.Fatalf("accepted %s", b)
		}
	}
}
