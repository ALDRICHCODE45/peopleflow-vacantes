package v2

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strconv"

	"github.com/google/uuid"
)

func EncodeCursor(p Position) (string, error) {
	raw, err := json.Marshal(struct {
		Version  int      `json:"v"`
		Position Position `json:"position"`
	}{1, p})
	return base64.RawURLEncoding.EncodeToString(raw), err
}
func ParseQuery(raw string) (Query, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return Query{}, ErrInvalidRequest
	}
	q := Query{Limit: 20}
	for key, vs := range values {
		if len(vs) != 1 {
			return Query{}, ErrInvalidRequest
		}
		switch key {
		case "limit":
			n, err := strconv.Atoi(vs[0])
			if err != nil || n < 1 || n > 50 || strconv.Itoa(n) != vs[0] {
				return Query{}, ErrInvalidRequest
			}
			q.Limit = n
		case "cursor":
			token := vs[0]
			if len(token) > 2048 {
				return Query{}, ErrInvalidRequest
			}
			data, err := base64.RawURLEncoding.Strict().DecodeString(token)
			if err != nil {
				return Query{}, ErrInvalidRequest
			}
			var decoded struct {
				Version  int      `json:"v"`
				Position Position `json:"position"`
			}
			if err = json.Unmarshal(data, &decoded); err != nil {
				return Query{}, ErrInvalidRequest
			}
			canonical, err := EncodeCursor(decoded.Position)
			if err != nil || canonical != token || decoded.Version != 1 || decoded.Position.ID == uuid.Nil || decoded.Position.At.IsZero() {
				return Query{}, ErrInvalidRequest
			}
			q.After = &decoded.Position
		default:
			return Query{}, ErrInvalidRequest
		}
	}
	return q, nil
}
