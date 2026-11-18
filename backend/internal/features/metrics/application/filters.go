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
	// DefinitionsVersion travels on every response (v2 §3).
	DefinitionsVersion = "v2"
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
	RouteClosures
	RouteCompliance
	RouteDelays
	RouteOrigin
	RouteDeliveries
	RoutePlacements
	RoutePipeline
	RouteCandidates
	RouteApplications
	// The company dashboard lists (company-dashboard-v2 §5) have their own
	// parser (parseDashboardList); the route names bind their cursors.
	RouteDashboardCandidates
	RouteDashboardDeliveries
	RouteDashboardVacancies
	RouteDashboardApplications
)

func (r Route) String() string {
	return [...]string{"summary", "recruiters", "recruiter", "vacancies", "reassignments", "detail", "closures", "compliance", "delays", "origin", "deliveries", "placements", "pipeline", "candidates", "applications",
		"dashboard_candidates", "dashboard_deliveries", "dashboard_vacancies", "dashboard_applications"}[r]
}

func (r Route) paginated() bool {
	return r == RouteRecruiters || r.sortable()
}

// sortable lists take the v2 §5 grammar: sort, order and vacancy_id.
func (r Route) sortable() bool {
	return r == RouteVacancies || r == RouteReassignments || r == RouteDeliveries || r == RoutePlacements || r == RouteCandidates || r == RouteApplications
}

// sorts lists each sortable route's sort keys, the default first (v2 §5).
var sorts = map[Route][]string{
	RouteDeliveries:    {"commitment_date", "business_days_late", "business_days_overdue", "target_reached_at", "delivered", "title"},
	RouteVacancies:     {"opened_at", "last_close_date", "business_days_to_close", "title"},
	RoutePlacements:    {"hired_at", "title", "candidate"},
	RouteReassignments: {"performed_at", "reason", "title"},
	RouteCandidates:    {"business_days_in_stage", "candidate", "title", "entered_stage_at"},
	RouteApplications:  {"total", "title"},

	RouteDashboardCandidates:   {"business_days_in_stage", "candidate", "title", "entered_stage_at"},
	RouteDashboardDeliveries:   {"commitment_date", "business_days_late", "business_days_overdue", "target_reached_at", "delivered", "title"},
	RouteDashboardVacancies:    {"published_at", "title", "positions_open", "in_process"},
	RouteDashboardApplications: {"total", "title"},
}

// textSorts default to asc; every other sort defaults to desc.
var textSorts = []string{"title", "candidate", "reason"}

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

	// v2 §5 list grammar. Sort and Order are resolved to the route's
	// defaults; every other zero value means "not sent".
	Sort, Order string
	VacancyID   *uuid.UUID
	// deliveries (§5.1)
	Results         []string
	LateBucket      string
	CommitmentMonth string
	AttributedTo    *uuid.UUID
	// vacancies (§5.2)
	Scope         string
	ClosedMonth   string
	CloseReasons  []string
	ClosingTarget string
	CreditedTo    *uuid.UUID
	// placements (§5.3)
	Recipient *uuid.UUID
	Held      *bool
	// reassignments (§5.4)
	Direction string
	Reasons   []string
	// candidates (§5.5)
	StageKinds []string
	Stalled    bool
	// applications (§5.6)
	Channels []string

	// company dashboard lists (company-dashboard-v2 §5); omitted from the
	// cursor hash when unset, so metrics cursors keep their hash. Viewer is
	// the caller's scope, bound by the cursor.
	Window    int    `json:",omitempty"`
	Viewer    string `json:",omitempty"`
	InProcess bool   `json:",omitempty"`
	On        string `json:",omitempty"`
	State     string `json:",omitempty"`
	Status    string `json:",omitempty"`
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
	lateBuckets     = []string{"up_to_2", "from_3_to_5", "over_5"}
	scopes          = []string{"activity", "assigned", "closed", "closed_assigned"}
	closeReasons    = []string{"filled", "cancelled", "other", "no_reason"}
	closingTargets  = []string{"on_time", "late", "no_target"}
	directions      = []string{"received", "lost"}
	reasons         = []string{"workload", "recruiter_departure", "performance", "client_request", "other"}
	channels        = []string{"portal", "careers_site", "manual", "unknown"}
)

