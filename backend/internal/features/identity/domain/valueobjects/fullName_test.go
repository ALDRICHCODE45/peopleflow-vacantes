package valueobjects

import (
	"errors"
	"testing"
)

func TestNewFullName_RejectsTooShort(t *testing.T) {
	invalid := []string{"", " ", "A", "  A  "}

	for _, raw := range invalid {
		t.Run("raw="+raw, func(t *testing.T) {
			_, err := NewFullName(raw)
			if err == nil {
				t.Fatalf("expected ErrFullNameTooShort for %q, got nil", raw)
			}
			if !errors.Is(err, ErrFullNameTooShort) {
				t.Errorf("expected ErrFullNameTooShort for %q, got: %v", raw, err)
			}
		})
	}
}

func TestNewFullName_AcceptsValid(t *testing.T) {
	got, err := NewFullName("  Alice Wonder  ")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got.Value() != "Alice Wonder" {
		t.Errorf("expected trimmed value %q, got: %q", "Alice Wonder", got.Value())
	}
}
