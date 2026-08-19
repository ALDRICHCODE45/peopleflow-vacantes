// Package valueobjects holds the identity bounded-context value objects.
package valueobjects

import (
	"errors"
	"net/mail"
	"strings"
)

// ErrInvalidEmail is returned when a raw input cannot be parsed into a
// deliverable email address.
var ErrInvalidEmail = errors.New("invalid email")

// Email is a normalized, validated email address. The raw input is trimmed,
// lowercased, and parsed with net/mail.ParseAddress; the domain must contain
// at least one dot so we reject single-label literal-host addresses.
type Email struct {
	value string
}

// NewEmail trims, lowercases, and validates the raw input. The reject set
// covers the cases documented in the design doc (empty, missing local/domain,
// missing TLD, double @, whitespace inside the address).
func NewEmail(raw string) (Email, error) {
	clean := strings.ToLower(strings.TrimSpace(raw))
	if clean == "" {
		return Email{}, ErrInvalidEmail
	}

	parsed, err := mail.ParseAddress(clean)
	if err != nil {
		return Email{}, ErrInvalidEmail
	}

	// Pick the parsed value back out: net/mail lowercases the address part
	// but leaves display names untouched; we already stripped/normalized
	// the input so the parsed address should match `clean`.
	at := strings.LastIndex(parsed.Address, "@")
	if at < 0 || at == len(parsed.Address)-1 {
		return Email{}, ErrInvalidEmail
	}
	local := parsed.Address[:at]
	domain := parsed.Address[at+1:]
	if local == "" || domain == "" {
		return Email{}, ErrInvalidEmail
	}
	if !strings.Contains(domain, ".") {
		return Email{}, ErrInvalidEmail
	}

	return Email{value: parsed.Address}, nil
}

// Value returns the normalized email address.
func (e Email) Value() string {
	return e.value
}
