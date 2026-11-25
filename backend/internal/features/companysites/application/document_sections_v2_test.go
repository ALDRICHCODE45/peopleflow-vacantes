package application

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Sections v2 (slice A): new variants, new block types, per-block style, hero
// button and collage fields, testimonial video URLs. Keys added to existing
// envelopes/types are never inserted when absent (wire rule, task L4 §9); the
// validation and publish logic treat absent as the documented default.

func ref() map[string]any { return map[string]any{"media_id": uuid.NewString()} }

func hero(m map[string]any) map[string]any { return m["blocks"].([]any)[0].(map[string]any) }

func validateStored(value any) (*Document, []Field) {
	return NewValidator(fakeRich).ValidateStoredDocument(value)
}

func issueSet(issues []Issue) map[string]bool {
	out := map[string]bool{}
	for _, issue := range issues {
		field := ""
		if issue.Field != nil {
			field = *issue.Field
		}
		out[issue.Code+"@"+field] = true
	}
	return out
}

func TestSectionsV2Variants(t *testing.T) {
	for kind, variants := range map[string][]string{
		"hero":         {"background_loop", "photo_jobs", "collage"},
		"benefits":     {"bento", "big_icons"},
		"values":       {"bento", "big_icons"},
		"stats":        {"brand_band"},
		"testimonials": {"carousel"},
		"gallery":      {"photo_strip"},
		"team":         {"grid", "portraits"},
		"logos":        {"strip", "grid"},
		"areas":        {"icon_cards", "photo_cards"},
		"talent_cta":   {"banner", "split"},
	} {
		for _, variant := range variants {
			t.Run(kind+"/"+variant, func(t *testing.T) {
				m := input(t)
				b := block(kind, variant, map[string]any{})
				if kind == "hero" {
					m["blocks"].([]any)[0] = b
				} else {
					m["blocks"] = append(m["blocks"].([]any), b)
				}
				if _, fs := ValidateDocument(m); len(fs) > 0 {
					t.Fatal(fs)
				}
			})
		}
	}
	for _, tt := range []struct{ kind, variant string }{{"team", "cards"}, {"logos", "carousel"}, {"areas", "list"}, {"talent_cta", "simple"}, {"stats", "bento"}} {
		_, fs := validateExtra(t, block(tt.kind, tt.variant, map[string]any{}))
		if !hasField(fs, "blocks[2].variant", "invalid") {
			t.Fatal(tt, fs)
		}
	}
}

func TestSectionsV2NewTypeLimits(t *testing.T) {
	cases := []struct {
		kind, variant, key string
		max                int
		item               bool
	}{
		{"team", "grid", "title", 80, false}, {"team", "grid", "intro", 200, false},
		{"team", "grid", "name", 80, true}, {"team", "grid", "role", 80, true},
		{"logos", "strip", "title", 80, false}, {"logos", "strip", "name", 80, true}, {"logos", "strip", "caption", 80, true},
		{"areas", "icon_cards", "title", 80, false}, {"areas", "icon_cards", "intro", 200, false},
		{"talent_cta", "banner", "title", 80, false}, {"talent_cta", "banner", "text", 240, false}, {"talent_cta", "banner", "button_label", 24, false},
	}
	for _, tt := range cases {
		t.Run(tt.kind+"/"+tt.key, func(t *testing.T) {
			for _, over := range []int{0, 1} {
				content := map[string]any{}
				target := content
				p := "blocks[2].content"
				if tt.item {
					target = map[string]any{}
					content["items"] = []any{target}
					p += ".items[0]"
				}
				target[tt.key] = " " + strings.Repeat("界", tt.max+over) + " "
				_, fs := validateExtra(t, block(tt.kind, tt.variant, content))
				if over == 0 && len(fs) > 0 {
					t.Fatalf("boundary: %v", fs)
				}
				if over == 1 && !hasField(fs, p+"."+tt.key, "too_long") {
					t.Fatalf("over: %v", fs)
				}
			}
		})
	}
	for _, tt := range []struct {
		kind, variant, key string
		max                int
		item               func(int) map[string]any
	}{
		{"team", "grid", "items", 12, func(int) map[string]any { return map[string]any{} }},
		{"logos", "grid", "items", 12, func(int) map[string]any { return map[string]any{} }},
		{"areas", "icon_cards", "overrides", 16, func(i int) map[string]any {
			return map[string]any{"key": ProfessionalAreas[i%len(ProfessionalAreas)], "icon": "heart"}
		}},
	} {
		t.Run(tt.kind+"/"+tt.key, func(t *testing.T) {
			for _, n := range []int{0, tt.max, tt.max + 1} {
				items := []any{}
				for i := 0; i < n; i++ {
					items = append(items, tt.item(i))
				}
				_, fs := validateExtra(t, block(tt.kind, tt.variant, map[string]any{tt.key: items}))
				if n <= tt.max && len(fs) > 0 {
					t.Fatal(n, fs)
				}
				if n > tt.max && !hasField(fs, "blocks[2].content."+tt.key, "too_long") {
					t.Fatal(n, fs)
				}
			}
		})
	}
	// New block types normalize like every other block.
	doc, fs := validateExtra(t, block("areas", "icon_cards", map[string]any{}))
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	if got := doc.Value["blocks"].([]any)[2].(map[string]any)["content"]; !reflect.DeepEqual(got, map[string]any{"title": nil, "intro": nil, "overrides": []any{}}) {
		t.Fatal(got)
	}
}

