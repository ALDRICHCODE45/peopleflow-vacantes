package valueobjects

import "errors"

// ErrInvalidCefrLevel is returned when a raw level value does not match any
// member of the closed set {A1, A2, B1, B2, C1, C2}. CEFR codes are
// case-sensitive uppercase by design — they must match the DB CHECK exactly,
// and lowercasing them would lose information (e.g. 'b1' and 'B1' should
// not be equivalent).
var ErrInvalidCefrLevel = errors.New("invalid CEFR level")

// CefrLevel is the closed-set classification of a candidate's proficiency in
// a language. The textual representation is the wire format used in HTTP
// bodies and the database CHECK constraint.
type CefrLevel int

const (
	// UnknownCefrLevel is the zero value returned for invalid inputs.
	UnknownCefrLevel CefrLevel = iota
	A1
	A2
	B1
	B2
	C1
	C2
)

// String returns the canonical uppercase wire value for the level.
func (l CefrLevel) String() string {
	switch l {
	case A1:
		return "A1"
	case A2:
		return "A2"
	case B1:
		return "B1"
	case B2:
		return "B2"
	case C1:
		return "C1"
	case C2:
		return "C2"
	default:
		return "unknown_cefr"
	}
}

// ParseCefrLevel validates a raw CEFR level string. The match is exact and
// case-sensitive: "A1" is valid, "a1" is not. CEFR does not have a notion of
// "trimming whitespace" — typos like "A1 " are rejected so the error path
// lights up instead of silently dropping the user's input.
func ParseCefrLevel(raw string) (CefrLevel, error) {
	switch raw {
	case "A1":
		return A1, nil
	case "A2":
		return A2, nil
	case "B1":
		return B1, nil
	case "B2":
		return B2, nil
	case "C1":
		return C1, nil
	case "C2":
		return C2, nil
	default:
		return UnknownCefrLevel, ErrInvalidCefrLevel
	}
}
