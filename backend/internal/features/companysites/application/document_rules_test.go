package application

import (
	"fmt"
	"strings"
	"testing"

	"bytes"
	"encoding/json"
	"github.com/google/uuid"
)

// Test capabilities intentionally do not implement the shared rich grammar;
// cmd/api tests exercise the real decoder and rich-text adapter together.
func testDecode(raw []byte) (any, error) {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	err := decoder.Decode(&value)
	return value, err
}
func fakeRich(value any) (*RichDocument, error) {
	if value == nil {
		return nil, nil
	}
	m, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid test rich value")
	}
	var plain strings.Builder
	var walk func(any)
	walk = func(x any) {
		switch n := x.(type) {
		case map[string]any:
			if s, ok := n["text"].(string); ok {
				plain.WriteString(s)
			}
			walk(n["content"])
			walk(n["document"])
		case []any:
			for _, child := range n {
				walk(child)
			}
		}
	}
	walk(m)
	canonical, err := json.Marshal(value)
	return &RichDocument{Canonical: canonical, Plain: plain.String()}, err
}
func ValidateDocument(value any) (*Document, []Field) {
	return NewValidator(fakeRich).ValidateDocument(value)
}

func block(kind, variant string, content map[string]any) map[string]any {
	return map[string]any{"id": uuid.NewString(), "type": kind, "variant": variant, "hidden": false, "content": content}
}
func validateExtra(t *testing.T, b map[string]any) (*Document, []Field) {
	t.Helper()
	m := input(t)
	m["blocks"] = append(m["blocks"].([]any), b)
	return ValidateDocument(m)
}
func hasField(fs []Field, p, c string) bool {
	for _, f := range fs {
		if f.Field == p && f.Code == c {
			return true
		}
	}
	return false
}
func TestDocumentStringLimits(t *testing.T) {
	cases := []struct {
		kind, variant, key string
		max                int
		item               bool
	}{
		{"hero", "photo", "title", 80, false}, {"hero", "photo", "subtitle", 200, false},
		{"story", "text", "title", 80, false}, {"values", "grid", "mission", 300, false},
		{"values", "grid", "title", 60, true}, {"values", "grid", "description", 240, true},
		{"benefits", "grid", "title", 60, true}, {"benefits", "grid", "description", 160, true},
		{"stats", "row", "value", 12, true}, {"stats", "row", "label", 60, true},
		{"process", "steps", "title", 60, true}, {"process", "steps", "description", 200, true}, {"process", "steps", "duration", 30, true},
		{"gallery", "grid", "alt", 160, true}, {"gallery", "grid", "caption", 120, true},
		{"testimonials", "cards", "quote", 400, true}, {"testimonials", "cards", "name", 80, true}, {"testimonials", "cards", "role", 80, true},
		{"video", "wide", "title", 80, false}, {"video", "wide", "description", 200, false},
		{"offices", "list", "name", 80, true}, {"offices", "list", "address", 200, true},
		{"jobs", "list", "title", 80, false}, {"jobs", "list", "intro", 200, false},
		{"faq", "accordion", "question", 160, true}, {"faq", "accordion", "answer", 1000, true},
		{"closing", "simple", "title", 80, false}, {"closing", "simple", "text", 240, false},
	}
	for _, tt := range cases {
		t.Run(tt.kind+"/"+tt.key, func(t *testing.T) {
			for _, over := range []int{0, 1} {
				m := input(t)
				content := map[string]any{}
				target := content
				p := "blocks[2].content"
				if tt.item {
					target = map[string]any{}
					content["items"] = []any{target}
					p += ".items[0]"
				}
				target[tt.key] = "  " + strings.Repeat("界", tt.max+over) + "  "
				b := block(tt.kind, tt.variant, content)
				if tt.kind == "hero" {
					m["blocks"].([]any)[0] = b
					p = "blocks[0].content"
				} else if tt.kind == "jobs" {
					m["blocks"].([]any)[1] = b
					p = "blocks[1].content"
				} else {
					m["blocks"] = append(m["blocks"].([]any), b)
				}
				_, fs := ValidateDocument(m)
				if over == 0 && len(fs) > 0 {
					t.Fatalf("boundary: %v", fs)
				}
				if over == 1 && !hasField(fs, p+"."+tt.key, "too_long") {
					t.Fatalf("over: %v", fs)
				}
			}
		})
	}
}
func TestMapURLLimitAndMediaTrimming(t *testing.T) {
	for _, n := range []int{500, 501} {
		url := "https://example.com/" + strings.Repeat("a", n-len("https://example.com/"))
		_, fields := validateExtra(t, block("offices", "list", map[string]any{"items": []any{map[string]any{"map_url": url}}}))
		if n == 500 && len(fields) > 0 {
			t.Fatal(fields)
		}
		if n == 501 && !hasField(fields, "blocks[2].content.items[0].map_url", "too_long") {
			t.Fatal(fields)
		}
	}
	id := uuid.NewString()
	doc, fields := validateExtra(t, block("story", "text_image", map[string]any{"image": map[string]any{"media_id": "  " + id + "  "}}))
	if len(fields) > 0 || len(doc.Media) != 1 || doc.Media[0].ID != id || doc.Media[0].Kind != "story" {
		t.Fatal(fields, doc)
	}
}