func TestSectionsV2MediaKinds(t *testing.T) {
	m := input(t)
	h := hero(m)
	h["variant"] = "collage"
	h["content"] = map[string]any{"cover": ref(), "images": []any{ref(), ref(), ref()}}
	h["style"] = map[string]any{"background": "image", "image": ref()}
	m["blocks"] = append(m["blocks"].([]any),
		block("team", "grid", map[string]any{"items": []any{map[string]any{"name": "Ana", "photo": ref(), "consent": true}}}),
		block("logos", "strip", map[string]any{"items": []any{map[string]any{"name": "ISO", "image": ref()}}}),
		block("areas", "photo_cards", map[string]any{"overrides": []any{map[string]any{"key": "engineering", "photo": ref()}}}),
	)
	doc, fs := ValidateDocument(m)
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	got := map[string]string{}
	for _, r := range doc.Media {
		got[r.Field] = r.Kind
	}
	want := map[string]string{
		"blocks[0].content.cover":              "cover",
		"blocks[0].content.images[0]":          "gallery",
		"blocks[0].content.images[1]":          "gallery",
		"blocks[0].content.images[2]":          "gallery",
		"blocks[0].style.image":                "cover",
		"blocks[2].content.items[0].photo":     "portrait",
		"blocks[3].content.items[0].image":     "logo",
		"blocks[4].content.overrides[0].photo": "gallery",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("media refs %v", got)
	}
}

func TestSectionsV2Style(t *testing.T) {
	tests := []struct {
		name        string
		style       any
		field, code string
	}{
		{"tint", map[string]any{"background": "tint", "spacing": "compact", "align": "center"}, "", ""},
		{"brand", map[string]any{"background": "brand", "overlay": nil, "image": nil}, "", ""},
		{"image", map[string]any{"background": "image", "overlay": "strong", "image": ref()}, "", ""},
		{"image no overlay", map[string]any{"background": "image", "image": ref()}, "", ""},
		{"image background without image saves", map[string]any{"background": "image", "overlay": "soft"}, "", ""},
		{"bad background", map[string]any{"background": "video"}, "blocks[2].style.background", "invalid"},
		{"null background", map[string]any{"background": nil}, "blocks[2].style.background", "invalid"},
		{"bad spacing", map[string]any{"spacing": "huge"}, "blocks[2].style.spacing", "invalid"},
		{"bad align", map[string]any{"align": "left"}, "blocks[2].style.align", "invalid"},
		{"bad overlay", map[string]any{"background": "image", "image": ref(), "overlay": "dark"}, "blocks[2].style.overlay", "invalid"},
		{"overlay without image background", map[string]any{"background": "tint", "overlay": "soft"}, "blocks[2].style.overlay", "not_allowed"},
		{"image without image background", map[string]any{"image": ref()}, "blocks[2].style.image", "not_allowed"},
		{"bad image ref", map[string]any{"background": "image", "image": map[string]any{"media_id": "nope"}}, "blocks[2].style.image.media_id", "invalid"},
		{"unknown style key", map[string]any{"color": "#000000"}, "blocks[2].style.color", "unknown_key"},
		{"style not object", "tint", "blocks[2].style", "invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := block("closing", "simple", map[string]any{})
			b["style"] = tt.style
			doc, fs := validateExtra(t, b)
			if tt.code == "" {
				if len(fs) > 0 {
					t.Fatal(fs)
				}
				style := doc.Value["blocks"].([]any)[2].(map[string]any)["style"].(map[string]any)
				if len(style) != 5 {
					t.Fatal(style)
				}
				return
			}
			if !hasField(fs, tt.field, tt.code) {
				t.Fatal(fs)
			}
		})
	}
	// Absent style stays absent (= DefaultStyle); null is dropped.
	m := input(t)
	b := block("closing", "simple", map[string]any{})
	b["style"] = nil
	m["blocks"] = append(m["blocks"].([]any), b)
	doc, fs := ValidateDocument(m)
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	for _, x := range doc.Value["blocks"].([]any) {
		if _, ok := x.(map[string]any)["style"]; ok {
			t.Fatal(x)
		}
	}
	// A present style fills only its missing keys with the defaults.
	b = block("closing", "simple", map[string]any{})
	b["style"] = map[string]any{"spacing": "compact"}
	doc, fs = validateExtra(t, b)
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	want := DefaultStyle()
	want["spacing"] = "compact"
	if got := doc.Value["blocks"].([]any)[2].(map[string]any)["style"]; !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
}

