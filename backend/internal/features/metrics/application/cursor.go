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
	Sort    string    `json:"sort"`
	Order   string    `json:"order"`
	Key     *string   `json:"key"`
	ID      uuid.UUID `json:"id"`
}

// cursorVersion 2 binds the sort and order (v2 §5); version 1 tokens are
// rejected.
const cursorVersion = 2

// filterHash binds a cursor to the filters it was issued for (every filter,
// sort and order; limit and the cursor itself excluded): a page of other
// filters is never continued.
func filterHash(q Query) string {
	q.Limit, q.Cursor = 0, nil
	raw, _ := json.Marshal(q)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// EncodeCursor returns the opaque next_cursor.
func EncodeCursor(company uuid.UUID, route Route, q Query, p Position) (string, error) {
	raw, err := json.Marshal(cursorWire{cursorVersion, company, route.String(), filterHash(q), q.Sort, q.Order, p.Key, p.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// DecodeCursor accepts only an exact token this company issued for this route,
// these filters, this sort and this order.
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
	if err != nil || string(canonical) != string(raw) || wire.Version != cursorVersion || wire.Company != company ||
		wire.Route != route.String() || wire.Filters != filterHash(q) || wire.Sort != q.Sort || wire.Order != q.Order || wire.ID == uuid.Nil {
		return Position{}, ErrInvalidCursor
	}
	return Position{Key: wire.Key, ID: wire.ID}, nil
}
