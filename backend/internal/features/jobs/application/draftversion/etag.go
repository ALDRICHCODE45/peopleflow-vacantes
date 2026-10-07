// Package draftversion owns the strong entity tag and If-Match precondition
// for private vacancy draft saves.
//
// Scope: this package is pure. It formats and parses the exact quoted tag
// `"jd-r1-<lowercaseUUID36>-v<positiveDecimalVersion>"` and compares a parsed
// tag against the tag issued for the addressed draft. It never reads HTTP,
// never touches the database and never authenticates. Authorization must run
// before Compare so an unauthorized or cross-organization draft still fails
// with its own not-found/forbidden result instead of leaking a version
// conflict.
package draftversion

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// scheme is the fixed representation marker of the draft ETag. It is part of
// the deterministic representation and must not change without invalidating
// every outstanding tag.
const scheme = "jd-r1"

// Sentinel errors. The HTTP layer maps them to the contract status codes:
// ErrPreconditionRequired -> 428 precondition_required, ErrInvalidRequest ->
// 400 invalid_request and ErrVersionConflict -> 412 version_conflict.
//
// ErrInvalidID and ErrInvalidVersion are server-side formatting failures: they
// mean the draft row handed to FormatETag is already invalid, not that a client
// sent a bad precondition.
var (
	ErrPreconditionRequired = errors.New("draftversion: if-match precondition required")
	ErrInvalidRequest       = errors.New("draftversion: invalid if-match header")
	ErrInvalidID            = errors.New("draftversion: invalid draft id")
	ErrInvalidVersion       = errors.New("draftversion: invalid draft version")
	ErrVersionConflict      = errors.New("draftversion: draft version conflict")
)

// Tag is a parsed strong draft entity tag.
//
// ID is the canonical lowercase UUID36 from the tag and Version is its positive
// version. Version is int64 because draft versions are stored as int64 in
// PostgreSQL; a value that does not fit int64 is rejected rather than parsed
// through float64, so no version precision is ever lost.
type Tag struct {
	ID      string
	Version int64
}

// FormatETag builds the exact quoted strong ETag for a draft id and version.
//
// The id must already be a lowercase UUID36: it is validated, never
// case-folded, trimmed or repaired. version must be positive; zero and negative
// values are rejected. Invalid input returns an error and an empty string,
// never a partially formatted tag and never a panic.
func FormatETag(id string, version int64) (string, error) {
	if !isLowerUUID36(id) {
		return "", fmt.Errorf("%w: %q", ErrInvalidID, id)
	}
	if version <= 0 {
		return "", fmt.Errorf("%w: %d", ErrInvalidVersion, version)
	}
	return `"` + scheme + "-" + id + "-v" + strconv.FormatInt(version, 10) + `"`, nil
}

// ParseIfMatch parses one If-Match header value into a Tag.
//
// present must report whether the request actually carried an If-Match header;
// it is authoritative, so a keyed-but-empty header is not treated as missing.
// A missing header returns ErrPreconditionRequired. A present header is trimmed
// of leading and trailing HTTP OWS (SP and HTAB only) and must then be exactly
// one quoted strong draft tag. Weak tags (`W/"…"`), a list of two or more tags,
// `*`, an unquoted tag and every lexical defect return ErrInvalidRequest. The
// tag interior is never trimmed: a space inside the quotes is malformed, not
// repaired.
//
// OWS choice: RFC 9110 permits optional whitespace around a header field value,
// so surrounding SP/HTAB is accepted. Go's net/http already trims header values,
// so this trim only keeps the pure function correct for raw callers; it does not
// relax the exact single-issued-tag rule.
func ParseIfMatch(value string, present bool) (Tag, error) {
	if !present {
		return Tag{}, ErrPreconditionRequired
	}

	raw := strings.Trim(value, " \t")
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return Tag{}, invalidHeader(value)
	}
	inner := raw[1 : len(raw)-1]

	prefix := scheme + "-"
	if !strings.HasPrefix(inner, prefix) {
		return Tag{}, invalidHeader(value)
	}
	rest := inner[len(prefix):]

	// The version separator is the last "-v": the UUID36 contains no 'v' and
	// the version is decimal, so no earlier occurrence can be the real one.
	sep := strings.LastIndex(rest, "-v")
	if sep < 0 {
		return Tag{}, invalidHeader(value)
	}
	id := rest[:sep]
	if !isLowerUUID36(id) {
		return Tag{}, invalidHeader(value)
	}
	version, err := parsePositiveVersion(rest[sep+2:])
	if err != nil {
		return Tag{}, invalidHeader(value)
	}
	return Tag{ID: id, Version: version}, nil
}

// Compare checks a presented If-Match tag against the tag issued for the
// addressed draft.
//
// It must run only after authentication and authorization: an unauthorized or
// cross-organization draft must already have produced its own not-found or
// forbidden result, so Compare never becomes an existence oracle. Any
// difference — a different draft id, or a presented version that is stale,
// newer or belongs to another id — returns ErrVersionConflict, which the HTTP
// layer maps to 412 with no editor data. The precondition is exact equality:
// the server-issued version, not the client version, is authoritative.
//
// Callers pass tags produced by FormatETag or ParseIfMatch. Compare does not
// re-validate them.
func Compare(issued, presented Tag) error {
	if issued.ID != presented.ID || issued.Version != presented.Version {
		return ErrVersionConflict
	}
	return nil
}

// invalidHeader wraps every malformed present If-Match value in
// ErrInvalidRequest and keeps the offending bytes for server-side logs.
func invalidHeader(value string) error {
	return fmt.Errorf("%w: %q", ErrInvalidRequest, value)
}

// parsePositiveVersion parses a decimal version string without float conversion.
//
// The string must be one or more ASCII digits with no sign, no decimal point,
// no whitespace and no leading zero; leading zeros are rejected so the version
// has exactly one canonical decimal representation. The value must fit int64 and
// be strictly positive, so "0", overflow and every non-numeric form are
// rejected.
func parsePositiveVersion(text string) (int64, error) {
	if text == "" || (len(text) > 1 && text[0] == '0') {
		return 0, ErrInvalidVersion
	}
	for i := 0; i < len(text); i++ {
		if text[i] < '0' || text[i] > '9' {
			return 0, ErrInvalidVersion
		}
	}
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil || value <= 0 {
		return 0, ErrInvalidVersion
	}
	return value, nil
}

// isLowerUUID36 reports whether id is exactly 36 bytes of lowercase hex in
// 8-4-4-2-12 form. It is a lexical check only: RFC 9562 version and variant
// nibbles are not enforced and the nil UUID is accepted. The contract fixes
// lowercase, so an uppercase UUID is rejected rather than case-folded.
func isLowerUUID36(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i := 0; i < len(id); i++ {
		switch i {
		case 8, 13, 18, 23:
			if id[i] != '-' {
				return false
			}
		default:
			if !isLowerHex(id[i]) {
				return false
			}
		}
	}
	return true
}

// isLowerHex reports whether c is an ASCII lowercase hexadecimal digit.
func isLowerHex(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')
}
