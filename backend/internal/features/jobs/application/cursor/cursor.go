package cursor

import (
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/google/uuid"
)

// wire is the JSON shape the cursor serializes to. Field tags drive
// the on-wire key names ("t", "i", "r") so the design's wire format
// stays stable even if Go struct fields are renamed.
//
//	{
//	  "t": "2026-08-19T12:00:00.000000000Z",  // PublishedAt, RFC3339Nano (UTC)
//	  "i": "018e9b9c-…",                      // UUID v7 id
//	  "r": 0.421875                           // optional; search mode only
//	}
type wire struct {
	T string   `json:"t"`
	I string   `json:"i"`
	R *float64 `json:"r,omitempty"`
}

// Encode turns a domain Cursor into the opaque base64url(JSON) string
// the HTTP boundary hands back to the client. nil → empty string so the
// caller can pass the result through unconditionally (no first-page
// signal needed; empty string IS the first-page signal — matches
// Decode's "empty in → nil out" contract).
//
// Time is normalized to UTC and formatted with RFC3339Nano so the
// encoded bytes are deterministic across servers in different zones.
func Encode(c *repositories.Cursor) string {
	if c == nil {
		return ""
	}
	w := wire{
		T: c.PublishedAt.UTC().Format(time.RFC3339Nano),
		I: c.ID.String(),
	}
	if c.Rank != nil {
		// Copy off the field so the wire snapshot doesn't alias the
		// caller's pointer; a later mutation of *c.Rank must not be
		// observable through a previously returned cursor string.
		r := *c.Rank
		w.R = &r
	}
	raw, err := json.Marshal(w)
	if err != nil {
		// json.Marshal on this fixed-shape struct can't fail in
		// practice; if it does we degrade silently to the empty
		// string (== first page) rather than panic. The HTTP layer
		// never sees an error here.
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

// Decode is the inverse of Encode. Empty string, garbage, malformed
// JSON, missing fields, bad timestamps, and bad UUIDs ALL return nil —
// per the design decision "malformed cursor → tolerant first page, never
// error". Callers MUST treat nil as "first page", not "bad request".
func Decode(s string) *repositories.Cursor {
	if s == "" {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil
	}
	var w wire
	if err := json.Unmarshal(raw, &w); err != nil {
		return nil
	}
	if w.T == "" || w.I == "" {
		return nil
	}
	pubAt, err := time.Parse(time.RFC3339Nano, w.T)
	if err != nil {
		// RFC3339 accepts RFC3339Nano-shaped strings, so this
		// rejects obviously bad timestamps (empty handled above).
		return nil
	}
	id, err := uuid.Parse(w.I)
	if err != nil {
		return nil
	}
	return &repositories.Cursor{
		Rank:        w.R,
		PublishedAt: pubAt,
		ID:          id,
	}
}