func TestSectionsV2HeroFields(t *testing.T) {
	newKeys := []string{"images", "primary_label", "secondary_visible", "secondary_label", "secondary_target"}
	cases := []struct {
		name        string
		content     map[string]any
		field, code string
		want        map[string]any
	}{
		{"absent stays absent", map[string]any{}, "", "", map[string]any{}},
		{"blank labels are null", map[string]any{"primary_label": "  ", "secondary_label": nil}, "", "", map[string]any{"primary_label": nil, "secondary_label": nil}},
		{"custom", map[string]any{"primary_label": " Únete ", "secondary_visible": false, "secondary_label": "Cultura"}, "", "", map[string]any{"primary_label": "Únete", "secondary_visible": false, "secondary_label": "Cultura"}},
		{"images null", map[string]any{"images": nil}, "", "", map[string]any{"images": []any{}}},
		{"primary boundary", map[string]any{"primary_label": strings.Repeat("界", 24)}, "", "", nil},
		{"primary over", map[string]any{"primary_label": strings.Repeat("界", 25)}, "blocks[0].content.primary_label", "too_long", nil},
		{"secondary over", map[string]any{"secondary_label": strings.Repeat("a", 25)}, "blocks[0].content.secondary_label", "too_long", nil},
		{"visible not bool", map[string]any{"secondary_visible": "yes"}, "blocks[0].content.secondary_visible", "invalid", nil},
		{"visible null", map[string]any{"secondary_visible": nil}, "blocks[0].content.secondary_visible", "invalid", nil},
		{"label not string", map[string]any{"primary_label": 3}, "blocks[0].content.primary_label", "invalid", nil},
		{"images boundary", map[string]any{"images": []any{ref(), ref(), ref()}}, "", "", nil},
		{"images over", map[string]any{"images": []any{ref(), ref(), ref(), ref()}}, "blocks[0].content.images", "too_long", nil},
		{"images not array", map[string]any{"images": ref()}, "blocks[0].content.images", "invalid", nil},
		{"images bad ref", map[string]any{"images": []any{map[string]any{"media_id": "x"}}}, "blocks[0].content.images[0].media_id", "invalid", nil},
		{"images null item", map[string]any{"images": []any{nil}}, "blocks[0].content.images[0]", "required", nil},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			m := input(t)
			hero(m)["content"] = tt.content
			doc, fs := ValidateDocument(m)
			if tt.code != "" {
				if !hasField(fs, tt.field, tt.code) {
					t.Fatal(fs)
				}
				return
			}
			if len(fs) > 0 {
				t.Fatal(fs)
			}
			if tt.want == nil {
				return
			}
			c := hero(doc.Value)["content"].(map[string]any)
			for _, k := range newKeys {
				want, expected := tt.want[k]
				got, present := c[k]
				if present != expected || !reflect.DeepEqual(got, want) {
					t.Fatalf("%s=%#v present=%v", k, got, present)
				}
			}
		})
	}
}

