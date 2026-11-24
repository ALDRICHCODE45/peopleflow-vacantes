package valueobjects

import (
	"errors"
	"strings"
	"testing"
)

func notePtr(s string) *string { return &s }

// The optional invitation note (stakeholder-metrics-v1 §1.3, audit gap D11):
// trimmed, NFC, 1..80 runes, no control characters; absent or blank is null.
func TestParseInvitationNote(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  *string
		want *string
	}{
		{"absent", nil, nil},
		{"empty", notePtr(""), nil},
		{"only white space", notePtr(" \t\n  "), nil},
		{"plain", notePtr("Consejo directivo"), notePtr("Consejo directivo")},
		{"trimmed", notePtr("  Para Ana  "), notePtr("Para Ana")},
		{"trailing newline trimmed", notePtr("Para Ana\n"), notePtr("Para Ana")},
		{"inner spaces kept", notePtr("Para  Ana"), notePtr("Para  Ana")},
		{"NFC", notePtr("Jose\u0301"), notePtr("Jos\u00e9")},
		{"80 runes", notePtr(strings.Repeat("ñ", 80)), notePtr(strings.Repeat("ñ", 80))},
		{"80 runes after NFC", notePtr(strings.Repeat("n\u0303", 80)), notePtr(strings.Repeat("\u00f1", 80))},
		{"80 runes after trim", notePtr("  " + strings.Repeat("a", 80) + "  "), notePtr(strings.Repeat("a", 80))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseInvitationNote(tc.raw)
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			switch {
			case got == nil && tc.want == nil:
			case got == nil || tc.want == nil || *got != *tc.want:
				t.Fatalf("got %v, want %v", deref(got), deref(tc.want))
			}
		})
	}
}

func TestParseInvitationNoteRejects(t *testing.T) {
	for name, raw := range map[string]string{
		"81 runes":           strings.Repeat("a", 81),
		"81 runes multibyte": strings.Repeat("ñ", 81),
		"inner newline":      "Para\nAna",
		"inner tab":          "Para\tAna",
		"NUL":                "Para\x00Ana",
		"DEL":                "Para\x7fAna",
		"C1 control":         "Para\u0085Ana",
		"invalid UTF-8":      "Para \xff Ana",
	} {
		t.Run(name, func(t *testing.T) {
			got, err := ParseInvitationNote(&raw)
			if !errors.Is(err, ErrInvalidInvitationNote) || got != nil {
				t.Fatalf("got %v, %v", deref(got), err)
			}
		})
	}
}

func deref(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}
