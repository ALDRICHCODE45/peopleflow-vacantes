package draftversion

import (
	"fmt"
	"strconv"
	"strings"
)

// schemeV2 is the fixed representation marker of the r2 draft ETag. It is a
// separate marker from scheme so an r2 tag can never be confused with an r1
// tag: the r2 parser accepts only `jd-r2` and the r1 parser never accepts r2.
const schemeV2 = "jd-r2"

// FormatETagV2 builds the exact quoted strong r2 ETag for a draft id and
// version.
//
// It is the r2 counterpart of FormatETag and shares its validation rules: the
// id must already be a lowercase UUID36 (validated, never case-folded, trimmed
// or repaired) and the version must be a positive int64. Invalid input returns
// an empty string and ErrInvalidID or ErrInvalidVersion, never a partial tag
// and never a panic. Standard library formatting only; no HTTP, store or auth
// concerns live here.
func FormatETagV2(id string, version int64) (string, error) {
	if !isLowerUUID36(id) {
		return "", fmt.Errorf("%w: %q", ErrInvalidID, id)
	}
	if version <= 0 {
		return "", fmt.Errorf("%w: %d", ErrInvalidVersion, version)
	}
	return `"` + schemeV2 + "-" + id + "-v" + strconv.FormatInt(version, 10) + `"`, nil
}

// ParseIfMatchV2 parses one r2 If-Match header value into a Tag.
//
// present must report whether the request actually carried an If-Match header;
// it is authoritative, so a keyed-but-empty header is not treated as missing.
// A missing header returns ErrPreconditionRequired. A present header is trimmed
// of leading and trailing HTTP OWS (SP and HTAB only) and must then be exactly
// one quoted strong `jd-r2` tag. Everything else — weak tags, a list, `*`, an
// unquoted tag, every non-HTTP whitespace byte, an r1 or unknown marker and
// every lexical defect — returns ErrInvalidRequest. The tag interior is never
// trimmed: a space inside the quotes is malformed, not repaired.
//
// The resource id uses the same lowercase UUID36 lexical policy as r1 (hex
// shape only; RFC 9562 version and variant nibbles are not enforced). The
// shared helpers are reused read-only so both schemes stay in lockstep on those
// lexical semantics.
func ParseIfMatchV2(value string, present bool) (Tag, error) {
	if !present {
		return Tag{}, ErrPreconditionRequired
	}

	raw := strings.Trim(value, " \t")
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return Tag{}, invalidHeader(value)
	}
	inner := raw[1 : len(raw)-1]

	prefix := schemeV2 + "-"
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
