package valueobjects

import (
	"errors"
	"testing"
)

func TestEducationLevel_String(t *testing.T) {
	cases := []struct {
		name  string
		level EducationLevel
		want  string
	}{
		{"high_school", HighSchool, "high_school"},
		{"bachelor", Bachelor, "bachelor"},
		{"master", Master, "master"},
		{"phd", PhD, "phd"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.level.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEducationLevel_ParseValid(t *testing.T) {
	cases := []struct {
		raw  string
		want EducationLevel
	}{
		{"high_school", HighSchool},
		{"bachelor", Bachelor},
		{"master", Master},
		{"phd", PhD},
		{"HIGH_SCHOOL", HighSchool}, // case-insensitive
		{" Bachelor ", Bachelor},    // whitespace trimmed
		{"PhD", PhD},                // canonical lowercase form
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseEducationLevel(tc.raw)
			if err != nil {
				t.Fatalf("ParseEducationLevel(%q): unexpected error: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseEducationLevel(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestEducationLevel_ParseUnknown(t *testing.T) {
	_, err := ParseEducationLevel("vocational")
	if err == nil {
		t.Fatal("expected ErrInvalidEducationLevel for 'vocational', got nil")
	}
	if !errors.Is(err, ErrInvalidEducationLevel) {
		t.Errorf("expected ErrInvalidEducationLevel, got: %v", err)
	}
}

func TestEducationLevel_ParseEmpty(t *testing.T) {
	_, err := ParseEducationLevel("")
	if err == nil {
		t.Fatal("expected error for empty education level, got nil")
	}
	if !errors.Is(err, ErrInvalidEducationLevel) {
		t.Errorf("expected ErrInvalidEducationLevel, got: %v", err)
	}
}
