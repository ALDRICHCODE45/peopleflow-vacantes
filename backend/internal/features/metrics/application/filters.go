// Package application computes the company metrics of stakeholder-metrics-v1
// §2 from facts the store loads, and validates the §3.0 filters.
package application

import (
	"errors"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	// DefinitionsVersion travels on every response (§3.0).
	DefinitionsVersion = "v1"
	// TimeZone is the zone of every calendar rule (§2.0).
	TimeZone = "America/Mexico_City"
	// MaxSpanDays bounds to - from (M7).
	MaxSpanDays  = 365
	DefaultLimit = 50
	MaxLimit     = 100
)

// Route selects which parameters a request may carry.
type Route int

const (
	RouteSummary Route = iota
	RouteRecruiters
	RouteRecruiter
	RouteVacancies
	RouteReassignments
	RouteDetail
)

func (r Route) String() string {
	return [...]string{"summary", "recruiters", "recruiter", "vacancies", "reassignments", "detail"}[r]
}

func (r Route) paginated() bool {
	return r == RouteRecruiters || r == RouteVacancies || r == RouteReassignments
}

// RequesterFilter is the M6 requester selection. The zero value selects every
// vacancy; None with no Kind is «sin solicitante»; None with a Kind is «X sin
// especificar»; a Kind alone is every vacancy of that kind.
type RequesterFilter struct {
	Kind string
	ID   uuid.UUID
	None bool
}

// Query is a validated request.
type Query struct {
	From, To       string
	RecruiterID    *uuid.UUID
	Requester      RequesterFilter
	Outcome        string
	DeliveryResult string
	Limit          int
	Cursor         *string
}

// Field is one rejected parameter and its bounded code; the value is never echoed.
type Field struct {
	Field string
	Code  string
}

// InvalidFilter answers 422 invalid_filter with its fields (§3.0).
type InvalidFilter struct{ Fields []Field }

func (e *InvalidFilter) Error() string { return "invalid metrics filter" }

var (
	ErrInvalidCursor = errors.New("invalid metrics cursor")
	ErrNotFound      = errors.New("metrics resource not found")
)

var (
	outcomes        = []string{"filled", "cancelled", "other", "open"}
	deliveryResults = []string{"on_time", "late", "overdue", "pending", "not_configured"}
)

func (r Route) allows(key string) bool {
	switch key {
	case "from", "to", "recruiter_id", "requester_kind", "requester_id":
		return true
	case "limit", "cursor":
		return r.paginated()
	case "outcome", "delivery_result":
		return r == RouteVacancies
	}
	return false
}

func canonicalUUID(v string) (uuid.UUID, bool) {
	id, err := uuid.Parse(v)
	return id, err == nil && id != uuid.Nil && id.String() == v
}

func validDate(v string) (time.Time, bool) {
	d, err := time.Parse(time.DateOnly, v)
	return d, err == nil && d.Format(time.DateOnly) == v
}

// reportedKey keeps a client-chosen parameter name out of the response unless
// it is a short, plain ASCII name (the audit filters' rule).
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

// ParseQuery is the strict parser of the §3.0 parameters plus the route's
// extras: unknown, duplicate and invalid parameters are rejected together with
// one code per field. The cursor token is only checked later, against the
// filters it was issued for.
func ParseQuery(raw string, route Route) (Query, error) {
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
	q := Query{Limit: DefaultLimit}
	for key, vs := range values {
		switch {
		case !route.allows(key):
			failures[reportedKey(key)] = "unknown"
			continue
		case len(vs) != 1:
			failures[key] = "duplicate"
			continue
		case failures[key] != "":
			continue
		case key != "cursor" && (vs[0] == "" || !utf8.ValidString(vs[0])):
			failures[key] = "invalid"
			continue
		}
		v := vs[0]
		switch key {
		case "from":
			q.From = v
		case "to":
			q.To = v
		case "recruiter_id":
			if id, ok := canonicalUUID(v); ok {
				q.RecruiterID = &id
			} else {
				failures[key] = "invalid"
			}
		case "requester_kind":
			if v == "client" || v == "internal_area" {
				q.Requester.Kind = v
			} else {
				failures[key] = "invalid"
			}
		case "outcome":
			if slices.Contains(outcomes, v) {
				q.Outcome = v
			} else {
				failures[key] = "invalid"
			}
		case "delivery_result":
			if slices.Contains(deliveryResults, v) {
				q.DeliveryResult = v
			} else {
				failures[key] = "invalid"
			}
		case "limit":
			n, err := strconv.Atoi(v)
			if err != nil || len(v) > 3 || strings.Trim(v, "0123456789") != "" || n < 1 || n > MaxLimit {
				failures[key] = "invalid"
			} else {
				q.Limit = n
			}
		case "cursor":
			token := v
			q.Cursor = &token
		}
	}
	if vs, ok := values["requester_id"]; ok && failures["requester_id"] == "" {
		switch v := vs[0]; {
		case v == "none":
			q.Requester.None = true
		default:
			if id, ok := canonicalUUID(v); !ok {
				failures["requester_id"] = "invalid"
			} else if _, kind := values["requester_kind"]; !kind {
				// A real id needs its kind (M6).
				failures["requester_kind"] = "required"
			} else {
				q.Requester.ID = id
			}
		}
	}
	var from, to time.Time
	var fromOK, toOK bool
	for key, value := range map[string]string{"from": q.From, "to": q.To} {
		if _, sent := values[key]; !sent {
			failures[key] = "required"
		} else if failures[key] == "" {
			d, ok := validDate(value)
			if !ok {
				failures[key] = "invalid"
			} else if key == "from" {
				from, fromOK = d, true
			} else {
				to, toOK = d, true
			}
		}
	}
	if fromOK && toOK && (from.After(to) || to.Sub(from) > MaxSpanDays*24*time.Hour) {
		failures["to"] = "range"
	}
	if len(failures) > 0 {
		fields := make([]Field, 0, len(failures))
		for key, code := range failures {
			fields = append(fields, Field{key, code})
		}
		slices.SortFunc(fields, func(a, b Field) int { return strings.Compare(a.Field, b.Field) })
		return Query{}, &InvalidFilter{Fields: fields}
	}
	return q, nil
}
