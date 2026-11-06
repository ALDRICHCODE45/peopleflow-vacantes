package auditlog

import (
	"bytes"
	"encoding/json"
	"io"
	"slices"
	"time"
)

// ParseExport decodes the export body strictly: one JSON object, only the six
// filter fields, none repeated. from and to are required and span at most
// MaxExportDays calendar days, both ends inclusive; a bad range is reported on
// `to`. A body that is not one JSON object is ErrInvalidBody.
func ParseExport(body []byte) (Filters, error) {
	fields, duplicates, err := decodeObject(body)
	if err != nil {
		return Filters{}, ErrInvalidBody
	}
	failures := map[string]string{}
	for _, key := range duplicates {
		failures[reportedKey(key)] = "duplicate"
	}
	in := rawFilters{}
	optionalString := func(key string, dst **string) {
		raw, ok := fields[key]
		if !ok || failures[key] != "" {
			return
		}
		var s *string
		if err := json.Unmarshal(raw, &s); err != nil {
			failures[key] = "invalid"
			return
		}
		*dst = s
	}
	for key := range fields {
		switch key {
		case "actor_id", "event_types", "category", "vacancy_id", "from", "to":
		default:
			if failures[reportedKey(key)] == "" {
				failures[reportedKey(key)] = "unknown"
			}
		}
	}
	optionalString("actor_id", &in.actorID)
	optionalString("category", &in.category)
	optionalString("vacancy_id", &in.vacancyID)
	optionalString("from", &in.from)
	optionalString("to", &in.to)
	if raw, ok := fields["event_types"]; ok && failures["event_types"] == "" {
		var types []string
		if err := json.Unmarshal(raw, &types); err != nil {
			failures["event_types"] = "invalid"
		}
		in.eventTypes = types
	}
	for _, key := range []string{"from", "to"} {
		if failures[key] == "" && (map[string]*string{"from": in.from, "to": in.to})[key] == nil {
			failures[key] = "required"
		}
	}
	f := in.build("event_types", failures)
	if failures["to"] == "" && f.From != "" && f.To != "" {
		from, _ := time.Parse(dateLayout, f.From)
		to, _ := time.Parse(dateLayout, f.To)
		if int(to.Sub(from).Hours()/24)+1 > MaxExportDays {
			failures["to"] = "range"
		}
	}
	if len(failures) > 0 {
		return Filters{}, invalidFilter(failures)
	}
	return f, nil
}

// decodeObject reads one JSON object, keeping each value raw and reporting the
// keys that appear more than once.
func decodeObject(body []byte) (fields map[string]json.RawMessage, duplicates []string, err error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, nil, ErrInvalidBody
	}
	fields = map[string]json.RawMessage{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, nil, ErrInvalidBody
		}
		key, ok := tok.(string)
		if !ok {
			return nil, nil, ErrInvalidBody
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, nil, ErrInvalidBody
		}
		if _, seen := fields[key]; seen {
			if !slices.Contains(duplicates, key) {
				duplicates = append(duplicates, key)
			}
			continue
		}
		fields[key] = value
	}
	if tok, err := dec.Token(); err != nil || tok != json.Delim('}') {
		return nil, nil, ErrInvalidBody
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, nil, ErrInvalidBody
	}
	return fields, duplicates, nil
}
