// Package requesters holds the transport-independent rules of the requester
// catalog (contract §7): kind and limit parsing, search-query normalization,
// and the opaque keyset cursor. It performs no IO.
package requesters

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// Requester kinds accepted by the catalog.
const (
	KindInternalArea = "internal_area"
	KindClient       = "client"
)

// List bounds (contract §7: limit defaults 20, range 1..50).
const (
	DefaultLimit = 20
	MaxLimit     = 50
)

// MaxCursorBytes bounds the encoded cursor token.
const MaxCursorBytes = 4096

// cursorVersion is the only cursor wire version.
const cursorVersion = 1

// ErrInvalidRequest marks malformed list input (kind, limit, q or cursor).
var ErrInvalidRequest = errors.New("requesters: invalid request")

// Query is a normalized search prefix. Normalized is the display-normalized
// text echoed in the cursor; Key is its full-casefold lookup prefix. The zero
// Query matches every entry.
type Query struct {
	Normalized string
	Key        string
}

// Scope is the request scope a cursor must belong to.
type Scope struct {
	CompanyID   uuid.UUID
	Kind        string
	QNormalized string
}

// Cursor is the keyset position after the last returned entry.
type Cursor struct {
	CompanyID   uuid.UUID
	Kind        string
	QNormalized string
	LastNameKey string
	LastID      uuid.UUID
}

// ParseKind validates a requester kind. Matching is exact: no case folding
// or trimming.
func ParseKind(raw string) (string, error) {
	switch raw {
	case KindInternalArea, KindClient:
		return raw, nil
	default:
		return "", ErrInvalidRequest
	}
}

