package valueobjects

import (
	"errors"
	"testing"
)

func TestCefrLevel_String(t *testing.T) {
	cases := []struct {
		name  string
		level CefrLevel
		want  string
	}{
		{"A1", A1, "A1"},
		{"A2", A2, "A2"},
		{"B1", B1, "B1"},
		{"B2", B2, "B2"},
		{"C1", C1, "C1"},
		{"C2", C2, "C2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.level.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestCefrLevel_ParseValid(t *testing.T) {
	// Spec invariant: CEFR levels are case-sensitive uppercase codes. The DB
	// CHECK matches that exact spelling, so we deliberately do NOT lowercase
	// or trim. Mixed-case inputs are rejected as invalid.
	for _, raw := range []string{"A1", "A2", "B1", "B2", "C1", "C2"} {
		t.Run(raw, func(t *testing.T) {
			got, err := ParseCefrLevel(raw)
			if err != nil {
				t.Fatalf("ParseCefrLevel(%q): unexpected error: %v", raw, err)
			}
			if got.String() != raw {
				t.Errorf("ParseCefrLevel(%q).String() = %q, want %q", raw, got, raw)
			}
		})
	}
}

func TestCefrLevel_ParseUnknown(t *testing.T) {
	_, err := ParseCefrLevel("native")
	if err == nil {
		t.Fatal("expected ErrInvalidCefrLevel for 'native', got nil")
	}
	if !errors.Is(err, ErrInvalidCefrLevel) {
		t.Errorf("expected ErrInvalidCefrLevel, got: %v", err)
	}
}

func TestCefrLevel_ParseCaseSensitive(t *testing.T) {
	// Lowercase 'a1' is NOT a valid CEFR code — case-sensitivity is enforced
	// so the DB CHECK and the VO never disagree.
	_, err := ParseCefrLevel("a1")
	if err == nil {
		t.Fatal("expected ErrInvalidCefrLevel for lowercase 'a1', got nil")
	}
	if !errors.Is(err, ErrInvalidCefrLevel) {
		t.Errorf("expected ErrInvalidCefrLevel, got: %v", err)
	}
}

func TestCefrLevel_ParseEmpty(t *testing.T) {
	_, err := ParseCefrLevel("")
	if err == nil {
		t.Fatal("expected error for empty CEFR level, got nil")
	}
	if !errors.Is(err, ErrInvalidCefrLevel) {
		t.Errorf("expected ErrInvalidCefrLevel, got: %v", err)
	}
}