func TestSectionsV2SecondaryTarget(t *testing.T) {
	m := input(t)
	jobsID := m["blocks"].([]any)[1].(map[string]any)["id"].(string)
	hidden := block("closing", "simple", map[string]any{"title": "x"})
	hidden["hidden"] = true
	m["blocks"] = append(m["blocks"].([]any), hidden)
	for _, tt := range []struct {
		name   string
		target any
		code   string
	}{
		{"null", nil, ""},
		{"jobs", jobsID, ""},
		{"upper-case id", strings.ToUpper(jobsID), ""},
		{"hidden block", hidden["id"], ""},
		{"self", hero(m)["id"], "invalid"},
		{"unknown", uuid.NewString(), "invalid"},
		{"malformed", "not-a-uuid", "invalid"},
		{"number", 3, "invalid"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			raw, _ := json.Marshal(m)
			value, _ := testDecode(raw)
			hero(value.(map[string]any))["content"] = map[string]any{"secondary_target": tt.target}
			doc, fs := ValidateDocument(value)
			if tt.code != "" {
				if !hasField(fs, "blocks[0].content.secondary_target", tt.code) {
					t.Fatal(fs)
				}
				return
			}
			if len(fs) > 0 {
				t.Fatal(fs)
			}
			if s, ok := tt.target.(string); ok && hero(doc.Value)["content"].(map[string]any)["secondary_target"] != strings.ToLower(s) {
				t.Fatal(hero(doc.Value))
			}
		})
	}
	// A stored document whose target no longer exists (e.g. the public projection
	// dropped a hidden block) reads the target as null instead of failing.
	raw, _ := json.Marshal(m)
	value, _ := testDecode(raw)
	hero(value.(map[string]any))["content"] = map[string]any{"secondary_target": uuid.NewString()}
	doc, fs := validateStored(value)
	if len(fs) > 0 || hero(doc.Value)["content"].(map[string]any)["secondary_target"] != nil {
		t.Fatal(fs)
	}
}

func TestSectionsV2TestimonialVideoURL(t *testing.T) {
	for _, tt := range []struct {
		name, code string
		url        any
	}{
		{"youtube watch", "", "https://www.youtube.com/watch?v=abcdefgh_-1&t=3"},
		{"youtube embed", "", "https://youtube.com/embed/abcdefgh_-1"},
		{"youtube shorts", "", "https://www.youtube.com/shorts/abcdefgh_-1/"},
		{"youtu.be", "", " http://youtu.be/abcdefgh_-1 "},
		{"vimeo", "", "https://vimeo.com/76979871"},
		{"vimeo player", "", "https://player.vimeo.com/video/76979871"},
		{"upper-case host", "", "https://WWW.YOUTUBE.COM/watch?v=abcdefgh_-1"},
		{"null", "", nil},
		{"blank", "", "  "},
		{"short youtube id", "invalid", "https://youtu.be/short"},
		{"vimeo letters", "invalid", "https://vimeo.com/abc"},
		{"other host", "invalid", "https://example.com/watch?v=abcdefgh_-1"},
		{"lookalike host", "invalid", "https://youtube.com.evil.test/watch?v=abcdefgh_-1"},
		{"javascript", "invalid", "javascript:alert(1)"},
		{"credentials", "invalid", "https://user:pw@youtu.be/abcdefgh_-1"},
		{"port", "invalid", "https://youtu.be:8443/abcdefgh_-1"},
		{"iframe", "invalid", `<iframe src="https://youtu.be/abcdefgh_-1">`},
		{"object", "invalid", map[string]any{"provider": "youtube", "video_id": "abcdefgh_-1"}},
		{"too long", "too_long", "https://www.youtube.com/watch?v=abcdefgh_-1&x=" + strings.Repeat("a", 460)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			doc, fs := validateExtra(t, block("testimonials", "carousel", map[string]any{"items": []any{map[string]any{"quote": "q", "video_url": tt.url}}}))
			if tt.code != "" {
				if !hasField(fs, "blocks[2].content.items[0].video_url", tt.code) {
					t.Fatal(fs)
				}
				return
			}
			if len(fs) > 0 {
				t.Fatal(fs)
			}
			item := doc.Value["blocks"].([]any)[2].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)
			if s, _ := tt.url.(string); strings.TrimSpace(s) == "" && item["video_url"] != nil {
				t.Fatal(item)
			}
		})
	}
	// Absent stays absent.
	doc, fs := validateExtra(t, block("testimonials", "cards", map[string]any{"items": []any{map[string]any{"quote": "q"}}}))
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	if _, ok := doc.Value["blocks"].([]any)[2].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)["video_url"]; ok {
		t.Fatal("video_url inserted")
	}
}

