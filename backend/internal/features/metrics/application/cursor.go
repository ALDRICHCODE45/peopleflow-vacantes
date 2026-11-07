package application

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"

	"github.com/google/uuid"
)

const maxCursorBytes = 4096

// Position is the last item of the previous page: its sort key (null sorts
// last) and id.
type Position struct {
	Key *string
	ID  uuid.UUID
}

type cursorWire struct {
	Version int       `json:"version"`
	Company uuid.UUID `json:"company_id"`
	Route   string    `json:"route"`
	Filters string    `json:"filters"`
	Key     *string   `json:"key"`
	ID      uuid.UUID `json:"id"`
}

// filterHash binds a cursor to the filters it was issued for: a page of other
// filters is never continued.
func filterHash(q Query) string {
	raw, _ := json.Marshal(struct {
		From, To, Outcome, DeliveryResult string
		RecruiterID                       *uuid.UUID
		Requester                         RequesterFilter
	}{q.From, q.To, q.Outcome, q.DeliveryResult, q.RecruiterID, q.Requester})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// EncodeCursor returns the opaque next_cursor.
func EncodeCursor(company uuid.UUID, route Route, q Query, p Position) (string, error) {
	raw, err := json.Marshal(cursorWire{1, company, route.String(), filterHash(q), p.Key, p.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// DecodeCursor accepts only an exact token this company issued for this route
// and these filters.
func DecodeCursor(company uuid.UUID, route Route, q Query, token string) (Position, error) {
	if token == "" || len(token) > maxCursorBytes {
		return Position{}, ErrInvalidCursor
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != token {
		return Position{}, ErrInvalidCursor
	}
	var wire cursorWire
	if err := json.Unmarshal(raw, &wire); err != nil {
		return Position{}, ErrInvalidCursor
	}
	canonical, err := json.Marshal(wire)
	if err != nil || string(canonical) != string(raw) || wire.Version != 1 || wire.Company != company ||
		wire.Route != route.String() || wire.Filters != filterHash(q) || wire.ID == uuid.Nil {
		return Position{}, ErrInvalidCursor
	}
	return Position{Key: wire.Key, ID: wire.ID}, nil
}
