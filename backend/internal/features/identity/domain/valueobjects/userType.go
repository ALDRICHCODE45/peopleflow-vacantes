package valueobjects

import (
	"errors"
	"strings"
)

// ErrInvalidUserType is returned when the raw user type is not one of the
// closed-set values recognized by the bounded context.
var ErrInvalidUserType = errors.New("invalid user type")

// UserType is the closed-set classification of a person on the platform.
// The constants are the canonical Go representation; the textual wire format
// is what the DB CHECK constraint and the Cognito group mapping both expect.
type UserType int

const (
	// UnknownUserType is the zero value, returned for inputs that don't match
	// any member. It intentionally has no valid wire mapping so callers can
	// never compare against it directly.
	UnknownUserType UserType = iota
	UserCandidate
	UserRecruiter
)

// String returns the canonical lowercase wire value for the user type.
func (u UserType) String() string {
	switch u {
	case UserCandidate:
		return "candidate"
	case UserRecruiter:
		return "recruiter"
	default:
		return "unknown_user_type"
	}
}

// NewUserType normalizes the raw input and validates it against the closed
// set. The comparison is case-insensitive and trims surrounding whitespace,
// so callers can feed the value straight from JSON or query strings.
func NewUserType(raw string) (UserType, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "candidate":
		return UserCandidate, nil
	case "recruiter":
		return UserRecruiter, nil
	default:
		return UnknownUserType, ErrInvalidUserType
	}
}