func TestSectionsV2AreaOverrides(t *testing.T) {
	o := func(kv ...any) map[string]any {
		m := map[string]any{}
		for i := 0; i < len(kv); i += 2 {
			m[kv[i].(string)] = kv[i+1]
		}
		return m
	}
	for _, tt := range []struct {
		name        string
		overrides   any
		field, code string
	}{
		{"icon", []any{o("key", "engineering", "icon", "wrench", "photo", nil)}, "", ""},
		{"photo", []any{o("key", "healthcare", "photo", ref())}, "", ""},
		{"null list", nil, "", ""},
		{"every catalog key", func() []any {
			out := []any{}
			for _, a := range ProfessionalAreas {
				out = append(out, o("key", a, "icon", "heart"))
			}
			return out
		}(), "", ""},
		{"unknown key", []any{o("key", "astronaut", "icon", "heart")}, "blocks[2].content.overrides[0].key", "invalid"},
		{"missing key", []any{o("icon", "heart")}, "blocks[2].content.overrides[0].key", "required"},
		{"duplicate key", []any{o("key", "legal", "icon", "heart"), o("key", "legal", "photo", ref())}, "blocks[2].content.overrides[1].key", "duplicate"},
		{"both", []any{o("key", "legal", "icon", "heart", "photo", ref())}, "blocks[2].content.overrides[0].photo", "not_allowed"},
		{"neither", []any{o("key", "legal", "icon", nil)}, "blocks[2].content.overrides[0].icon", "required"},
		{"bad icon", []any{o("key", "legal", "icon", "nope")}, "blocks[2].content.overrides[0].icon", "invalid"},
		{"bad photo", []any{o("key", "legal", "photo", map[string]any{"media_id": "x"})}, "blocks[2].content.overrides[0].photo.media_id", "invalid"},
		{"unknown field", []any{o("key", "legal", "icon", "heart", "title", "x")}, "blocks[2].content.overrides[0].title", "unknown_key"},
		{"not a list", o("key", "legal"), "blocks[2].content.overrides", "invalid"},
		{"null item", []any{nil}, "blocks[2].content.overrides[0]", "required"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, fs := validateExtra(t, block("areas", "icon_cards", map[string]any{"overrides": tt.overrides}))
			if tt.code == "" && len(fs) > 0 || tt.code != "" && !hasField(fs, tt.field, tt.code) {
				t.Fatal(fs)
			}
		})
	}
	if len(ProfessionalAreas) != 16 {
		t.Fatal(ProfessionalAreas)
	}
}

func TestSectionsV2TeamLogosTalentFormats(t *testing.T) {
	for _, tt := range []struct {
		name, kind, variant string
		content             map[string]any
		field, code         string
	}{
		{"team consent type", "team", "grid", map[string]any{"items": []any{map[string]any{"consent": "yes"}}}, "blocks[2].content.items[0].consent", "invalid"},
		{"team unknown", "team", "grid", map[string]any{"items": []any{map[string]any{"quote": "x"}}}, "blocks[2].content.items[0].quote", "unknown_key"},
		{"logos unknown", "logos", "grid", map[string]any{"intro": "x"}, "blocks[2].content.intro", "unknown_key"},
		{"logos bad ref", "logos", "grid", map[string]any{"items": []any{map[string]any{"image": map[string]any{"media_id": 1}}}}, "blocks[2].content.items[0].image.media_id", "invalid"},
		{"talent items", "talent_cta", "split", map[string]any{"items": []any{}}, "blocks[2].content.items", "unknown_key"},
		{"areas items", "areas", "photo_cards", map[string]any{"items": []any{}}, "blocks[2].content.items", "unknown_key"},
		{"areas cover", "areas", "photo_cards", map[string]any{"cover": ref()}, "blocks[2].content.cover", "unknown_key"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, fs := validateExtra(t, block(tt.kind, tt.variant, tt.content))
			if !hasField(fs, tt.field, tt.code) {
				t.Fatal(fs)
			}
		})
	}
}

