package valueobjects

import (
	"errors"
	"strings"
)

// ErrFullNameTooShort is returned when the trimmed full name has fewer than two
// characters. The minimum bar excludes accidentally-empty inputs and stray
// spaces while still letting through real two-letter names.
var ErrFullNameTooShort = errors.New("full name must be at least 2 characters")

// FullName is a validated human name. Empty/whitespace-only inputs are
// rejected; the constructor trims surrounding whitespace but otherwise
// preserves the original casing.
type FullName struct {
	value string
}

// NewFullName trims the raw input and rejects results shorter than two
// characters.
func NewFullName(raw string) (FullName, error) {
	clean := strings.TrimSpace(raw)
	if len(clean) < 2 {
		return FullName{}, ErrFullNameTooShort
	}
	return FullName{value: clean}, nil
}

// Value returns the trimmed full name.
func (f FullName) Value() string {
	return f.value
}
