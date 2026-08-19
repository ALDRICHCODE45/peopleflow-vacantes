package valueobjects

import (
	"errors"
	"testing"
)

func TestSeniority_String(t *testing.T) {
	cases := []struct {
		name string
		s    Seniority
		want string
	}{
		{"intern returns intern", InternSeniority, "intern"},
		{"junior returns junior", JuniorSeniority, "junior"},
		{"mid returns mid", MidSeniority, "mid"},
		{"senior returns senior", SeniorSeniority, "senior"},
		{"lead returns lead", LeadSeniority, "lead"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.s.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSeniority_ParseValid(t *testing.T) {
	cases := []struct {
		raw  string
		want Seniority
	}{
		{"intern", InternSeniority},
		{"junior", JuniorSeniority},
		{"mid", MidSeniority},
		{"senior", SeniorSeniority},
		{"lead", LeadSeniority},
		{"INTERN", InternSeniority},
		{" Senior ", SeniorSeniority},
		{"Lead", LeadSeniority},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseSeniority(tc.raw)
			if err != nil {
				t.Fatalf("expected no error for %q, got: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseSeniority(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestSeniority_ParseUnknown(t *testing.T) {
	raw := "principal"
	_, err := ParseSeniority(raw)
	if err == nil {
		t.Fatalf("expected error for unknown seniority %q, got nil", raw)
	}
	if !errors.Is(err, ErrInvalidSeniority) {
		t.Errorf("expected ErrInvalidSeniority, got: %v", err)
	}
}

func TestSeniority_ParseEmpty(t *testing.T) {
	_, err := ParseSeniority("")
	if err == nil {
		t.Fatal("expected error for empty seniority, got nil")
	}
	if !errors.Is(err, ErrInvalidSeniority) {
		t.Errorf("expected ErrInvalidSeniority, got: %v", err)
	}
}

func TestSeniority_RoundTrip(t *testing.T) {
	for _, s := range []Seniority{InternSeniority, JuniorSeniority, MidSeniority, SeniorSeniority, LeadSeniority} {
		t.Run(s.String(), func(t *testing.T) {
			got, err := ParseSeniority(s.String())
			if err != nil {
				t.Fatalf("round-trip ParseSeniority(%q) errored: %v", s.String(), err)
			}
			if got != s {
				t.Errorf("round-trip ParseSeniority(%q) = %v, want %v", s.String(), got, s)
			}
		})
	}
}
