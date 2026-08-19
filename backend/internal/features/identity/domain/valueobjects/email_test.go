package valueobjects

import (
	"errors"
	"testing"
)

// TestNewEmail_AcceptsValidInputs covers the happy-path inputs that should
// round-trip through the VO with normalized casing + trimming.
func TestNewEmail_AcceptsValidInputs(t *testing.T) {
	cases := []struct {
		raw  string
		want string
	}{
		{"alice@example.com", "alice@example.com"},
		{"  Alice@Example.COM  ", "alice@example.com"},
		{"user.name+tag@sub.example.co", "user.name+tag@sub.example.co"},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := NewEmail(tc.raw)
			if err != nil {
				t.Fatalf("NewEmail(%q) returned error: %v", tc.raw, err)
			}
			if got.Value() != tc.want {
				t.Errorf("NewEmail(%q).Value() = %q, want %q", tc.raw, got.Value(), tc.want)
			}
		})
	}
}

// TestNewEmail_RejectsInvalidInputs covers the explicit reject set from the
// design doc: empty, whitespace, missing local/domain, missing TLD, double @,
// and whitespace inside the address.
func TestNewEmail_RejectsInvalidInputs(t *testing.T) {
	invalid := []string{
		"",
		"   ",
		"foo",
		"foo@",
		"@bar.com",
		"foo@bar",
		"two@@ats.com",
		"space in@addr.com",
	}

	for _, raw := range invalid {
		t.Run(raw, func(t *testing.T) {
			_, err := NewEmail(raw)
			if err == nil {
				t.Fatalf("expected ErrInvalidEmail for %q, got nil", raw)
			}
			if !errors.Is(err, ErrInvalidEmail) {
				t.Errorf("expected ErrInvalidEmail for %q, got: %v", raw, err)
			}
		})
	}
}
