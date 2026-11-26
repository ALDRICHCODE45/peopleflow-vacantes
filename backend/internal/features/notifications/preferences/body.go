package preferences

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// Limits of the PUT body (§Limits).
const (
	// MaxEntries is 11 member types × 2 channels rounded to the contract's 28.
	MaxEntries = 28
	// MaxBodyBytes caps the PUT body; 28 entries fit many times over.
	MaxBodyBytes = 16 << 10
)

// ErrInvalidRequest maps to 400 invalid_request: not exactly one JSON object
// of the expected shape (malformed, unknown member, preferences not a list,
// an entry not an object, trailing data).
var ErrInvalidRequest = errors.New("invalid notification preferences body")

// InvalidBody maps to 400 validation_error; Fields are in entry order and
// never echo a value.
type InvalidBody struct{ Fields []httpjson.ValidationField }

func (e *InvalidBody) Error() string { return "invalid notification preferences" }

// LockedError maps to 422 notification_preference_locked: the mandatory types
// the body targets, once each, in table order. Nothing is written.
type LockedError struct{ Types []string }

func (e *LockedError) Error() string { return "notification preference locked" }

// Entry is one validated PUT entry.
type Entry struct {
	Type    domain.Type
	Channel domain.Channel
	Enabled bool
}

// ParsePut validates a PUT body for the tree of kind (§PUT): 1–28 entries,
// each a type of this tree, a known channel and a boolean enabled, each pair
// at most once. Every validation failure of the whole list is reported
// together (InvalidBody); only a fully valid list is checked for locked
// types (LockedError).
func ParsePut(raw []byte, kind domain.RecipientKind) ([]Entry, error) {
	var body struct {
		Preferences *[]json.RawMessage `json:"preferences"`
	}
	if err := decodeStrict(raw, &body); err != nil {
		return nil, err
	}
	switch {
	case body.Preferences == nil:
		return nil, invalid(field("preferences", "required"))
	case len(*body.Preferences) == 0:
		return nil, invalid(field("preferences", "empty"))
	case len(*body.Preferences) > MaxEntries:
		return nil, invalid(field("preferences", "too_many"))
	}
	var fields []httpjson.ValidationField
	entries := make([]Entry, 0, len(*body.Preferences))
	seen := map[Pair]bool{}
	for i, rawEntry := range *body.Preferences {
		var e struct {
			Type    json.RawMessage `json:"type"`
			Channel json.RawMessage `json:"channel"`
			Enabled json.RawMessage `json:"enabled"`
		}
		if err := decodeStrict(rawEntry, &e); err != nil {
			return nil, err
		}
		prefix := fmt.Sprintf("preferences[%d]", i)
		typ, typeCode := parseType(e.Type, kind)
		channel, channelCode := parseChannel(e.Channel)
		enabled, enabledCode := parseEnabled(e.Enabled)
		for _, f := range []httpjson.ValidationField{{Field: ".channel", Code: channelCode}, {Field: ".enabled", Code: enabledCode}, {Field: ".type", Code: typeCode}} {
			if f.Code != "" {
				fields = append(fields, field(prefix+f.Field, f.Code))
			}
		}
		if typeCode != "" || channelCode != "" {
			continue
		}
		pair := Pair{typ, channel}
		if seen[pair] {
			fields = append(fields, field(prefix, "duplicate"))
			continue
		}
		seen[pair] = true
		entries = append(entries, Entry{Type: typ, Channel: channel, Enabled: enabled})
	}
	if len(fields) > 0 {
		return nil, invalid(fields...)
	}
	if locked := lockedTypes(kind, entries); len(locked) > 0 {
		return nil, &LockedError{Types: locked}
	}
	return entries, nil
}

// lockedTypes lists the mandatory types targeted by entries in table order.
func lockedTypes(kind domain.RecipientKind, entries []Entry) []string {
	targeted := map[domain.Type]bool{}
	for _, e := range entries {
		targeted[e.Type] = true
	}
	var out []string
	for _, spec := range TreeTypes(kind) {
		if targeted[spec.Type] && domain.Locked(spec.Type) {
			out = append(out, string(spec.Type))
		}
	}
	return out
}

func parseType(raw json.RawMessage, kind domain.RecipientKind) (domain.Type, string) {
	s, code := parseString(raw)
	if code != "" {
		return "", code
	}
	spec, ok := domain.Lookup(domain.Type(s))
	if !ok || spec.RecipientKind != kind {
		return "", "invalid"
	}
	return spec.Type, ""
}

func parseChannel(raw json.RawMessage) (domain.Channel, string) {
	s, code := parseString(raw)
	if code != "" {
		return "", code
	}
	if c := domain.Channel(s); c.Valid() {
		return c, ""
	}
	return "", "invalid"
}

func parseEnabled(raw json.RawMessage) (bool, string) {
	switch string(bytes.TrimSpace(raw)) {
	case "", "null":
		return false, "required"
	case "true":
		return true, ""
	case "false":
		return false, ""
	}
	return false, "invalid"
}

// parseString accepts a JSON string; absent or null is required, any other
// JSON type invalid.
func parseString(raw json.RawMessage) (string, string) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return "", "required"
	}
	var s string
	if err := json.Unmarshal(trimmed, &s); err != nil {
		return "", "invalid"
	}
	return s, ""
}

// decodeStrict decodes exactly one JSON object into dst, rejecting null,
// unknown members and trailing data.
func decodeStrict(raw []byte, dst any) error {
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || trimmed[0] != '{' {
		return ErrInvalidRequest
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return ErrInvalidRequest
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return ErrInvalidRequest
	}
	return nil
}

func field(name, code string) httpjson.ValidationField {
	return httpjson.ValidationField{Field: name, Code: code}
}

func invalid(fields ...httpjson.ValidationField) error { return &InvalidBody{Fields: fields} }