func TestSectionsV2PublishRules(t *testing.T) {
	cases := []struct {
		kind, variant string
		content       map[string]any
	}{
		{"team", "grid", map[string]any{"items": []any{map[string]any{"name": "Ana", "consent": true}}}},
		{"logos", "strip", map[string]any{"items": []any{map[string]any{"name": "ISO 9001", "image": ref()}}}},
		{"areas", "icon_cards", map[string]any{"title": "Áreas"}},
		{"talent_cta", "banner", map[string]any{"title": "¿No encontraste vacante?"}},
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
				if found := issueSet(PublishIssues(doc, true, true))["block_incomplete@blocks[2]"]; found == complete {
					t.Fatal(complete, PublishIssues(doc, true, true))
				}
			}
		})
	}
	for _, item := range []map[string]any{{"name": "Ana", "consent": false}, {"name": "Ana"}, {"consent": true}} {
		doc, fs := validateExtra(t, block("team", "portraits", map[string]any{"items": []any{item}}))
		if len(fs) > 0 {
			t.Fatal(fs)
		}
		if !issueSet(PublishIssues(doc, true, true))["block_incomplete@blocks[2]"] {
			t.Fatal("team item must block publication like testimonials", item)
		}
	}
	for _, item := range []map[string]any{{"name": "ISO"}, {"image": ref()}} {
		doc, _ := validateExtra(t, block("logos", "grid", map[string]any{"items": []any{item}}))
		if !issueSet(PublishIssues(doc, true, true))["block_incomplete@blocks[2]"] {
			t.Fatal("incomplete logo published", item)
		}
	}
	// Overrides never block an areas block; a titled areas block with none is complete.
	doc, _ := validateExtra(t, block("areas", "photo_cards", map[string]any{"title": "Áreas", "overrides": []any{}}))
	if issueSet(PublishIssues(doc, true, true))["block_incomplete@blocks[2]"] {
		t.Fatal(PublishIssues(doc, true, true))
	}
}

func publishable(t *testing.T) map[string]any {
	t.Helper()
	m := input(t)
	m["slug"] = "nexo"
	hero(m)["content"] = map[string]any{"title": "Únete"}
	m["blocks"] = append(m["blocks"].([]any), block("closing", "simple", map[string]any{"title": "x"}))
	return m
}

func issuesOf(t *testing.T, m map[string]any) map[string]bool {
	t.Helper()
	doc, fs := ValidateDocument(m)
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	return issueSet(PublishIssues(doc, true, true))
}

func TestSectionsV2HeroPublishIssues(t *testing.T) {
	m := publishable(t)
	h := hero(m)
	h["variant"] = "background_loop"
	if got := issuesOf(t, m); len(got) != 1 || !got["hero_video_missing@blocks[0]"] {
		t.Fatal(got)
	}
	h["variant"] = "photo_jobs"
	if got := issuesOf(t, m); len(got) != 0 {
		t.Fatal(got)
	}
	// Collage needs at least two images (absent = []).
	h["variant"] = "collage"
	for n, want := range map[int]bool{0: true, 1: true, 2: false, 3: false} {
		h["content"] = map[string]any{"title": "Únete"}
		if n > 0 {
			images := []any{}
			for i := 0; i < n; i++ {
				images = append(images, ref())
			}
			h["content"].(map[string]any)["images"] = images
		}
		if got := issuesOf(t, m); got["hero_collage_images_missing@blocks[0]"] != want || len(got) != map[bool]int{true: 1, false: 0}[want] {
			t.Fatal(n, got)
		}
	}
	// A hidden secondary target blocks publication only while the secondary
	// button shows (absent secondary_visible = true).
	h["variant"] = "photo"
	hidden := block("faq", "accordion", map[string]any{})
	hidden["hidden"] = true
	m["blocks"] = append(m["blocks"].([]any), hidden)
	for _, tt := range []struct {
		visible any
		issue   bool
	}{{nil, true}, {true, true}, {false, false}} {
		h["content"] = map[string]any{"title": "Únete", "secondary_target": hidden["id"]}
		if tt.visible != nil {
			h["content"].(map[string]any)["secondary_visible"] = tt.visible
		}
		got := issuesOf(t, m)
		if got["secondary_target_hidden@blocks[0].content.secondary_target"] != tt.issue || len(got) != map[bool]int{true: 1, false: 0}[tt.issue] {
			t.Fatal(tt, got)
		}
	}
	h["content"] = map[string]any{"title": "Únete", "secondary_target": m["blocks"].([]any)[1].(map[string]any)["id"]}
	if got := issuesOf(t, m); len(got) != 0 {
		t.Fatal(got)
	}
}

