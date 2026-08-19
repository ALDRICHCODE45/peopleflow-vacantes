package valueobjects

import (
	"errors"
	"testing"
)

func TestWorkMode_String(t *testing.T) {
	cases := []struct {
		name string
		wm   WorkMode
		want string
	}{
		{"onsite returns onsite", Onsite, "onsite"},
		{"remote returns remote", Remote, "remote"},
		{"hybrid returns hybrid", Hybrid, "hybrid"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.wm.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestWorkMode_ParseValid(t *testing.T) {
	cases := []struct {
		raw  string
		want WorkMode
	}{
		{"onsite", Onsite},
		{"remote", Remote},
		{"hybrid", Hybrid},
		{"ONSITE", Onsite},
		{" Remote ", Remote},
		{"Hybrid", Hybrid},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseWorkMode(tc.raw)
			if err != nil {
				t.Fatalf("expected no error for %q, got: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseWorkMode(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestWorkMode_ParseUnknown(t *testing.T) {
	raw := "telecommute"
	_, err := ParseWorkMode(raw)
	if err == nil {
		t.Fatalf("expected error for unknown work mode %q, got nil", raw)
	}
	if !errors.Is(err, ErrInvalidWorkMode) {
		t.Errorf("expected ErrInvalidWorkMode, got: %v", err)
	}
}

func TestWorkMode_ParseEmpty(t *testing.T) {
	_, err := ParseWorkMode("")
	if err == nil {
		t.Fatal("expected error for empty work mode, got nil")
	}
	if !errors.Is(err, ErrInvalidWorkMode) {
		t.Errorf("expected ErrInvalidWorkMode, got: %v", err)
	}
}

// TestWorkMode_RoundTrip is the wire-format guarantee: every valid member
// parses back to itself through String() -> ParseWorkMode. It guards
// against drift between the canonical lowercase enum strings and the
// switch labels in ParseWorkMode.
func TestWorkMode_RoundTrip(t *testing.T) {
	for _, wm := range []WorkMode{Onsite, Remote, Hybrid} {
		t.Run(wm.String(), func(t *testing.T) {
			got, err := ParseWorkMode(wm.String())
			if err != nil {
				t.Fatalf("round-trip ParseWorkMode(%q) errored: %v", wm.String(), err)
			}
			if got != wm {
				t.Errorf("round-trip ParseWorkMode(%q) = %v, want %v", wm.String(), got, wm)
			}
		})
	}
}
