// Package assessment defines candidate-only projections and the assessment port.
package assessment

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

var (
	ErrNotFound        = errors.New("assessment not found")
	ErrUnavailable     = errors.New("assessment unavailable")
	ErrConsentRequired = errors.New("consent required")
	ErrNoticeChanged   = errors.New("notice changed")
	ErrFinished        = errors.New("assessment finished")
	ErrClosed          = errors.New("invitation closed")
	ErrInvalidRequest  = errors.New("invalid assessment request")
)

type Invalid struct{ Fields []httpjson.ValidationField }

func (*Invalid) Error() string { return "validation failed" }

// Access uses either a public token or a verified account subject, never both.
type Access struct {
	Public         bool
	Token, Subject string
	ID             uuid.UUID
}
type Command struct {
	EventID                   uuid.UUID
	Value                     *int
	ElapsedMS                 *int64
	NoticeVersion, TextSHA256 string
}
type Result struct {
	Status int
	Body   []byte
}
type Store interface {
	Execute(context.Context, Access, string, int, Command) (Result, error)
	List(context.Context, string) (Result, error)
}

// Decode accepts one flat object, rejects duplicate/unknown keys and never
// includes rejected values in validation errors.
func Decode(r io.Reader, action string) (Command, error) {
	var c Command
	d := json.NewDecoder(r)
	t, e := d.Token()
	if e != nil || t != json.Delim('{') {
		return c, ErrInvalidRequest
	}
	m := map[string]json.RawMessage{}
	for d.More() {
		t, e = d.Token()
		if e != nil {
			return c, ErrInvalidRequest
		}
		k, ok := t.(string)
		if !ok {
			return c, ErrInvalidRequest
		}
		if _, exists := m[k]; exists {
			return c, ErrInvalidRequest
		}
		var v json.RawMessage
		if d.Decode(&v) != nil {
			return c, ErrInvalidRequest
		}
		m[k] = v
	}
	if t, e = d.Token(); e != nil || t != json.Delim('}') {
		return c, ErrInvalidRequest
	}
	if _, e = d.Token(); e != io.EOF {
		return c, ErrInvalidRequest
	}
	allowed := map[string]bool{"event_id": true}
	if action == "put" {
		allowed["value"] = true
		allowed["client_elapsed_ms"] = true
	}
	if action == "consent" {
		allowed = map[string]bool{"notice_version": true, "text_sha256": true}
	}
	fields := []httpjson.ValidationField{}
	add := func(k, v string) { fields = append(fields, httpjson.ValidationField{Field: k, Code: v}) }
	keys := []string{}
	for k := range m {
		if !allowed[k] {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		add(k, "not_allowed")
	}
	text := func(k string) string {
		raw, ok := m[k]
		if !ok {
			add(k, "required")
			return ""
		}
		var s string
		if json.Unmarshal(raw, &s) != nil || string(raw) == "null" {
			add(k, "invalid")
		}
		return s
	}
	if action == "consent" {
		c.NoticeVersion = text("notice_version")
		c.TextSHA256 = text("text_sha256")
	} else {
		s := text("event_id")
		if s != "" {
			id, e := uuid.Parse(s)
			if e != nil {
				add("event_id", "invalid")
			} else {
				c.EventID = id
			}
		} else if _, ok := m["event_id"]; ok && string(m["event_id"]) == `""` {
			add("event_id", "invalid")
		}
		integer := func(k string, min, max int64, required bool) *int64 {
			raw, ok := m[k]
			if !ok {
				if required {
					add(k, "required")
				}
				return nil
			}
			n, e := strconv.ParseInt(string(raw), 10, 64)
			if e != nil || n < min || n > max {
				add(k, "invalid")
				return nil
			}
			return &n
		}
		if action == "put" {
			v := integer("value", 1, 5, true)
			if v != nil {
				n := int(*v)
				c.Value = &n
			}
			c.ElapsedMS = integer("client_elapsed_ms", 0, 3600000, false)
		}
	}
	if len(fields) > 0 {
		return c, &Invalid{fields}
	}
	return c, nil
}
