package application

import (
	"strings"
	"testing"
)

// Slice B (contract §2.4): hero `background_video` is a media ref of kind
// hero_video, absent stays absent, and background_loop publishes only with a
// video and a cover (poster).

func TestHeroBackgroundVideoGrammar(t *testing.T) {
	video := ref()
	m := input(t)
	hero(m)["content"] = map[string]any{"title": "Únete", "background_video": video}
	doc, fs := ValidateDocument(m)
	if len(fs) > 0 {
		t.Fatal(fs)
	}
	found := false
	for _, r := range doc.Media {
		if r.ID == video["media_id"] {
			found = r.Kind == "hero_video" && r.Field == "blocks[0].content.background_video"
		}
	}
	if !found {
		t.Fatalf("video ref not recorded for the ownership/kind check: %+v", doc.Media)
	}
	// Explicit null is kept as null.
	m = input(t)
	hero(m)["content"] = map[string]any{"title": "Únete", "background_video": nil}
	doc, fs = ValidateDocument(m)
	if len(fs) > 0 || !strings.Contains(string(doc.Canonical), `"background_video":null`) {
		t.Fatal(fs, string(doc.Canonical))
	}
	// Absent stays absent.
	m = input(t)
	hero(m)["content"] = map[string]any{"title": "Únete"}
	doc, fs = ValidateDocument(m)
	if len(fs) > 0 || strings.Contains(string(doc.Canonical), "background_video") {
		t.Fatal(fs, string(doc.Canonical))
	}
	for _, tc := range []struct {
		value any
		field string
	}{
		{"x", "blocks[0].content.background_video"},
		{map[string]any{"media_id": "nope"}, "blocks[0].content.background_video.media_id"},
		{map[string]any{"media_id": video["media_id"], "extra": 1}, "blocks[0].content.background_video.extra"},
	} {
		m = input(t)
		hero(m)["content"] = map[string]any{"background_video": tc.value}
		if _, fs := ValidateDocument(m); len(fs) == 0 || fs[0].Field != tc.field {
			t.Fatal(tc, fs)
		}
	}
	// Only the hero has it.
	_, fs = validateExtra(t, block("closing", "simple", map[string]any{"background_video": video}))
	if !hasField(fs, "blocks[2].content.background_video", "unknown_key") {
		t.Fatal(fs)
	}
}

func TestHeroBackgroundLoopPublishRule(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content map[string]any
		blocked bool
	}{
		{"neither", map[string]any{"title": "Únete"}, true},
		{"video null", map[string]any{"title": "Únete", "background_video": nil, "cover": ref()}, true},
		{"video without poster", map[string]any{"title": "Únete", "background_video": ref()}, true},
		{"poster without video", map[string]any{"title": "Únete", "cover": ref()}, true},
		{"video and poster", map[string]any{"title": "Únete", "background_video": ref(), "cover": ref()}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := publishable(t)
			hero(m)["variant"] = "background_loop"
			hero(m)["content"] = tc.content
			got := issuesOf(t, m)
			if got["hero_video_missing@blocks[0]"] != tc.blocked || len(got) != map[bool]int{true: 1, false: 0}[tc.blocked] {
				t.Fatal(got)
			}
		})
	}
	// Other variants ignore the video entirely.
	m := publishable(t)
	hero(m)["content"] = map[string]any{"title": "Únete", "background_video": ref()}
	if got := issuesOf(t, m); len(got) != 0 {
		t.Fatal(got)
	}
}

// A document stored before slice B re-reads byte-identical (no inserted key).
func TestHeroBackgroundVideoStoredDocumentUnchanged(t *testing.T) {
	value, err := testDecode([]byte(v1StoredDocument))
	if err != nil {
		t.Fatal(err)
	}
	doc, fs := validateStored(value)
	if len(fs) > 0 || string(doc.Canonical) != v1StoredDocument {
		t.Fatal(fs, string(doc.Canonical))
	}
}