// ParseLimit parses the optional page size: empty means DefaultLimit; anything
// else must be plain decimal digits in 1..MaxLimit.
func ParseLimit(raw string) (int, error) {
	if raw == "" {
		return DefaultLimit, nil
	}
	if len(raw) > 2 || strings.Trim(raw, "0123456789") != "" {
		return 0, ErrInvalidRequest
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > MaxLimit {
		return 0, ErrInvalidRequest
	}
	return n, nil
}

// NormalizeQuery applies the requester-name normalization to the optional
// search prefix. Empty or whitespace-only input is the zero Query; otherwise
// the normalized prefix is bounded to MaxRequesterNameCodepoints.
func NormalizeQuery(raw string) (Query, error) {
	name, err := valueobjects.NewRequesterName(raw)
	switch {
	case errors.Is(err, valueobjects.ErrRequesterNameEmpty):
		return Query{}, nil
	case err != nil:
		return Query{}, ErrInvalidRequest
	}
	return Query{Normalized: name.Value(), Key: name.Key()}, nil
}

// cursorWire is the exact JSON shape of a version-1 cursor.
type cursorWire struct {
	Version     json.RawMessage `json:"version"`
	CompanyID   string          `json:"company_id"`
	Kind        string          `json:"kind"`
	QNormalized string          `json:"q_normalized"`
	LastNameKey string          `json:"last_name_key"`
	LastID      string          `json:"last_id"`
}

// cursorKeys is the closed key set every cursor must carry exactly once.
var cursorKeys = []string{"version", "company_id", "kind", "q_normalized", "last_name_key", "last_id"}

// EncodeCursor serializes c as unpadded base64url JSON. It is not a
// credential: the caller's session scope is always re-applied in SQL.
func EncodeCursor(c Cursor) (string, error) {
	raw, err := json.Marshal(cursorWire{
		Version:     json.RawMessage(strconv.Itoa(cursorVersion)),
		CompanyID:   c.CompanyID.String(),
		Kind:        c.Kind,
		QNormalized: c.QNormalized,
		LastNameKey: c.LastNameKey,
		LastID:      c.LastID.String(),
	})
	if err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if len(token) > MaxCursorBytes {
		return "", ErrInvalidRequest
	}
	return token, nil
}

// DecodeCursor parses token and validates its version, exact key set, types,
// canonical UUIDs, normalized query, canonical casefold key and scope. Every
// failure is ErrInvalidRequest.
func DecodeCursor(token string, scope Scope) (Cursor, error) {
	if token == "" || len(token) > MaxCursorBytes {
		return Cursor{}, ErrInvalidRequest
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil {
		return Cursor{}, ErrInvalidRequest
	}
	// encoding/json silently repairs invalid UTF-8 and lone surrogate escapes;
	// the strict draft decoder rejects them before any field is read.
	if _, err := draftjson.Decode(raw); err != nil {
		return Cursor{}, ErrInvalidRequest
	}
	if !hasExactKeys(raw) {
		return Cursor{}, ErrInvalidRequest
	}
	var wire cursorWire
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wire); err != nil {
		return Cursor{}, ErrInvalidRequest
	}
	// The raw token must be exactly the JSON number 1: not "1", 1.0 or 1e0.
	if string(wire.Version) != strconv.Itoa(cursorVersion) {
		return Cursor{}, ErrInvalidRequest
	}

	companyID, ok := canonicalUUID(wire.CompanyID)
	if !ok || companyID != scope.CompanyID {
		return Cursor{}, ErrInvalidRequest
	}
	if _, err := ParseKind(wire.Kind); err != nil || wire.Kind != scope.Kind {
		return Cursor{}, ErrInvalidRequest
	}
	query, err := NormalizeQuery(wire.QNormalized)
	if err != nil || query.Normalized != wire.QNormalized || wire.QNormalized != scope.QNormalized {
		return Cursor{}, ErrInvalidRequest
	}
	if !canonicalKey(wire.LastNameKey) || !strings.HasPrefix(wire.LastNameKey, query.Key) {
		return Cursor{}, ErrInvalidRequest
	}
	lastID, ok := canonicalUUID(wire.LastID)
	if !ok {
		return Cursor{}, ErrInvalidRequest
	}
	return Cursor{
		CompanyID:   companyID,
		Kind:        wire.Kind,
		QNormalized: wire.QNormalized,
		LastNameKey: wire.LastNameKey,
		LastID:      lastID,
	}, nil
}

// hasExactKeys reports whether raw is a single JSON object declaring every
// cursor key exactly once and nothing else, with every key but version holding
// a JSON string. encoding/json alone would accept a duplicated key (last wins),
// a missing one (zero value) or null for a string field (empty string).
func hasExactKeys(raw []byte) bool {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if open, err := dec.Token(); err != nil || open != json.Delim('{') {
		return false
	}
	seen := make(map[string]bool, len(cursorKeys))
	for dec.More() {
		keyToken, err := dec.Token()
		if err != nil {
			return false
		}
		key, ok := keyToken.(string)
		if !ok || seen[key] {
			return false
		}
		seen[key] = true
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return false
		}
		if key != "version" && (len(value) == 0 || value[0] != '"') {
			return false
		}
	}
	if _, err := dec.Token(); err != nil {
		return false
	}
	if _, err := dec.Token(); err != io.EOF {
		return false
	}
	if len(seen) != len(cursorKeys) {
		return false
	}
	for _, key := range cursorKeys {
		if !seen[key] {
			return false
		}
	}
	return true
}

// canonicalUUID accepts only the lowercase hyphenated spelling.
func canonicalUUID(s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(s)
	if err != nil || id.String() != s {
		return uuid.UUID{}, false
	}
	return id, true
}

// canonicalKey reports whether s is a key a normalized requester name can
// produce: non-empty, a fixed point of the key algorithm (full casefold, then
// NFC), with no control characters and whitespace only as single inner ASCII
// spaces. The expanded key is deliberately not length-limited.
func canonicalKey(s string) bool {
	if s == "" || !utf8.ValidString(s) {
		return false
	}
	if s[0] == ' ' || s[len(s)-1] == ' ' || strings.Contains(s, "  ") {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || (r != ' ' && unicode.Is(unicode.White_Space, r)) {
			return false
		}
	}
	return norm.NFC.String(cases.Fold().String(s)) == s
}
