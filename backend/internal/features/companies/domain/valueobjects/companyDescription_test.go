package valueobjects

import (
	"errors"
	"strings"
	"testing"
)

func TestCompanyDescription_Empty(t *testing.T) {
	desc, err := NewCompanyDescription("")
	if err != nil {
		t.Fatalf("expected no error for empty description, got: %v", err)
	}
	if desc.Value() != "" {
		t.Errorf("expected empty value, got: %q", desc.Value())
	}
}

func TestCompanyDescription_Valid(t *testing.T) {
	in := "Somos una empresa líder en soluciones de software empresarial."
	desc, err := NewCompanyDescription(in)
	if err != nil {
		t.Fatalf("expected no error for valid description, got: %v", err)
	}
	if got := desc.Value(); got != in {
		t.Errorf("expected value %q, got: %q", in, got)
	}
}

func TestCompanyDescription_BoundaryOK(t *testing.T) {
	at3000 := strings.Repeat("a", 3000)
	desc, err := NewCompanyDescription(at3000)
	if err != nil {
		t.Fatalf("expected no error for description at the 3000-char boundary, got: %v", err)
	}
	if got := desc.Value(); len(got) != 3000 {
		t.Errorf("expected value of length 3000, got: %d", len(got))
	}
}

func TestCompanyDescription_TooLong(t *testing.T) {
	over := strings.Repeat("a", 3001)
	_, err := NewCompanyDescription(over)
	if err == nil {
		t.Fatal("expected error for description > 3000 chars, got nil")
	}
	if !errors.Is(err, ErrCompanyDescriptionTooLong) {
		t.Errorf("expected ErrCompanyDescriptionTooLong, got: %v", err)
	}
}
