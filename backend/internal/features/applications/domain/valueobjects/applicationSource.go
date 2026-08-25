package valueobjects

import (
	"errors"
	"strings"
)

// ErrInvalidSource is returned when a raw source value does not match any
// member of the closed set {referral, linkedin, job_board, direct, other}.
// The HTTP classifier maps this sentinel to 400 with the body
// "invalid source".
var ErrInvalidSource = errors.New("invalid source")

// ApplicationSource is the closed-set classification of how the candidate
// learned about the job. The integer values are ordinal only; the wire
// representation is the canonical lowercase string.
//
// Zero value (UnknownApplicationSource) is intentionally invalid so a
// never-set field fails Parse* loud rather than silently serializing as
// a real source.
type ApplicationSource int

const (
	// UnknownApplicationSource is the invalid zero value.
	UnknownApplicationSource ApplicationSource = iota
	Referral
	LinkedIn
	JobBoard
	Direct
	Other
)

// String returns the canonical lowercase wire value. Unknown renders as
// "unknown_source" so a corrupted value never serializes as an empty
// string on the wire.
func (s ApplicationSource) String() string {
	switch s {
	case Referral:
		return "referral"
	case LinkedIn:
		return "linkedin"
	case JobBoard:
		return "job_board"
	case Direct:
		return "direct"
	case Other:
		return "other"
	default:
		return "unknown_source"
	}
}

// ParseApplicationSource validates a raw source string against the closed
// set {referral, linkedin, job_board, direct, other}. The match is
// case-insensitive and trims surrounding whitespace so callers can pass
// user-provided text directly (mirroring ParseMemberRole). Unknown values
// — including the spec example "newspaper" — return ErrInvalidSource so
// the HTTP layer can map to 400 without leaking the bad input.
func ParseApplicationSource(raw string) (ApplicationSource, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "referral":
		return Referral, nil
	case "linkedin":
		return LinkedIn, nil
	case "job_board":
		return JobBoard, nil
	case "direct":
		return Direct, nil
	case "other":
		return Other, nil
	default:
		return UnknownApplicationSource, ErrInvalidSource
	}
}
