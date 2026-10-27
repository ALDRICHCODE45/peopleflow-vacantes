package application

import (
	"encoding/json"
	"strings"
	"testing"
)

func input(t *testing.T) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(DefaultDocument(), &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func TestValidateDocument(t *testing.T) {
	tests := []struct {
		name        string
		change      func(map[string]any)
		field, code string
	}{
		{"defaults", func(m map[string]any) {}, "", ""},
		{"slug format", func(m map[string]any) { m["slug"] = "Bad" }, "slug", "invalid"},
		{"unknown", func(m map[string]any) { m["extra"] = true }, "extra", "unknown_key"},
		{"unicode boundary", func(m map[string]any) { m["seo"].(map[string]any)["title"] = strings.Repeat("界", 60) }, "", ""},
		{"unicode over", func(m map[string]any) { m["seo"].(map[string]any)["title"] = strings.Repeat("界", 61) }, "seo.title", "too_long"},
		{"hidden hero", func(m map[string]any) { m["blocks"].([]any)[0].(map[string]any)["hidden"] = true }, "blocks[0].hidden", "not_allowed"},
		{"duplicate id", func(m map[string]any) {
			b := m["blocks"].([]any)
			b[1].(map[string]any)["id"] = b[0].(map[string]any)["id"]
		}, "blocks[1].id", "duplicate"},
		{"missing jobs", func(m map[string]any) { m["blocks"] = m["blocks"].([]any)[:1] }, "blocks", "required"},
		{"missing hero", func(m map[string]any) { m["blocks"] = m["blocks"].([]any)[1:] }, "blocks", "required"},
		{"invalid uuid", func(m map[string]any) { m["blocks"].([]any)[0].(map[string]any)["id"] = "not-a-uuid" }, "blocks[0].id", "invalid"},
		{"unknown block key", func(m map[string]any) { m["blocks"].([]any)[0].(map[string]any)["extra"] = true }, "blocks[0].extra", "unknown_key"},
		{"invalid variant", func(m map[string]any) { m["blocks"].([]any)[0].(map[string]any)["variant"] = "other" }, "blocks[0].variant", "invalid"},
		{"hidden jobs", func(m map[string]any) { m["blocks"].([]any)[1].(map[string]any)["hidden"] = true }, "blocks[1].hidden", "not_allowed"},
		{"invalid color", func(m map[string]any) { m["theme"].(map[string]any)["brand_color"] = "#abc" }, "theme.brand_color", "invalid"},
		{"invalid font", func(m map[string]any) { m["theme"].(map[string]any)["font_pair"] = "other" }, "theme.font_pair", "invalid"},
		{"unknown theme key", func(m map[string]any) { m["theme"].(map[string]any)["extra"] = true }, "theme.extra", "unknown_key"},
		{"description boundary", func(m map[string]any) { m["seo"].(map[string]any)["description"] = strings.Repeat("界", 160) }, "", ""},
		{"description over", func(m map[string]any) { m["seo"].(map[string]any)["description"] = strings.Repeat("界", 161) }, "seo.description", "too_long"},
		{"unknown seo key", func(m map[string]any) { m["seo"].(map[string]any)["extra"] = true }, "seo.extra", "unknown_key"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := input(t)
			tt.change(m)
			_, fields := ValidateDocument(m)
			if tt.code == "" {
				if len(fields) > 0 {
					t.Fatal(fields)
				}
				return
			}
			for _, f := range fields {
				if f.Field == tt.field && f.Code == tt.code {
					return
				}
			}
			t.Fatalf("missing %s/%s: %+v", tt.field, tt.code, fields)
		})
	}
}
func TestPublishIssues(t *testing.T) {
	doc, fields := ValidateDocument(input(t))
	if len(fields) != 0 {
		t.Fatal(fields)
	}
	got := PublishIssues(doc, false, false)
	for _, code := range []string{"slug_missing", "hero_title_missing", "no_content_block", "company_logo_missing", "company_name_missing"} {
		found := false
		for _, v := range got {
			if v.Code == code {
				found = true
			}
		}
		if !found {
			t.Errorf("missing %s: %+v", code, got)
		}
	}
}
