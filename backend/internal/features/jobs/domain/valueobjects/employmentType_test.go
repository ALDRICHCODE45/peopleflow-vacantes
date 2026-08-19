package valueobjects

import (
	"errors"
	"testing"
)

func TestEmploymentType_String(t *testing.T) {
	cases := []struct {
		name string
		et   EmploymentType
		want string
	}{
		{"full_time returns full_time", FullTime, "full_time"},
		{"part_time returns part_time", PartTime, "part_time"},
		{"contract returns contract", Contract, "contract"},
		{"internship returns internship", Internship, "internship"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.et.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEmploymentType_ParseValid(t *testing.T) {
	cases := []struct {
		raw  string
		want EmploymentType
	}{
		{"full_time", FullTime},
		{"part_time", PartTime},
		{"contract", Contract},
		{"internship", Internship},
		{"FULL_TIME", FullTime},
		{" Part_Time ", PartTime},
		{"Contract", Contract},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseEmploymentType(tc.raw)
			if err != nil {
				t.Fatalf("expected no error for %q, got: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseEmploymentType(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestEmploymentType_ParseUnknown(t *testing.T) {
	raw := "freelance"
	_, err := ParseEmploymentType(raw)
	if err == nil {
		t.Fatalf("expected error for unknown employment type %q, got nil", raw)
	}
	if !errors.Is(err, ErrInvalidEmploymentType) {
		t.Errorf("expected ErrInvalidEmploymentType, got: %v", err)
	}
}

func TestEmploymentType_ParseEmpty(t *testing.T) {
	_, err := ParseEmploymentType("")
	if err == nil {
		t.Fatal("expected error for empty employment type, got nil")
	}
	if !errors.Is(err, ErrInvalidEmploymentType) {
		t.Errorf("expected ErrInvalidEmploymentType, got: %v", err)
	}
}

func TestEmploymentType_RoundTrip(t *testing.T) {
	for _, et := range []EmploymentType{FullTime, PartTime, Contract, Internship} {
		t.Run(et.String(), func(t *testing.T) {
			got, err := ParseEmploymentType(et.String())
			if err != nil {
				t.Fatalf("round-trip ParseEmploymentType(%q) errored: %v", et.String(), err)
			}
			if got != et {
				t.Errorf("round-trip ParseEmploymentType(%q) = %v, want %v", et.String(), got, et)
			}
		})
	}
}
