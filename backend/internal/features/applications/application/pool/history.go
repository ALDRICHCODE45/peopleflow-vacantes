package pool

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

type HistoryPosition struct {
	At time.Time
	ID uuid.UUID
}
type HistoryQuery struct {
	Limit int
	After *HistoryPosition
}
type historyCursor struct {
	Version   int       `json:"v"`
	Company   uuid.UUID `json:"company"`
	Kind      string    `json:"kind"`
	Candidate uuid.UUID `json:"candidate"`
	At        string    `json:"at"`
	ID        uuid.UUID `json:"id"`
}

func ParseHistoryQuery(company uuid.UUID, kind string, id uuid.UUID, raw string) (HistoryQuery, error) {
	q := HistoryQuery{Limit: 20}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return q, board.ErrInvalidRequest
	}
	for key, values := range values {
		if (key != "cursor" && key != "limit") || len(values) != 1 {
			return q, board.ErrInvalidRequest
		}
	}
	if v, ok := values["limit"]; ok {
		n, err := strconv.Atoi(v[0])
		if err != nil || len(v[0]) > 2 || strings.Trim(v[0], "0123456789") != "" || n < 1 || n > 50 {
			return q, board.ErrInvalidRequest
		}
		q.Limit = n
	}
	if v, ok := values["cursor"]; ok {
		token := v[0]
		if len(token) == 0 || len(token) > MaxCursorBytes {
			return q, ErrInvalidCursor
		}
		raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
		if err != nil || base64.RawURLEncoding.EncodeToString(raw) != token {
			return q, ErrInvalidCursor
		}
		var c historyCursor
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if dec.Decode(&c) != nil {
			return q, ErrInvalidCursor
		}
		if _, err := dec.Token(); err != io.EOF {
			return q, ErrInvalidCursor
		}
		// Require canonical JSON as well: rejects duplicate keys and alternate UUIDs.
		canonical, _ := json.Marshal(c)
		if !bytes.Equal(raw, canonical) {
			return q, ErrInvalidCursor
		}
		at, err := time.Parse(cursorLayout, c.At)
		if err != nil || at.Format(cursorLayout) != c.At || c.Version != 1 || c.Company != company || c.Kind != kind || c.Candidate != id || c.ID == uuid.Nil || at.IsZero() {
			return q, ErrInvalidCursor
		}
		q.After = &HistoryPosition{at, c.ID}
	}
	return q, nil
}
func (s *Service) History(ctx context.Context, company uuid.UUID, kind string, id uuid.UUID, raw string) (HistoryPage, error) {
	q, err := ParseHistoryQuery(company, kind, id, raw)
	if err != nil {
		return HistoryPage{}, err
	}
	editor, ok := s.reader.(Editor)
	if !ok {
		return HistoryPage{}, errors.New("candidate history unavailable")
	}
	page, err := editor.History(ctx, company, kind, id, q)
	if err != nil {
		return HistoryPage{}, err
	}
	if page.Items == nil {
		page.Items = []HistoryEntry{}
	}
	if len(page.Items) > q.Limit {
		page.Items = page.Items[:q.Limit]
		last := page.Items[q.Limit-1]
		raw, _ := json.Marshal(historyCursor{1, company, kind, id, last.At.UTC().Format(cursorLayout), last.ID})
		token := base64.RawURLEncoding.EncodeToString(raw)
		page.NextCursor = &token
	}
	return page, nil
}
