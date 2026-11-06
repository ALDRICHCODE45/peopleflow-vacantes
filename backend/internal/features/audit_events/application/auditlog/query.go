package auditlog

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
	_ "time/tzdata" // America/Mexico_City must resolve in minimal containers
)

const MaxCursorBytes = 4096

const cursorLayout = "2006-01-02T15:04:05.000000Z"
const dateLayout = "2006-01-02"

// Filters are the list/export filters. The JSON tags are the hash input of the
// cursor, so they are part of the wire stability of old cursors.
type Filters struct {
	ActorID    *uuid.UUID `json:"actor_id"`
	EventTypes []string   `json:"event_types"`
	Category   string     `json:"category"`
	VacancyID  *uuid.UUID `json:"vacancy_id"`
	From       string     `json:"from"`
	To         string     `json:"to"`
}

type Query struct {
	Filters
	Limit int
	After *Position
}

// Position is the last item of the previous page.
type Position struct {
	At time.Time
	ID uuid.UUID
}

func filterHash(f Filters) string {
	if f.EventTypes == nil {
		f.EventTypes = []string{}
	}
	raw, _ := json.Marshal(f)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Types is the set of event types the filters select: the catalog, narrowed by
// event_type (OR) and category (AND). Never nil; empty selects nothing. Rows
// whose type is outside the catalog are never listed, so every row has a category.
func (f Filters) Types() []string {
	out := []string{}
	for _, spec := range entities.Catalog() {
		if f.Category != "" && string(spec.Category) != f.Category {
			continue
		}
		if len(f.EventTypes) > 0 && !slices.Contains(f.EventTypes, spec.Type) {
			continue
		}
		out = append(out, spec.Type)
	}
	return out
}

// Window converts the inclusive days into [from, toExclusive) instants in
// Mexico City. A zero time means no bound.
func (f Filters) Window() (from, toExclusive time.Time, err error) {
	loc, err := time.LoadLocation(TimeZone)
	if err != nil {
		return from, toExclusive, err
	}
	if f.From != "" {
		d, err := time.ParseInLocation(dateLayout, f.From, loc)
		if err != nil {
			return from, toExclusive, err
		}
		from = d
	}
	if f.To != "" {
		d, err := time.ParseInLocation(dateLayout, f.To, loc)
		if err != nil {
			return from, toExclusive, err
		}
		toExclusive = d.AddDate(0, 0, 1)
	}
	return from, toExclusive, nil
}

// AuditMetadata is the `filters` value of AuditLogExported: IDs, enums and
// dates only, unset filters omitted.
func (f Filters) AuditMetadata() map[string]any {
	out := map[string]any{}
	if f.ActorID != nil {
		out["actor_id"] = f.ActorID.String()
	}
	if len(f.EventTypes) > 0 {
		out["event_types"] = slices.Clone(f.EventTypes)
	}
	if f.Category != "" {
		out["category"] = f.Category
	}
	if f.VacancyID != nil {
		out["vacancy_id"] = f.VacancyID.String()
	}
	if f.From != "" {
		out["from"] = f.From
	}
	if f.To != "" {
		out["to"] = f.To
	}
	return out
}

// rawFilters are the filter values as the client sent them, before validation.
type rawFilters struct {
	actorID, category, vacancyID, from, to *string
	eventTypes                             []string
}

func canonicalUUID(v string) (uuid.UUID, bool) {
	id, err := uuid.Parse(v)
	return id, err == nil && id != uuid.Nil && id.String() == v
}

func validDate(v string) (time.Time, bool) {
	d, err := time.Parse(dateLayout, v)
	return d, err == nil && d.Format(dateLayout) == v
}

// build validates the raw values into Filters, recording one code per field.
// typesField names the event type field in errors (event_type / event_types).
func (r rawFilters) build(typesField string, failures map[string]string) Filters {
	var f Filters
	if r.actorID != nil {
		if id, ok := canonicalUUID(*r.actorID); ok {
			f.ActorID = &id
		} else {
			failures["actor_id"] = "invalid"
		}
	}
	if r.vacancyID != nil {
		if id, ok := canonicalUUID(*r.vacancyID); ok {
			f.VacancyID = &id
		} else {
			failures["vacancy_id"] = "invalid"
		}
	}
	if r.category != nil {
		valid := false
		for _, c := range entities.Categories() {
			valid = valid || string(c) == *r.category
		}
		if valid {
			f.Category = *r.category
		} else {
			failures["category"] = "invalid"
		}
	}
	if len(r.eventTypes) > 0 {
		valid := true
		for _, t := range r.eventTypes {
			if _, ok := entities.LookupEvent(t); !ok {
				valid = false
			}
		}
		if valid {
			f.EventTypes = slices.Clone(r.eventTypes)
			slices.Sort(f.EventTypes)
			f.EventTypes = slices.Compact(f.EventTypes)
		} else {
			failures[typesField] = "invalid"
		}
	}
	var from, to time.Time
	var fromOK, toOK bool
	if r.from != nil {
		if from, fromOK = validDate(*r.from); fromOK {
			f.From = *r.from
		} else {
			failures["from"] = "invalid"
		}
	}
	if r.to != nil {
		if to, toOK = validDate(*r.to); toOK {
			f.To = *r.to
		} else {
			failures["to"] = "invalid"
		}
	}
	if fromOK && toOK && from.After(to) {
		failures["to"] = "range"
	}
	return f
}

func invalidFilter(failures map[string]string) *InvalidFilter {
	fields := make([]Field, 0, len(failures))
	for key, code := range failures {
		fields = append(fields, Field{key, code})
	}
	slices.SortFunc(fields, func(a, b Field) int { return strings.Compare(a.Field, b.Field) })
	return &InvalidFilter{Fields: fields}
}

// reportedKey keeps a client-chosen parameter name out of the response unless
// it is a short, plain ASCII name.
func reportedKey(k string) string {
	if len(k) > 40 {
		return "query"
	}
	for _, r := range k {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' || r == '[' || r == ']') {
			return "query"
		}
	}
	return k
}

