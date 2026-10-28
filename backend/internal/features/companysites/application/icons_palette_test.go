package application

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

const originalIcons = "heart users rocket target lightbulb shield leaf globe graduation-cap briefcase laptop clock calendar coffee dumbbell stethoscope piggy-bank gift plane home sparkles handshake trophy smile"
const addedIcons = "star award medal crown flag compass map-pin mountain sun moon zap flame gem puzzle brain book-open pencil palette music camera code terminal cpu database cloud wifi smartphone monitor headphones message-circle mail phone megaphone bell trending-up chart-bar chart-pie dollar-sign wallet credit-card banknote shopping-bag car bike bus train-front baby dog cat utensils pizza apple salad heart-handshake hand-heart hand-helping thumbs-up party-popper cake gamepad-2 tree-pine recycle sprout flower-2 umbrella shield-check lock key scale building-2 factory store wrench hammer hard-hat truck package infinity accessibility languages calendar-check timer bot microscope paintbrush film mic"

func TestIconListOrderAndUniqueness(t *testing.T) {
	if len(icons) != 111 || !slices.Equal(icons, strings.Fields(originalIcons+" "+addedIcons)) {
		t.Fatal(icons)
	}
	seen := map[string]bool{}
	for _, icon := range icons {
		if seen[icon] {
			t.Fatalf("duplicate %s", icon)
		}
		seen[icon] = true
		if _, fs := validateExtra(t, block("values", "grid", map[string]any{"items": []any{map[string]any{"icon": icon}}})); len(fs) != 0 {
			t.Fatal(icon, fs)
		}
	}
}

func TestEmojiGrammar(t *testing.T) {
	for _, s := range []string{"😀", "❤️", "👍🏽", "👩‍💻", "👨‍👩‍👧‍👦", "🇲🇽", "🏳️‍🌈", "1️⃣", "#\u20e3", "🏴\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f", "♡", "🏴\u200d☠️", "♡\u200d🔥"} {
		t.Run(s, func(t *testing.T) {
			if !validEmoji(s) {
				t.Fatalf("rejected %q (%d bytes)", s, len(s))
			}
		})
	}
	for _, s := range []string{"", " 😀", "😀😀", "a", "😀a", "🇲", "🇲🇽🇺🇸", "\u200d😀", "1", strings.Repeat("a", 33), string([]byte{0xff}), "😀\u200d", "😀\ufe0f\ufe0f", "👍🏽🏽", "🏴\U000e0067", "🏴\U000e007f", "😀\u0301", "😀\ufe0e", "1\ufe0f", "\U0001f3fd",
		// U+200D joins pictographic elements only: flags, keycaps and tag sequences stand alone.
		"🇲🇽\u200d🇺🇸", "😀\u200d🇲🇽", "1️⃣\u200d😀", "😀\u200d#️⃣", "🏴\U000e0067\U000e007f\u200d😀", "😀\u200d🏴\U000e0067\U000e007f"} {
		if validEmoji(s) {
			t.Errorf("accepted %q", s)
		}
	}
}

func TestExtendedPictographicTable(t *testing.T) {
	for _, r := range []rune{'😀', '❤', '👍', '👩', '♡', 0x1FAE8, 0xA9} {
		if !extendedPictographic(r) {
			t.Errorf("missing U+%04X", r)
		}
	}
	for _, r := range []rune{'a', '1', ' ', 0x200D, 0xFE0F, 0x1F1F2, 0x1F3FD, 0xE0067} {
		if extendedPictographic(r) {
			t.Errorf("unexpected U+%04X", r)
		}
	}
	for i, r := range extendedPictographicRanges {
		if r[0] > r[1] || i > 0 && extendedPictographicRanges[i-1][1] >= r[0] {
			t.Fatal("unsorted/overlapping range", i)
		}
	}
}