func (r Route) allows(key string, export bool) bool {
	switch key {
	case "from", "to", "recruiter_id", "requester_kind", "requester_id":
		return true
	case "limit", "cursor":
		return r.paginated() && !export
	case "sort", "order", "vacancy_id":
		return r.sortable()
	case "outcome", "delivery_result", "scope", "closed_month", "close_reason", "closing_target", "credited_to":
		return r == RouteVacancies
	case "result", "late_bucket", "commitment_month", "attributed_to":
		return r == RouteDeliveries
	case "recipient", "held":
		return r == RoutePlacements
	case "direction", "reason":
		return r == RouteReassignments
	case "stage_kind", "stalled":
		return r == RouteCandidates
	case "channel":
		return r == RouteApplications
	}
	return false
}

// validMonth accepts YYYY-MM.
func validMonth(v string) bool {
	d, err := time.Parse("2006-01", v)
	return err == nil && d.Format("2006-01") == v
}

// multi parses a comma-separated multi-value filter (v2 §3): every value in
// the enum, none empty, none repeated; the order is kept as sent.
func multi(v string, enum []string) ([]string, bool) {
	out := strings.Split(v, ",")
	for i, x := range out {
		if !slices.Contains(enum, x) || slices.Contains(out[:i], x) {
			return nil, false
		}
	}
	return out, true
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
func ParseQuery(raw string, route Route) (Query, error) { return parseQuery(raw, route, false) }

// ParseExportQuery parses a list's CSV export (v2 §8): the list's filters,
// sort and order, never a cursor or a limit.
func ParseExportQuery(raw string, route Route) (Query, error) { return parseQuery(raw, route, true) }

func parseQuery(raw string, route Route, export bool) (Query, error) {
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
		case !route.allows(key, export):
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
		case "sort":
			if slices.Contains(sorts[route], v) {
				q.Sort = v
			} else {
				failures[key] = "invalid"
			}
		case "order":
			if v == "asc" || v == "desc" {
				q.Order = v
			} else {
				failures[key] = "invalid"
			}
		case "vacancy_id", "attributed_to", "credited_to", "recipient":
			id, ok := canonicalUUID(v)
			if !ok {
				failures[key] = "invalid"
				break
			}
			*map[string]**uuid.UUID{"vacancy_id": &q.VacancyID, "attributed_to": &q.AttributedTo, "credited_to": &q.CreditedTo, "recipient": &q.Recipient}[key] = &id
		case "result", "close_reason", "reason", "stage_kind", "channel":
			enum, target := deliveryResults, &q.Results
			switch key {
			case "close_reason":
				enum, target = closeReasons, &q.CloseReasons
			case "reason":
				enum, target = reasons, &q.Reasons
			case "stage_kind":
				enum, target = stageKinds, &q.StageKinds
			case "channel":
				enum, target = channels, &q.Channels
			}
			if vs, ok := multi(v, enum); ok {
				*target = vs
			} else {
				failures[key] = "invalid"
			}
		case "late_bucket", "scope", "closing_target", "direction":
			enum, target := lateBuckets, &q.LateBucket
			switch key {
			case "scope":
				enum, target = scopes, &q.Scope
			case "closing_target":
				enum, target = closingTargets, &q.ClosingTarget
			case "direction":
				enum, target = directions, &q.Direction
			}
			if slices.Contains(enum, v) {
				*target = v
			} else {
				failures[key] = "invalid"
			}
		case "commitment_month", "closed_month":
			if !validMonth(v) {
				failures[key] = "invalid"
			} else if key == "closed_month" {
				q.ClosedMonth = v
			} else {
				q.CommitmentMonth = v
			}
		case "stalled":
			// Only the stalled rows can be asked for (§5.5).
			if v == "true" {
				q.Stalled = true
			} else {
				failures[key] = "invalid"
			}
		case "held":
			if v == "true" || v == "false" {
				held := v == "true"
				q.Held = &held
			} else {
				failures[key] = "invalid"
			}
		}
	}
	// A direction is relative to a recruiter (v2 §5.4).
	if q.Direction != "" && q.RecruiterID == nil && failures["recruiter_id"] == "" {
		failures["recruiter_id"] = "required"
	}
	if route.sortable() {
		if q.Sort == "" {
			q.Sort = sorts[route][0]
		}
		if q.Order == "" {
			q.Order = "desc"
			if slices.Contains(textSorts, q.Sort) {
				q.Order = "asc"
			}
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
