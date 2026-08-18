package valueobjects

import (
	"errors"
	"strings"
)

// ErrInvalidCompanySize is returned when a raw size value does not match any
// member of the closed set {startup, small, medium, large, enterprise}.
var ErrInvalidCompanySize = errors.New("invalid company size")

// CompanySize is the closed-set classification of a company by workforce.
// The integer values are the canonical ordering; the textual representation
// is the wire format used in HTTP bodies and the database CHECK constraint.
type CompanySize int

const (
	// UnknownSize is the zero value returned for invalid inputs; it intentionally
	// has no valid string mapping so callers can never compare against it directly.
	UnknownSize CompanySize = iota
	StartupSize
	SmallSize
	MediumSize
	LargeSize
	EnterpriseSize
)

// String returns the canonical lowercase wire value for the size.
func (s CompanySize) String() string {
	switch s {
	case StartupSize:
		return "startup"
	case SmallSize:
		return "small"
	case MediumSize:
		return "medium"
	case LargeSize:
		return "large"
	case EnterpriseSize:
		return "enterprise"
	default:
		return "unknown_size"
	}
}

// ParseCompanySize normalizes and validates a raw size string. The comparison
// is case-insensitive and trims surrounding whitespace, so callers can pass
// user-provided text directly. Unknown values return ErrInvalidCompanySize.
func ParseCompanySize(raw string) (CompanySize, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "startup":
		return StartupSize, nil
	case "small":
		return SmallSize, nil
	case "medium":
		return MediumSize, nil
	case "large":
		return LargeSize, nil
	case "enterprise":
		return EnterpriseSize, nil
	default:
		return UnknownSize, ErrInvalidCompanySize
	}
}
