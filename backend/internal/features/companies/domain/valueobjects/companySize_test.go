package valueobjects

import (
	"errors"
	"testing"
)

func TestCompanySize_String(t *testing.T) {
	cases := []struct {
		name string
		size CompanySize
		want string
	}{
		{"startup returns startup", StartupSize, "startup"},
		{"small returns small", SmallSize, "small"},
		{"medium returns medium", MediumSize, "medium"},
		{"large returns large", LargeSize, "large"},
		{"enterprise returns enterprise", EnterpriseSize, "enterprise"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.size.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestCompanySize_ParseValid(t *testing.T) {
	cases := []struct {
		raw  string
		want CompanySize
	}{
		{"startup", StartupSize},
		{"small", SmallSize},
		{"medium", MediumSize},
		{"large", LargeSize},
		{"enterprise", EnterpriseSize},
		{"STARTUP", StartupSize},
		{" Medium ", MediumSize},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseCompanySize(tc.raw)
			if err != nil {
				t.Fatalf("expected no error for %q, got: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseCompanySize(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestCompanySize_ParseUnknown(t *testing.T) {
	raw := "huge"
	_, err := ParseCompanySize(raw)
	if err == nil {
		t.Fatalf("expected error for unknown size %q, got nil", raw)
	}
	if !errors.Is(err, ErrInvalidCompanySize) {
		t.Errorf("expected ErrInvalidCompanySize, got: %v", err)
	}
}

func TestCompanySize_ParseEmpty(t *testing.T) {
	_, err := ParseCompanySize("")
	if err == nil {
		t.Fatal("expected error for empty size, got nil")
	}
	if !errors.Is(err, ErrInvalidCompanySize) {
		t.Errorf("expected ErrInvalidCompanySize, got: %v", err)
	}
}