func TestIconEmojiValidation(t *testing.T) {
	for _, kind := range []string{"values", "benefits"} {
		for _, tc := range []struct {
			name      string
			item      map[string]any
			key, code string
		}{
			{"missing", map[string]any{}, "icon", "required"},
			{"nulls", map[string]any{"icon": nil, "emoji": nil}, "icon", "required"},
			{"both", map[string]any{"icon": "heart", "emoji": "😀"}, "emoji", "not_allowed"},
			{"unknown icon", map[string]any{"icon": "unknown"}, "icon", "invalid"},
			{"bad emoji", map[string]any{"emoji": "text"}, "emoji", "invalid"},
			{"blank emoji", map[string]any{"emoji": ""}, "emoji", "invalid"},
			{"emoji type", map[string]any{"emoji": 1}, "emoji", "invalid"},
			{"invalid utf8", map[string]any{"emoji": string([]byte{0xff})}, "emoji", "invalid"},
			{"over bytes", map[string]any{"emoji": strings.Repeat("a", 33)}, "emoji", "too_long"},
			{"icon", map[string]any{"icon": "mic"}, "", ""},
			{"emoji", map[string]any{"emoji": "👩‍💻"}, "", ""},
		} {
			t.Run(kind+"/"+tc.name, func(t *testing.T) {
				doc, fs := validateExtra(t, block(kind, "grid", map[string]any{"items": []any{tc.item}}))
				if tc.code != "" {
					if !slices.Equal(fs, []Field{{Field: "blocks[2].content.items[0]." + tc.key, Code: tc.code}}) {
						t.Fatal(fs)
					}
					return
				}
				if len(fs) != 0 {
					t.Fatal(fs)
				}
				var canonical map[string]any
				if err := json.Unmarshal(doc.Canonical, &canonical); err != nil {
					t.Fatal(err)
				}
				item := canonical["blocks"].([]any)[2].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)
				for _, key := range []string{"icon", "emoji"} {
					if _, ok := item[key]; !ok {
						t.Fatal("missing", key)
					}
				}
			})
		}
	}
}

func TestPalette(t *testing.T) {
	for _, key := range []string{"accent_color", "background_color"} {
		for _, tc := range []struct {
			value any
			want  any
			code  string
		}{
			{nil, nil, ""}, {"#aBcDeF", "#ABCDEF", ""}, {"#000000", "#000000", ""},
			{"", nil, "invalid"}, {" #abcdef", nil, "invalid"}, {"#fff", nil, "invalid"},
			{"#12345g", nil, "invalid"}, {123, nil, "invalid"}, {"#1234567", nil, "invalid"},
		} {
			m := input(t)
			m["theme"].(map[string]any)[key] = tc.value
			doc, fs := ValidateDocument(m)
			if tc.code != "" {
				if !hasField(fs, "theme."+key, tc.code) {
					t.Fatal(fs)
				}
			} else if len(fs) != 0 || doc.Value["theme"].(map[string]any)[key] != tc.want {
				t.Fatal(fs, doc)
			}
		}
	}
	m := input(t)
	m["theme"].(map[string]any)["extra"] = nil
	if _, fs := ValidateDocument(m); !hasField(fs, "theme.extra", "unknown_key") {
		t.Fatal(fs)
	}
	m = input(t)
	delete(m["theme"].(map[string]any), "brand_color")
	if _, fs := ValidateDocument(m); !hasField(fs, "theme.brand_color", "invalid") {
		t.Fatal(fs)
	}
	var defaults map[string]any
	if err := json.Unmarshal(DefaultDocument(), &defaults); err != nil {
		t.Fatal(err)
	}
	assertPaletteNulls(t, defaults)
}

func assertPaletteNulls(t *testing.T, m map[string]any) {
	t.Helper()
	for _, key := range []string{"accent_color", "background_color"} {
		if value, ok := m["theme"].(map[string]any)[key]; !ok || value != nil {
			t.Fatal(key, m)
		}
	}
}

func TestStoredLegacyDocument(t *testing.T) {
	legacy := func() map[string]any {
		m := input(t)
		m["slug"] = "legacy"
		m["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)["title"] = "Join"
		delete(m["theme"].(map[string]any), "accent_color")
		delete(m["theme"].(map[string]any), "background_color")
		m["blocks"] = append(m["blocks"].([]any), block("values", "grid", map[string]any{"items": []any{map[string]any{"title": "Care", "icon": nil}}}))
		return m
	}
	v := NewValidator(fakeRich)
	doc, fs := v.ValidateStoredDocument(legacy())
	if len(fs) != 0 {
		t.Fatal(fs)
	}
	assertPaletteNulls(t, doc.Value)
	item := doc.Value["blocks"].([]any)[2].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)
	if emoji, ok := item["emoji"]; !ok || emoji != nil {
		t.Fatal(item)
	}
	if issues := PublishIssues(doc, true, true); len(issues) != 0 {
		t.Fatal(issues)
	}
	visible, err := v.VisibleDocument(legacy())
	if err != nil {
		t.Fatal(err)
	}
	assertPaletteNulls(t, visible.Value)
	if _, fs := v.ValidateDocument(legacy()); !hasField(fs, "blocks[2].content.items[0].icon", "required") {
		t.Fatal(fs)
	}
	for _, bad := range []map[string]any{{"icon": "heart", "emoji": "😀"}, {"icon": "bad"}, {"emoji": "a"}, {"emoji": strings.Repeat("a", 33)}, {"extra": true}} {
		m := legacy()
		m["blocks"].([]any)[2].(map[string]any)["content"].(map[string]any)["items"] = []any{bad}
		if _, fs := v.ValidateStoredDocument(m); len(fs) == 0 {
			t.Fatal("lenient mode accepted", bad)
		}
	}
}