func TestSectionsV2StyleImagePublishIssue(t *testing.T) {
	m := publishable(t)
	blocks := m["blocks"].([]any)
	hero(m)["style"] = map[string]any{"background": "image"}
	blocks[1].(map[string]any)["style"] = map[string]any{"background": "image", "overlay": "soft"}
	blocks[2].(map[string]any)["style"] = map[string]any{"background": "image", "image": nil}
	hidden := block("closing", "simple", map[string]any{})
	hidden["hidden"] = true
	hidden["style"] = map[string]any{"background": "image"}
	m["blocks"] = append(blocks, hidden)
	got := issuesOf(t, m)
	want := map[string]bool{"style_image_missing@blocks[0].style.image": true, "style_image_missing@blocks[1].style.image": true, "style_image_missing@blocks[2].style.image": true}
	if !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
	hero(m)["style"].(map[string]any)["image"] = ref()
	m["blocks"].([]any)[1].(map[string]any)["style"] = map[string]any{"background": "tint"}
	delete(m["blocks"].([]any)[2].(map[string]any), "style")
	if got := issuesOf(t, m); len(got) != 0 {
		t.Fatal(got)
	}
}

// v1StoredDocument is a stored document written before slice A: no style, no
// hero button keys, no hero images, no testimonial video URL.
const v1StoredDocument = `{"blocks":[` +
	`{"content":{"cover":{"media_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},"subtitle":null,"title":"Únete"},"hidden":false,"id":"11111111-1111-4111-8111-111111111111","type":"hero","variant":"photo"},` +
	`{"content":{"intro":null,"title":null},"hidden":false,"id":"22222222-2222-4222-8222-222222222222","type":"jobs","variant":"list"},` +
	`{"content":{"items":[{"consent":true,"name":"Ana","photo":null,"quote":"Gran lugar","role":null}]},"hidden":false,"id":"33333333-3333-4333-8333-333333333333","type":"testimonials","variant":"cards"},` +
	`{"content":{"items":[{"description":null,"emoji":null,"icon":"heart","title":"Salud"}]},"hidden":true,"id":"44444444-4444-4444-8444-444444444444","type":"benefits","variant":"grid"}],` +
	`"seo":{"description":null,"title":"Trabaja en Nexo"},"slug":"nexo","theme":{"accent_color":null,"background_color":null,"brand_color":"#0F766E","font_pair":"classic"}}`

func TestSectionsV2StoredV1DocumentReadsUnchanged(t *testing.T) {
	value, err := testDecode([]byte(v1StoredDocument))
	if err != nil {
		t.Fatal(err)
	}
	doc, fs := validateStored(value)
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	if string(doc.Canonical) != v1StoredDocument {
		t.Fatalf("stored v1 changed on read:\n%s", doc.Canonical)
	}
	// Strict validation (a PUT echoing the read) yields identical bytes too.
	again, _ := testDecode(doc.Canonical)
	second, fs := ValidateDocument(again)
	if len(fs) > 0 || string(second.Canonical) != v1StoredDocument {
		t.Fatal(fs)
	}
	// Absent keys behave as defaults: publishable, no style or hero issue.
	if issues := PublishIssues(doc, true, true); len(issues) != 0 {
		t.Fatal(issues)
	}
	// And the public projection (hidden blocks dropped) stays byte-stable as well.
	value, _ = testDecode([]byte(v1StoredDocument))
	visible, err := NewValidator(fakeRich).VisibleDocument(value)
	if err != nil || strings.Contains(string(visible.Canonical), `"style"`) || strings.Contains(string(visible.Canonical), `"primary_label"`) || strings.Contains(string(visible.Canonical), "44444444") {
		t.Fatal(err, string(visible.Canonical))
	}
}
