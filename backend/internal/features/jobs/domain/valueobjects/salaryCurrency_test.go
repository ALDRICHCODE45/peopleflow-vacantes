package valueobjects

import (
	"errors"
	"testing"
)

func TestSalaryCurrency_String(t *testing.T) {
	cases := []struct {
		name string
		c    SalaryCurrency
		want string
	}{
		{"USD returns USD", USD, "USD"},
		{"MXN returns MXN", MXN, "MXN"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.c.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSalaryCurrency_ParseValid(t *testing.T) {
	cases := []struct {
		raw  string
		want SalaryCurrency
	}{
		{"USD", USD},
		{"MXN", MXN},
		{"usd", USD},
		{" mxn ", MXN},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseSalaryCurrency(tc.raw)
			if err != nil {
				t.Fatalf("expected no error for %q, got: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseSalaryCurrency(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

// TestSalaryCurrency_ParseEURRejected mirrors the DB CHECK constraint
// (`salary_currency IN ('USD','MXN')`): even though the input looks
// plausible, EUR is explicitly out of domain and must surface as the
// sentinel so the caller never silently downgrades to MXN.
func TestSalaryCurrency_ParseEURRejected(t *testing.T) {
	_, err := ParseSalaryCurrency("EUR")
	if err == nil {
		t.Fatal("expected error for EUR, got nil")
	}
	if !errors.Is(err, ErrInvalidSalaryCurrency) {
		t.Errorf("expected ErrInvalidSalaryCurrency, got: %v", err)
	}
}

func TestSalaryCurrency_ParseEmpty(t *testing.T) {
	// Spec: salary_currency defaults to 'MXN' at the DB. If a caller
	// surfaces an empty raw value, it means the DB skipped the row for
	// some reason — reject so we never silently treat empty as USD.
	_, err := ParseSalaryCurrency("")
	if err == nil {
		t.Fatal("expected error for empty salary currency, got nil")
	}
	if !errors.Is(err, ErrInvalidSalaryCurrency) {
		t.Errorf("expected ErrInvalidSalaryCurrency, got: %v", err)
	}
}

func TestSalaryCurrency_ParseUnknown(t *testing.T) {
	raw := "ARS"
	_, err := ParseSalaryCurrency(raw)
	if err == nil {
		t.Fatalf("expected error for unknown currency %q, got nil", raw)
	}
	if !errors.Is(err, ErrInvalidSalaryCurrency) {
		t.Errorf("expected ErrInvalidSalaryCurrency, got: %v", err)
	}
}

func TestSalaryCurrency_RoundTrip(t *testing.T) {
	for _, c := range []SalaryCurrency{USD, MXN} {
		t.Run(c.String(), func(t *testing.T) {
			got, err := ParseSalaryCurrency(c.String())
			if err != nil {
				t.Fatalf("round-trip ParseSalaryCurrency(%q) errored: %v", c.String(), err)
			}
			if got != c {
				t.Errorf("round-trip ParseSalaryCurrency(%q) = %v, want %v", c.String(), got, c)
			}
		})
	}
}
