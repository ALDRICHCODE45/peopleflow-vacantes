package valueobjects

import (
	"errors"
	"strings"
)

// ErrInvalidMemberRole is returned when a raw role value does not match any
// member of the closed set {owner, recruiter}. The HTTP layer maps this
// sentinel to 400 per the design error table.
var ErrInvalidMemberRole = errors.New("invalid member role")

// MemberRole is the closed-set classification of a user's authority inside
// a single company. The integer values are the canonical ordinal ranking:
// Owner can do anything a Recruiter can do, and the middleware
// `RequireCompanyRole(minRole)` checks `role >= minRole` against these
// numeric values. The textual representation is the wire format used in HTTP
// bodies and the database CHECK constraint.
//
// Zero value (UnknownMemberRole) is intentionally invalid — it has no valid
// string mapping and represents an uninitialized / unparseable input. A
// `var r MemberRole` must never silently act like RecruiterRole.
type MemberRole int

const (
	// UnknownMemberRole is the zero value returned for invalid inputs.
	UnknownMemberRole MemberRole = iota
	RecruiterRole
	OwnerRole
)

// String returns the canonical lowercase wire value for the role. The
// default branch returns "unknown_role" so JSON encoding never produces an
// empty string for a bad value.
func (r MemberRole) String() string {
	switch r {
	case RecruiterRole:
		return "recruiter"
	case OwnerRole:
		return "owner"
	default:
		return "unknown_role"
	}
}

// ParseMemberRole validates a raw role string against the closed set
// {owner, recruiter}. The match is case-insensitive and trims surrounding
// whitespace so callers can pass user-provided text directly. Unknown
// values — including the spec example "admin" — return ErrInvalidMemberRole
// so the HTTP layer can map to 400 without leaking the bad input.
func ParseMemberRole(raw string) (MemberRole, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "recruiter":
		return RecruiterRole, nil
	case "owner":
		return OwnerRole, nil
	default:
		return UnknownMemberRole, ErrInvalidMemberRole
	}
}
