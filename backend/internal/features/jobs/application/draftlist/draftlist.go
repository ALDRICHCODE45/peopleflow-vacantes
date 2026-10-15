// Package draftlist holds the transport-independent rules of the employer
// draft list (GET /v2/me/company/job-drafts): limit parsing and the opaque
// keyset cursor. It performs no IO.
package draftlist

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

// List bounds: limit defaults 20, range 1..50 (same as the requester list).
const (
	DefaultLimit = 20
	MaxLimit     = 50
)

// MaxCursorBytes bounds the encoded cursor token.
const MaxCursorBytes = 4096

// cursorVersion is the only cursor wire version.
const cursorVersion = 1

// timestampLayout is the only accepted cursor timestamp spelling: UTC with
// exactly six fractional digits, the precision of PostgreSQL timestamptz.
const timestampLayout = "2006-01-02T15:04:05.000000Z"

// ErrInvalidRequest marks malformed list input (limit or cursor).
var ErrInvalidRequest = errors.New("draftlist: invalid request")

// Scope is the request scope a cursor must belong to. The actor is part of it
// because a recruiter and the owner see different draft sets.
type Scope struct {
	CompanyID uuid.UUID
	ActorID   uuid.UUID
}

// Cursor is the keyset position after the last returned draft in the order
// (updated_at DESC, id DESC).
type Cursor struct {
	CompanyID     uuid.UUID
	ActorID       uuid.UUID
	LastUpdatedAt time.Time
	LastID        uuid.UUID
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

// cursorWire is the exact JSON shape of a version-1 cursor; field order is the
// encoded key order.
type cursorWire struct {
	Version       int    `json:"version"`
	CompanyID     string `json:"company_id"`
	ActorID       string `json:"actor_id"`
	LastUpdatedAt string `json:"last_updated_at"`
	LastID        string `json:"last_id"`
}

// EncodeCursor serializes c as unpadded base64url JSON. The timestamp is
// truncated to microseconds in UTC. The cursor is not a credential: the
// caller's session scope is always re-applied in SQL.
func EncodeCursor(c Cursor) (string, error) {
	raw, err := json.Marshal(cursorWire{
		Version:       cursorVersion,
		CompanyID:     c.CompanyID.String(),
		ActorID:       c.ActorID.String(),
		LastUpdatedAt: c.LastUpdatedAt.UTC().Truncate(time.Microsecond).Format(timestampLayout),
		LastID:        c.LastID.String(),
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
// canonical UUIDs, canonical timestamp and scope. Every failure is
// ErrInvalidRequest.
func DecodeCursor(token string, scope Scope) (Cursor, error) {
	if token == "" || len(token) > MaxCursorBytes {
		return Cursor{}, ErrInvalidRequest
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil {
		return Cursor{}, ErrInvalidRequest
	}
	// The strict draft decoder rejects duplicate keys, invalid UTF-8, lone
	// surrogates, trailing data and non-integer numbers.
	doc, err := draftjson.Decode(raw)
	if err != nil {
		return Cursor{}, ErrInvalidRequest
	}
	object, ok := doc.(map[string]any)
	if !ok || len(object) != 5 {
		return Cursor{}, ErrInvalidRequest
	}
	// draftjson reads 1.0 and 1e0 as the integer 1; the raw token must be
	// exactly the JSON number 1. Keys are already known to be unique.
	var rawVersion struct {
		Version json.RawMessage `json:"version"`
	}
	if err := json.Unmarshal(raw, &rawVersion); err != nil || string(rawVersion.Version) != strconv.Itoa(cursorVersion) {
		return Cursor{}, ErrInvalidRequest
	}
	if version, ok := object["version"].(int64); !ok || version != cursorVersion {
		return Cursor{}, ErrInvalidRequest
	}
	strs := make(map[string]string, 4)
	for _, key := range []string{"company_id", "actor_id", "last_updated_at", "last_id"} {
		value, ok := object[key].(string)
		if !ok {
			return Cursor{}, ErrInvalidRequest
		}
		strs[key] = value
	}

	companyID, ok := canonicalUUID(strs["company_id"])
	if !ok || companyID != scope.CompanyID {
		return Cursor{}, ErrInvalidRequest
	}
	actorID, ok := canonicalUUID(strs["actor_id"])
	if !ok || actorID != scope.ActorID {
		return Cursor{}, ErrInvalidRequest
	}
	updatedAt, err := time.Parse(timestampLayout, strs["last_updated_at"])
	if err != nil || updatedAt.Format(timestampLayout) != strs["last_updated_at"] {
		return Cursor{}, ErrInvalidRequest
	}
	lastID, ok := canonicalUUID(strs["last_id"])
	if !ok {
		return Cursor{}, ErrInvalidRequest
	}
	return Cursor{CompanyID: companyID, ActorID: actorID, LastUpdatedAt: updatedAt, LastID: lastID}, nil
}

// canonicalUUID accepts only the lowercase hyphenated spelling.
func canonicalUUID(s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(s)
	if err != nil || id.String() != s {
		return uuid.UUID{}, false
	}
	return id, true
}
