package application

import (
	"cmp"
	"context"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The v2 §5 list grammar shared by every list kind: sort and order over a
// keyset (sort value, id) with nulls last in both orders, an exact total,
// facets and the applied filters with names resolved.

// List is a v2 §5 list response.
type List[T, F any] struct {
	header
	Total          int            `json:"total"`
	Facets         F              `json:"facets"`
	AppliedFilters map[string]any `json:"applied_filters"`
	Items          []T            `json:"items"`
	NextCursor     *string        `json:"next_cursor"`
}

// keyKind says how a column's encoded sort keys compare.
type keyKind int

const (
	keyTime keyKind = iota // RFC 3339 instants, compared as times
	keyInt                 // decimal integers, compared as numbers
	keyText                // lowercased text and ISO dates, compared as strings
)

// sortColumn reads one sort key of a row; nil is null (sorted last).
type sortColumn[T any] struct {
	kind keyKind
	key  func(T) *string
}

func timeKey(at time.Time) *string {
	k := at.UTC().Format(time.RFC3339Nano)
	return &k
}

func timePtrKey(at *time.Time) *string {
	if at == nil {
		return nil
	}
	return timeKey(*at)
}

func intKey(n *int) *string {
	if n == nil {
		return nil
	}
	k := strconv.Itoa(*n)
	return &k
}

func textKey(s string) *string {
	k := strings.ToLower(s)
	return &k
}

func compareKeys(kind keyKind, a, b string) int {
	switch kind {
	case keyTime:
		ta, _ := time.Parse(time.RFC3339Nano, a)
		tb, _ := time.Parse(time.RFC3339Nano, b)
		return ta.Compare(tb)
	case keyInt:
		na, _ := strconv.Atoi(a)
		nb, _ := strconv.Atoi(b)
		return cmp.Compare(na, nb)
	}
	return cmp.Compare(a, b)
}

// compareAt orders two positions: nulls last in both orders, then the key in
// the requested order, then the id ascending.
func compareAt(kind keyKind, desc bool, a, b Position) int {
	switch {
	case a.Key == nil && b.Key != nil:
		return 1
	case a.Key != nil && b.Key == nil:
		return -1
	case a.Key != nil && b.Key != nil:
		c := compareKeys(kind, *a.Key, *b.Key)
		if desc {
			c = -c
		}
		if c != 0 {
			return c
		}
	}
	return cmp.Compare(a.ID.String(), b.ID.String())
}

// listing is a parsed list (or export) request.
type listing struct {
	company uuid.UUID
	route   Route
	export  bool
	q       Query
	p       Period
	from    *Position
}

// prepareList parses the request and, for a page, its cursor. Filter errors
// win over cursor errors.
func prepareList(company uuid.UUID, raw string, route Route, export bool) (listing, error) {
	q, err := parseQuery(raw, route, export)
	if err != nil {
		return listing{}, err
	}
	p, err := NewPeriod(q.From, q.To)
	if err != nil {
		return listing{}, err
	}
	l := listing{company: company, route: route, export: export, q: q, p: p}
	if !export {
		if l.from, err = after(company, route, q); err != nil {
			return listing{}, err
		}
	}
	return l, nil
}

// built is every row of a list for its filters, sorted, before paging.
type built[T, F any] struct {
	rows    []T
	facets  F
	applied map[string]any
	owned   bool // the vacancy filter names a vacancy of this company
	asOf    time.Time
	at      func(T) Position
	less    func(a, b Position) bool
}

// sortRows sorts rows by the request's sort column and order and returns the
// keyset position reader and order.
func sortRows[T, F any](l listing, b *built[T, F], columns map[string]sortColumn[T], id func(T) uuid.UUID) {
	col := columns[l.q.Sort]
	desc := l.q.Order == "desc"
	b.at = func(r T) Position { return Position{Key: col.key(r), ID: id(r)} }
	b.less = func(x, y Position) bool { return compareAt(col.kind, desc, x, y) < 0 }
	slices.SortFunc(b.rows, func(x, y T) int { return compareAt(col.kind, desc, b.at(x), b.at(y)) })
}

// finish cuts the page after the cursor.
func finish[T, F any](l listing, b *built[T, F]) (*List[T, F], error) {
	items, next, err := page(l.company, l.route, l.q, b.rows, l.from, b.less, b.at)
	if err != nil {
		return nil, err
	}
	return &List[T, F]{header: newHeader(l.p, b.asOf), Total: len(b.rows), Facets: b.facets, AppliedFilters: b.applied, Items: items, NextCursor: next}, nil
}

// listView loads the snapshot narrowed by the common filters; recruiter is
// the vacancy-level recruiter filter (nil when the kind applies it per row).
func (s *Service) listView(ctx context.Context, l listing, recruiter *uuid.UUID) (view, error) {
	return s.view(ctx, l.company, l.p, l.q.Requester, recruiter)
}

// NameQuery asks the store for the names the snapshot does not hold.
type NameQuery struct {
	People    []uuid.UUID
	Requester *RequesterFilter
	Vacancy   *uuid.UUID
}

// Names answers a NameQuery. People outside the company's history, requesters
// and vacancies of another company come back with null names (v2 §5).
type Names struct {
	People    map[uuid.UUID]Person
	Requester *string
	Vacancy   *string
}

// VacancyFilter is the resolved vacancy filter; Title is null for a vacancy of
// another company or an unknown id.
type VacancyFilter struct {
	DraftID uuid.UUID `json:"draft_id"`
	Title   *string   `json:"title"`
}

// applied echoes the request's filters with people, requester and vacancy
// resolved (v2 §5 applied_filters): from the whole snapshot first, the store
// only for misses. It reports whether the vacancy filter names a vacancy of
// this company.
func (s *Service) applied(ctx context.Context, company uuid.UUID, q Query, all *Dataset) (map[string]any, bool, error) {
	out := map[string]any{}
	people := map[string]*uuid.UUID{"recruiter": q.RecruiterID, "attributed_to": q.AttributedTo, "recipient": q.Recipient, "credited_to": q.CreditedTo}
	var query NameQuery
	for _, id := range people {
		if id != nil {
			if _, ok := all.People[*id]; !ok && !slices.Contains(query.People, *id) {
				query.People = append(query.People, *id)
			}
		}
	}
	var requesterName *string
	if f := q.Requester; f.ID != uuid.Nil {
		found := false
		for _, v := range all.Vacancies {
			if r := v.Requester; r != nil && r.ID != nil && *r.ID == f.ID && r.Kind == f.Kind {
				requesterName, found = r.Name, true
				break
			}
		}
		if !found {
			query.Requester = &f
		}
	}
	var vacancy *VacancyFilter
	if q.VacancyID != nil {
		vacancy = &VacancyFilter{DraftID: *q.VacancyID}
		if i := slices.IndexFunc(all.Vacancies, func(v *Vacancy) bool { return v.ID == *q.VacancyID }); i >= 0 {
			vacancy.Title = &all.Vacancies[i].Title
		} else {
			query.Vacancy = q.VacancyID
		}
	}
	if len(query.People) > 0 || query.Requester != nil || query.Vacancy != nil {
		names, err := s.store.Names(ctx, company, query)
		if err != nil {
			return nil, false, err
		}
		if query.Requester != nil {
			requesterName = names.Requester
		}
		if query.Vacancy != nil {
			vacancy.Title = names.Vacancy
		}
		for _, id := range query.People {
			p, ok := names.People[id]
			if !ok {
				p = Person{UserID: id, FormerMember: true}
			}
			all = &Dataset{People: withPerson(all.People, p)}
		}
	}
	for key, id := range people {
		if id != nil {
			out[key] = all.person(*id)
		}
	}
	switch f := q.Requester; {
	case f.Kind == "" && f.None:
		out["requester"] = "none"
	case f.None:
		out["requester"] = Requester{Kind: f.Kind}
	case f.ID != uuid.Nil:
		id := f.ID
		out["requester"] = Requester{Kind: f.Kind, ID: &id, Name: requesterName}
	case f.Kind != "":
		out["requester_kind"] = f.Kind
	}
	if vacancy != nil {
		out["vacancy"] = *vacancy
	}
	for key, value := range map[string]string{
		"late_bucket": q.LateBucket, "commitment_month": q.CommitmentMonth, "scope": q.Scope, "closed_month": q.ClosedMonth,
		"closing_target": q.ClosingTarget, "outcome": q.Outcome, "delivery_result": q.DeliveryResult, "direction": q.Direction,
	} {
		if value != "" {
			out[key] = value
		}
	}
	for key, values := range map[string][]string{"result": q.Results, "close_reason": q.CloseReasons, "reason": q.Reasons, "stage_kind": q.StageKinds, "channel": q.Channels} {
		if values != nil {
			out[key] = values
		}
	}
	if q.Held != nil {
		out["held"] = *q.Held
	}
	if q.Stalled {
		out["stalled"] = true
	}
	return out, vacancy != nil && vacancy.Title != nil, nil
}

// withPerson copies people with one more entry (the snapshot's map is shared).
func withPerson(people map[uuid.UUID]Person, p Person) map[uuid.UUID]Person {
	out := make(map[uuid.UUID]Person, len(people)+1)
	for k, v := range people {
		out[k] = v
	}
	out[p.UserID] = p
	return out
}

// auditFilters is the normalized query of an audited read (v2 §6): the sent
// filters, sort and order, the limit of a page; never the cursor.
func auditFilters(l listing) map[string]any {
	q := l.q
	out := map[string]any{"from": q.From, "to": q.To, "sort": q.Sort, "order": q.Order}
	if !l.export {
		out["limit"] = q.Limit
	}
	for key, id := range map[string]*uuid.UUID{"recruiter_id": q.RecruiterID, "vacancy_id": q.VacancyID, "attributed_to": q.AttributedTo, "recipient": q.Recipient, "credited_to": q.CreditedTo} {
		if id != nil {
			out[key] = id.String()
		}
	}
	if q.Requester.Kind != "" {
		out["requester_kind"] = q.Requester.Kind
	}
	if q.Requester.None {
		out["requester_id"] = "none"
	} else if q.Requester.ID != uuid.Nil {
		out["requester_id"] = q.Requester.ID.String()
	}
	if q.Held != nil {
		out["held"] = *q.Held
	}
	if q.StageKinds != nil {
		out["stage_kind"] = q.StageKinds
	}
	if q.Stalled {
		out["stalled"] = true
	}
	return out
}

// DetailAudit is one audited list read or export (v2 §6): MetricsDetailViewed
// for a page, MetricsDetailExported (with RowCount) for an export.
type DetailAudit struct {
	Company, Actor uuid.UUID
	Exported       bool
	Report         string
	Vacancy        *uuid.UUID
	VacancyOwned   bool // Vacancy is a vacancy of Company
	Filters        map[string]any
	RowCount       int
}
