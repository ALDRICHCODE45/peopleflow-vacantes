package valueobjects

import (
	"errors"
	"testing"
)

func TestSalaryPeriod_String(t *testing.T) {
	cases := []struct {
		name   string
		period SalaryPeriod
		want   string
	}{
		{"monthly", MonthlySalary, "monthly"},
		{"annual", AnnualSalary, "annual"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.period.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSalaryPeriod_ParseValid(t *testing.T) {
	cases := []struct {
		raw  string
		want SalaryPeriod
	}{
		{"monthly", MonthlySalary},
		{"annual", AnnualSalary},
		{"MONTHLY", MonthlySalary},
		{" Annual ", AnnualSalary},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseSalaryPeriod(tc.raw)
			if err != nil {
				t.Fatalf("ParseSalaryPeriod(%q): unexpected error: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseSalaryPeriod(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestSalaryPeriod_ParseUnknown(t *testing.T) {
	_, err := ParseSalaryPeriod("weekly")
	if err == nil {
		t.Fatal("expected ErrInvalidSalaryPeriod for 'weekly', got nil")
	}
	if !errors.Is(err, ErrInvalidSalaryPeriod) {
		t.Errorf("expected ErrInvalidSalaryPeriod, got: %v", err)
	}
}

func TestSalaryPeriod_ParseEmpty(t *testing.T) {
	_, err := ParseSalaryPeriod("")
	if err == nil {
		t.Fatal("expected error for empty salary period, got nil")
	}
	if !errors.Is(err, ErrInvalidSalaryPeriod) {
		t.Errorf("expected ErrInvalidSalaryPeriod, got: %v", err)
	}
}
