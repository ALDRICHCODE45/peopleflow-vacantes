// Package valueobjects (shared): tri-state presence type for PATCH DTOs.
//
// Lifted from internal/features/jobs/domain/valueobjects/optional.go
// (jobs D6, companies-write D6) so both jobs and companies can share one
// generic presence codec without a cross-feature import. The jobs file
// becomes a generic type alias re-export, so existing jobs call sites
// continue to compile unchanged (no churn at the call sites).
//
// The PATCH endpoint must distinguish three JSON presence states for the
// nullable profile columns:
//
//   - Absent   : key missing from the JSON body   → leave the column untouched
//   - Null     : key present as JSON `null`       → clear the column to SQL NULL
//   - Value    : key present with a value         → set the column to the value
//
// A plain `*string` / `*int` cannot express that (both absent and null
// decode to nil). `Optional[T]` adds one flag — `Set` — that flips to
// true the moment `UnmarshalJSON` runs, so the use case can distinguish
// "the client sent null" from "the client never sent the key".
package valueobjects

import (
	"bytes"
	"encoding/json"
)

// Optional is a tri-state presence for a PATCH field:
//
//   - Set   == false  → key absent from the JSON body (column untouched)
//   - Set   == true && Valid == false → JSON null (column cleared to NULL)
//   - Set   == true && Valid == true  → JSON value (column set to Value)
//
// The receiver is always a pointer in the DTO so `UnmarshalJSON` can
// mutate the caller's struct in place; passing by value silently drops
// the state because Go copies on method dispatch.
type Optional[T any] struct {
	Set   bool
	Valid bool
	Value T
}

// UnmarshalJSON implements the tri-state contract. It is intentionally
// the only place the three states are decided — every call site that
// reads an Optional MUST check `Set` first to distinguish absent from
// null, then `Valid` to distinguish null from value.
//
// The JSON `null` literal is detected with `bytes.TrimSpace` + an exact
// match (not `bytes.EqualFold`) so any capitalization or whitespace
// difference falls through to `json.Unmarshal` and surfaces as a real
// decode error — the client did not send JSON `null`.
func (o *Optional[T]) UnmarshalJSON(data []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		o.Valid = false
		return nil
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		// Surface the error AND leave the receiver in a state that
		// signals "not set" so a partial-decode caller (e.g. a DTO
		// struct that also has other fields) does not accidentally
		// see a stale Set=true from an earlier field.
		o.Valid = false
		return err
	}
	o.Valid = true
	o.Value = v
	return nil
}