// ParseQuery is the strict list parser: unknown, duplicate and invalid
// parameters are rejected with field codes and never echo the value. A cursor
// problem is reported separately as ErrInvalidCursor, after the filters pass.
func ParseQuery(company uuid.UUID, raw string) (Query, error) {
	values := map[string][]string{}
	failures := map[string]string{}
	for _, pair := range strings.Split(raw, "&") {
		if pair == "" {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		k, ke := url.QueryUnescape(key)
		v, ve := url.QueryUnescape(value)
		if ke != nil || !utf8.ValidString(k) {
			failures["query"] = "invalid"
			continue
		}
		if ve != nil || strings.Contains(pair, ";") {
			failures[reportedKey(k)] = "invalid"
		}
		values[k] = append(values[k], v)
	}
	single := []string{"actor_id", "category", "vacancy_id", "from", "to", "limit", "cursor"}
	in := rawFilters{}
	limit := DefaultLimit
	for key, vs := range values {
		repeatable := key == "event_type"
		if !repeatable && !slices.Contains(single, key) {
			failures[reportedKey(key)] = "unknown"
			continue
		}
		if !repeatable && len(vs) != 1 {
			failures[key] = "duplicate"
			continue
		}
		if _, bad := failures[key]; bad {
			continue
		}
		for _, v := range vs {
			// An empty or odd cursor is ErrInvalidCursor, decided after the filters.
			if key != "cursor" && (v == "" || !utf8.ValidString(v)) {
				failures[key] = "invalid"
				break
			}
		}
		if _, bad := failures[key]; bad {
			continue
		}
		v := vs[0]
		switch key {
		case "actor_id":
			in.actorID = &v
		case "vacancy_id":
			in.vacancyID = &v
		case "category":
			in.category = &v
		case "from":
			in.from = &v
		case "to":
			in.to = &v
		case "event_type":
			in.eventTypes = vs
		case "limit":
			n, err := strconv.Atoi(v)
			if err != nil || len(v) > 3 || strings.Trim(v, "0123456789") != "" || n < 1 || n > MaxLimit {
				failures["limit"] = "invalid"
			} else {
				limit = n
			}
		}
	}
	q := Query{Limit: limit, Filters: in.build("event_type", failures)}
	if len(failures) > 0 {
		return Query{}, invalidFilter(failures)
	}
	if token, ok := values["cursor"]; ok {
		position, err := decodeCursor(company, q.Filters, token[0])
		if err != nil {
			return Query{}, err
		}
		q.After = &position
	}
	return q, nil
}

type cursorWire struct {
	Version    int       `json:"version"`
	CompanyID  uuid.UUID `json:"company_id"`
	Filters    string    `json:"filters"`
	OccurredAt string    `json:"occurred_at"`
	ID         uuid.UUID `json:"id"`
}

func encodeCursor(company uuid.UUID, f Filters, p Position) (string, error) {
	raw, err := json.Marshal(cursorWire{1, company, filterHash(f), p.At.UTC().Truncate(time.Microsecond).Format(cursorLayout), p.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeCursor(company uuid.UUID, f Filters, token string) (Position, error) {
	if token == "" || len(token) > MaxCursorBytes {
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
	// Exact re-encoding rejects duplicate or unknown keys, non-canonical UUIDs,
	// alternate number spellings and trailing JSON.
	canonical, err := json.Marshal(wire)
	if err != nil || string(canonical) != string(raw) || wire.Version != 1 || wire.CompanyID != company || wire.Filters != filterHash(f) || wire.ID == uuid.Nil {
		return Position{}, ErrInvalidCursor
	}
	at, err := time.Parse(cursorLayout, wire.OccurredAt)
	if err != nil || at.Format(cursorLayout) != wire.OccurredAt {
		return Position{}, ErrInvalidCursor
	}
	return Position{At: at, ID: wire.ID}, nil
}
