package valueobjects

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestNewFoundedYear_LowerBound(t *testing.T) {
	got, err := NewFoundedYear(1800)
	if err != nil {
		t.Fatalf("expected no error for 1800 (lower bound), got: %v", err)
	}
	if got.Value() != 1800 {
		t.Errorf("expected 1800, got: %d", got.Value())
	}
}

func TestNewFoundedYear_BelowLowerBound(t *testing.T) {
	_, err := NewFoundedYear(1799)
	if err == nil {
		t.Fatal("expected error for 1799 (below lower bound), got nil")
	}
	if !errors.Is(err, ErrFoundedYearOutOfRange) {
		t.Errorf("expected ErrFoundedYearOutOfRange, got: %v", err)
	}
}

func TestNewFoundedYear_CurrentYear(t *testing.T) {
	currentYear := time.Now().Year()
	got, err := NewFoundedYear(currentYear)
	if err != nil {
		t.Fatalf("expected no error for current year %d, got: %v", currentYear, err)
	}
	if got.Value() != currentYear {
		t.Errorf("expected %d, got: %d", currentYear, got.Value())
	}
}

func TestNewFoundedYear_UpperBound(t *testing.T) {
	upper := 2100
	got, err := newFoundedYearWithUpperBound(2100, upper)
	if err != nil {
		t.Fatalf("expected no error for upper bound (%d), got: %v", upper, err)
	}
	if got.Value() != upper {
		t.Errorf("expected %d, got: %d", upper, got.Value())
	}
}

func TestNewFoundedYear_AboveUpperBound(t *testing.T) {
	upper := 2100
	_, err := newFoundedYearWithUpperBound(2100+1, upper)
	if err == nil {
		t.Fatalf("expected error for year above upper bound, got nil")
	}
	if !errors.Is(err, ErrFoundedYearOutOfRange) {
		t.Errorf("expected ErrFoundedYearOutOfRange, got: %v", err)
	}
}

func TestNewFoundedYear_Zero(t *testing.T) {
	_, err := NewFoundedYear(0)
	if err == nil {
		t.Fatal("expected error for zero year, got nil")
	}
	if !errors.Is(err, ErrFoundedYearOutOfRange) {
		t.Errorf("expected ErrFoundedYearOutOfRange, got: %v", err)
	}
}

func TestNewFoundedYear_Negative(t *testing.T) {
	_, err := NewFoundedYear(-100)
	if err == nil {
		t.Fatal("expected error for negative year, got nil")
	}
	if !errors.Is(err, ErrFoundedYearOutOfRange) {
		t.Errorf("expected ErrFoundedYearOutOfRange, got: %v", err)
	}
}

func TestErrFoundedYearOutOfRange_Message(t *testing.T) {
	// lock down the error message surface area (HTTP layer renders it directly)
	if !strings.Contains(ErrFoundedYearOutOfRange.Error(), "año") &&
		!strings.Contains(ErrFoundedYearOutOfRange.Error(), "year") &&
		!strings.Contains(ErrFoundedYearOutOfRange.Error(), "rango") &&
		!strings.Contains(ErrFoundedYearOutOfRange.Error(), "range") {
		t.Errorf("expected error message to mention year/range, got: %q", ErrFoundedYearOutOfRange.Error())
	}
}
