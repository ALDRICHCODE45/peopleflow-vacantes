package valueobjects

import (
	"errors"
	"strings"
)

// ErrInvalidEducationLevel is returned when a raw education_level value does
// not match any member of the closed set {high_school, bachelor, master, phd}.
var ErrInvalidEducationLevel = errors.New("invalid education level")

// EducationLevel is the closed-set classification of a candidate's highest
// academic achievement. The integer values are the canonical ordering; the
// textual representation is the wire format used in HTTP bodies and the
// database CHECK constraint.
type EducationLevel int

const (
	// UnknownEducation is the zero value returned for invalid inputs; it
	// intentionally has no valid string mapping so callers can never compare
	// against it directly.
	UnknownEducation EducationLevel = iota
	HighSchool
	Bachelor
	Master
	PhD
)

// String returns the canonical lowercase wire value for the level.
func (e EducationLevel) String() string {
	switch e {
	case HighSchool:
		return "high_school"
	case Bachelor:
		return "bachelor"
	case Master:
		return "master"
	case PhD:
		return "phd"
	default:
		return "unknown_education"
	}
}

// ParseEducationLevel normalizes and validates a raw education_level string.
// The comparison is case-insensitive and trims surrounding whitespace so
// callers can pass user-provided text directly. Unknown values return
// ErrInvalidEducationLevel.
func ParseEducationLevel(raw string) (EducationLevel, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "high_school":
		return HighSchool, nil
	case "bachelor":
		return Bachelor, nil
	case "master":
		return Master, nil
	case "phd":
		return PhD, nil
	default:
		return UnknownEducation, ErrInvalidEducationLevel
	}
}
