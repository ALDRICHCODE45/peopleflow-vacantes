// Package inbox is the member read side of notifications-v1 (N4): the grouped
// list with the attention section (GET B) and the bell counter
// (GET B/unread-count) for B = /v2/me/company/notifications. Query parsing,
// the keyset cursor (D27), read-time resolution (D19) and the HTTP handler
// live here; reads are not audited (D23).
package inbox

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

// Limits of §Endpoints / §Limits.
const (
	StateAll       = "all"
	StateUnread    = "unread"
	DefaultLimit   = 20
	MaxLimit       = 50
	MaxTypes       = 14
	MaxJobIDs      = 20
	AttentionLimit = 20
	SampleLimit    = 3
	maxCursorBytes = 1024
	cursorLayout   = "2006-01-02T15:04:05.000000Z"
)

// Query is one validated GET B request. Types and JobIDs are sorted and
// de-duplicated (nil when absent); After is the keyset position of a cursor.
type Query struct {
	State  string
	Types  []string
	JobIDs []uuid.UUID
	Limit  int
	After  *Position
}

// Position is the last group of the previous page in latest_at DESC,
// group_key DESC order.
type Position struct {
	At       time.Time
	GroupKey string
}

// Field names a rejected query parameter and a bounded code, never the value.
type Field struct {
	Field string
	Code  string
}

// InvalidFilter maps to 400 invalid_filter with fields[].
type InvalidFilter struct{ Fields []Field }

func (e *InvalidFilter) Error() string { return "invalid notifications filter" }

// ErrInvalidCursor maps to 400 invalid_cursor.
var ErrInvalidCursor = errors.New("invalid notifications cursor")

// ParseQuery validates the common filters plus limit and cursor (§Endpoints):
// unknown state / types values, malformed job_ids, too many values, a limit out
// of 1–50 and a repeated parameter are invalid_filter; a cursor that does not
// decode or was issued for other filters is invalid_cursor (checked only when
// the filters are valid). Unknown parameters are ignored.
func ParseQuery(values url.Values) (Query, error) {
	q := Query{State: StateAll, Limit: DefaultLimit}
	failures := map[string]string{}
	single := func(key string) (string, bool) {
		vs, ok := values[key]
		if !ok {
			return "", false
		}
		if len(vs) != 1 {
			failures[key] = "duplicate"
			return "", false
		}
		return vs[0], true
	}
	if v, ok := single("state"); ok {
		if v != StateAll && v != StateUnread {
			failures["state"] = "invalid"
		}
		q.State = v
	}
	if v, ok := single("types"); ok {
		parts := strings.Split(v, ",")
		switch {
		case len(parts) > MaxTypes:
			failures["types"] = "too_many"
		default:
			for _, p := range parts {
				if _, known := domain.Lookup(domain.Type(p)); !known {
					failures["types"] = "invalid"
					break
				}
			}
		}
		if failures["types"] == "" {
			slices.Sort(parts)
			q.Types = slices.Compact(parts)
		}
	}
	if v, ok := single("job_ids"); ok {
		parts := strings.Split(v, ",")
		if len(parts) > MaxJobIDs {
			failures["job_ids"] = "too_many"
		} else {
			ids := make([]uuid.UUID, 0, len(parts))
			for _, p := range parts {
				id, err := uuid.Parse(p)
				if err != nil || len(p) != 36 || id == uuid.Nil {
					failures["job_ids"] = "invalid"
					break
				}
				ids = append(ids, id)
			}
			if failures["job_ids"] == "" {
				slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
				q.JobIDs = slices.Compact(ids)
			}
		}
	}
	if v, ok := single("limit"); ok {
		n, err := strconv.Atoi(v)
		if err != nil || v == "" || strings.Trim(v, "0123456789") != "" || n < 1 || n > MaxLimit {
			failures["limit"] = "invalid"
		}
		q.Limit = n
	}
	cursor, hasCursor := single("cursor")
	if len(failures) > 0 {
		fields := make([]Field, 0, len(failures))
		for key, code := range failures {
			fields = append(fields, Field{key, code})
		}
		slices.SortFunc(fields, func(a, b Field) int { return strings.Compare(a.Field, b.Field) })
		return Query{}, &InvalidFilter{Fields: fields}
	}
	if hasCursor {
		after, err := decodeCursor(q, cursor)
		if err != nil {
			return Query{}, err
		}
		q.After = &after
	}
	return q, nil
}

// filterHash binds a cursor to state, types and job_ids (D27); limit may change
// between pages.
func filterHash(q Query) string {
	ids := make([]string, len(q.JobIDs))
	for i, id := range q.JobIDs {
		ids[i] = id.String()
	}
	raw, _ := json.Marshal(struct {
		State  string   `json:"state"`
		Types  []string `json:"types"`
		JobIDs []string `json:"job_ids"`
	}{q.State, q.Types, ids})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:16])
}

type cursorWire struct {
	V  int    `json:"v"`
	At string `json:"at"`
	GK string `json:"gk"`
	F  string `json:"f"`
}

// EncodeCursor returns the opaque cursor after p for the filters of q.
func EncodeCursor(q Query, p Position) string {
	raw, _ := json.Marshal(cursorWire{V: 1, At: p.At.UTC().Truncate(time.Microsecond).Format(cursorLayout), GK: p.GroupKey, F: filterHash(q)})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeCursor(q Query, token string) (Position, error) {
	if token == "" || len(token) > maxCursorBytes {
		return Position{}, ErrInvalidCursor
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil {
		return Position{}, ErrInvalidCursor
	}
	var wire cursorWire
	if err := json.Unmarshal(raw, &wire); err != nil {
		return Position{}, ErrInvalidCursor
	}
	// The exact re-encoding rejects unknown or duplicate keys and other shapes.
	canonical, err := json.Marshal(wire)
	if err != nil || string(canonical) != string(raw) || wire.V != 1 || wire.F != filterHash(q) || len(wire.GK) < 3 || len(wire.GK) > 120 {
		return Position{}, ErrInvalidCursor
	}
	at, err := time.Parse(cursorLayout, wire.At)
	if err != nil || at.Format(cursorLayout) != wire.At {
		return Position{}, ErrInvalidCursor
	}
	return Position{At: at, GroupKey: wire.GK}, nil
}