func TestDocumentListLimits(t *testing.T) {
	for _, tt := range []struct {
		kind, variant string
		max           int
	}{{"values", "grid", 8}, {"benefits", "grid", 24}, {"stats", "row", 6}, {"process", "steps", 8}, {"gallery", "grid", 12}, {"testimonials", "cards", 6}, {"offices", "list", 20}, {"faq", "accordion", 20}} {
		t.Run(tt.kind, func(t *testing.T) {
			for _, n := range []int{0, tt.max, tt.max + 1} {
				items := []any{}
				for i := 0; i < n; i++ {
					items = append(items, map[string]any{})
				}
				_, fs := validateExtra(t, block(tt.kind, tt.variant, map[string]any{"items": items}))
				if n <= tt.max && len(fs) > 0 {
					t.Fatal(fs)
				}
				if n > tt.max && !hasField(fs, "blocks[2].content.items", "too_long") {
					t.Fatal(fs)
				}
			}
		})
	}
}
func TestDocumentFormats(t *testing.T) {
	tests := []struct {
		name, kind, variant string
		content             map[string]any
		field, code         string
	}{
		{"false consent", "testimonials", "cards", map[string]any{"items": []any{map[string]any{"consent": false}}}, "", ""},
		{"bad consent", "testimonials", "cards", map[string]any{"items": []any{map[string]any{"consent": "true"}}}, "blocks[2].content.items[0].consent", "invalid"},
		{"bad icon", "values", "grid", map[string]any{"items": []any{map[string]any{"icon": "other"}}}, "blocks[2].content.items[0].icon", "invalid"},
		{"unknown item key", "values", "grid", map[string]any{"items": []any{map[string]any{"extra": true}}}, "blocks[2].content.items[0].extra", "unknown_key"},
		{"unknown content key", "closing", "banner", map[string]any{"items": []any{}}, "blocks[2].content.items", "unknown_key"},
		{"youtube", "video", "wide", map[string]any{"video": map[string]any{"provider": "youtube", "video_id": "abcdefgh_-1"}}, "", ""},
		{"bad youtube", "video", "wide", map[string]any{"video": map[string]any{"provider": "youtube", "video_id": "short"}}, "blocks[2].content.video.video_id", "invalid"},
		{"vimeo", "video", "wide", map[string]any{"video": map[string]any{"provider": "vimeo", "video_id": "123456789012"}}, "", ""},
		{"bad vimeo", "video", "wide", map[string]any{"video": map[string]any{"provider": "vimeo", "video_id": "letters"}}, "blocks[2].content.video.video_id", "invalid"},
		{"bad provider", "video", "wide", map[string]any{"video": map[string]any{"provider": "other", "video_id": "123"}}, "blocks[2].content.video.provider", "invalid"},
		{"http map", "offices", "list", map[string]any{"items": []any{map[string]any{"map_url": "http://example.com"}}}, "blocks[2].content.items[0].map_url", "invalid"},
		{"https map", "offices", "cards", map[string]any{"items": []any{map[string]any{"map_url": "https://example.com"}}}, "", ""},
		{"unknown location", "offices", "list", map[string]any{"items": []any{map[string]any{"location": map[string]any{"extra": true}}}}, "blocks[2].content.items[0].location.extra", "unknown_key"},
		{"bad media", "gallery", "grid", map[string]any{"items": []any{map[string]any{"image": map[string]any{"media_id": "bad"}}}}, "blocks[2].content.items[0].image.media_id", "invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, fs := validateExtra(t, block(tt.kind, tt.variant, tt.content))
			if tt.code == "" {
				if len(fs) > 0 {
					t.Fatal(fs)
				}
			} else if !hasField(fs, tt.field, tt.code) {
				t.Fatal(fs)
			}
		})
	}
}
func TestDocumentAllVariantsAndStructuralRules(t *testing.T) {
	for kind, rule := range rules {
		for _, variant := range rule.variants {
			t.Run(kind+"/"+variant, func(t *testing.T) {
				m := input(t)
				b := block(kind, variant, map[string]any{})
				if kind == "hero" {
					m["blocks"].([]any)[0] = b
				} else if kind == "jobs" {
					m["blocks"].([]any)[1] = b
				} else {
					m["blocks"] = append(m["blocks"].([]any), b)
				}
				if _, fs := ValidateDocument(m); len(fs) > 0 {
					t.Fatal(fs)
				}
			})
		}
	}
	for _, n := range []int{30, 31} {
		m := input(t)
		for len(m["blocks"].([]any)) < n {
			m["blocks"] = append(m["blocks"].([]any), block("closing", "simple", map[string]any{}))
		}
		_, fs := ValidateDocument(m)
		if n == 30 && len(fs) > 0 {
			t.Fatal(fs)
		}
		if n == 31 && !hasField(fs, "blocks", "too_long") {
			t.Fatal(fs)
		}
	}
}
func TestDocumentCanonicalAndSlug(t *testing.T) {
	for _, tt := range []struct{ slug, reason string }{{"abc", ""}, {strings.Repeat("a", 60), ""}, {"ab", "invalid"}, {strings.Repeat("a", 61), "invalid"}, {"foo--bar", "invalid"}, {"-foo", "invalid"}, {"ABC", "invalid"}} {
		t.Run(tt.slug, func(t *testing.T) {
			if got := SlugReason(tt.slug); got != tt.reason {
				t.Fatal(got)
			}
		})
	}
	for _, s := range strings.Fields("admin api empresa empresas vacantes candidato login nuevo nueva peopleflow soporte ayuda") {
		if SlugReason(s) != "reserved" {
			t.Fatal(s)
		}
	}
	m := input(t)
	m["theme"].(map[string]any)["brand_color"] = "#abcdef"
	m["seo"].(map[string]any)["title"] = "  "
	doc, fs := ValidateDocument(m)
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	if text(doc.Value["theme"].(map[string]any), "brand_color") != "#ABCDEF" || doc.Value["seo"].(map[string]any)["title"] != nil {
		t.Fatal(string(doc.Canonical))
	}
	decoded, err := testDecode(doc.Canonical)
	if err != nil {
		t.Fatal(err)
	}
	again, fs := ValidateDocument(decoded)
	if len(fs) > 0 || string(again.Canonical) != string(doc.Canonical) {
		t.Fatal(fs)
	}
}
func rich(t *testing.T, n int) any {
	t.Helper()
	raw := fmt.Sprintf(`{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}}`, strings.Repeat("界", n))
	v, err := testDecode([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func TestStoryPlainLimit(t *testing.T) {
	for _, n := range []int{5000, 5001} {
		doc, fs := validateExtra(t, block("story", "text", map[string]any{"body": rich(t, n)}))
		if n == 5000 {
			if len(fs) > 0 {
				t.Fatal(fs)
			}
			if len(PublishIssues(doc, true, true)) != 2 {
				t.Fatal(PublishIssues(doc, true, true))
			}
		} else if !hasField(fs, "blocks[2].content.body", "too_long") {
			t.Fatal(fs)
		}
	}
}
func TestPublishRequirements(t *testing.T) {
	cases := []struct {
		kind, variant string
		content       map[string]any
	}{
		{"story", "text", map[string]any{"body": rich(t, 1)}},
		{"values", "grid", map[string]any{"items": []any{map[string]any{"title": "a"}}}},
		{"benefits", "grid", map[string]any{"items": []any{map[string]any{"title": "a"}}}},
		{"stats", "row", map[string]any{"items": []any{map[string]any{"value": "1", "label": "a"}}}},
		{"process", "steps", map[string]any{"items": []any{map[string]any{"title": "a"}, map[string]any{"title": "b"}}}},
		{"gallery", "grid", map[string]any{"items": []any{map[string]any{"alt": "a", "image": map[string]any{"media_id": uuid.NewString()}}, map[string]any{"alt": "b", "image": map[string]any{"media_id": uuid.NewString()}}}}},
		{"testimonials", "cards", map[string]any{"items": []any{map[string]any{"quote": "a", "name": "b", "consent": true}}}},
		{"video", "wide", map[string]any{"video": map[string]any{"provider": "vimeo", "video_id": "1"}}},
		{"offices", "list", map[string]any{"items": []any{map[string]any{"name": "a", "location": map[string]any{"country": "MX"}}}}},
		{"faq", "accordion", map[string]any{"items": []any{map[string]any{"question": "a", "answer": "b"}}}},
		{"closing", "simple", map[string]any{"title": "a"}},
	}
	for _, tt := range cases {
		t.Run(tt.kind, func(t *testing.T) {
			for _, complete := range []bool{false, true} {
				c := map[string]any{}
				if complete {
					c = tt.content
				}
				doc, fs := validateExtra(t, block(tt.kind, tt.variant, c))
				if len(fs) > 0 {
					t.Fatal(fs)
				}
				issues := PublishIssues(doc, true, true)
				found := false
				for _, issue := range issues {
					if issue.Code == "block_incomplete" {
						found = true
						if issue.Field == nil || *issue.Field != "blocks[2]" {
							t.Fatal(issue)
						}
					}
				}
				if found == complete {
					t.Fatal(issues)
				}
				doc.Value["blocks"].([]any)[2].(map[string]any)["hidden"] = true
				for _, issue := range PublishIssues(doc, true, true) {
					if issue.Code == "block_incomplete" {
						t.Fatal(issue)
					}
				}
			}
		})
	}
	doc, fs := validateExtra(t, block("testimonials", "cards", map[string]any{"items": []any{map[string]any{"quote": "a", "name": "b", "consent": false}}}))
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	found := false
	for _, issue := range PublishIssues(doc, true, true) {
		if issue.Code == "block_incomplete" {
			found = true
		}
	}
	if !found {
		t.Fatal("false consent must block publication")
	}
}
