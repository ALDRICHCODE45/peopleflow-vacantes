package application

import (
	"context"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// The company dashboard lists (company-dashboard-v2 §5): the metrics §5
// grammar (sort, order, limit, cursor, total, facets, applied_filters) over
// the dashboard's snapshots, the scope forced by the session role (DD1) and
// never audited (DD4). Each list reads the snapshot its figures read, so a
// figure equals its list's total.

// DashboardList is a dashboard list response.
type DashboardList[T, F any] struct {
	dashboardHeader
	Total          int            `json:"total"`
	Facets         F              `json:"facets"`
	AppliedFilters map[string]any `json:"applied_filters"`
	Items          []T            `json:"items"`
	NextCursor     *string        `json:"next_cursor"`
}

var (
	dashboardStates   = []string{"overdue", "due_this_week"}
	dashboardStatuses = []string{"published", "paused", "closed", "finished"}
)

// dashboardAllows lists each dashboard list's parameters.
func dashboardAllows(route Route, key string, export bool) bool {
	switch key {
	case "window", "sort", "order", "vacancy_id":
		return true
	case "limit", "cursor":
		return !export
	case "in_process", "on", "stage_kind", "stalled":
		return route == RouteDashboardCandidates
	case "state":
		return route == RouteDashboardDeliveries
	case "status":
		return route == RouteDashboardVacancies
	case "from", "to", "channel":
		return route == RouteDashboardApplications
	}
	return false
}

// parseDashboardList is the strict parser of a dashboard list (or its
// export): window, the list grammar and the kind's filters. No recruiter,
// requester or scope parameter exists, so a recruiter cannot widen the scope.
// Bounds that depend on the window (on, from, to) are checked against the
// snapshot's window by the list (checkWindow).
func parseDashboardList(raw string, route Route, export bool) (Query, error) {
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
	q := Query{Limit: DefaultLimit, Window: DefaultWindow}
	for key, vs := range values {
		switch {
		case !dashboardAllows(route, key, export):
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
		valid := true
		switch key {
		case "window":
			q.Window, valid = windows[v]
		case "sort":
			q.Sort, valid = v, slices.Contains(sorts[route], v)
		case "order":
			q.Order, valid = v, v == "asc" || v == "desc"
		case "limit":
			n, err := strconv.Atoi(v)
			valid = err == nil && len(v) <= 3 && strings.Trim(v, "0123456789") == "" && n >= 1 && n <= MaxLimit
			q.Limit = n
		case "cursor":
			token := v
			q.Cursor = &token
		case "vacancy_id":
			id, ok := canonicalUUID(v)
			q.VacancyID, valid = &id, ok
		case "in_process", "stalled":
			valid = v == "true"
			if key == "in_process" {
				q.InProcess = valid
			} else {
				q.Stalled = valid
			}
		case "on":
			_, valid = validDate(v)
			q.On = v
		case "from", "to":
			_, valid = validDate(v)
			if key == "from" {
				q.From = v
			} else {
				q.To = v
			}
		case "stage_kind", "channel":
			enum, target := stageKinds, &q.StageKinds
			if key == "channel" {
				enum, target = channels, &q.Channels
			}
			*target, valid = multi(v, enum)
		case "state":
			q.State, valid = v, slices.Contains(dashboardStates, v)
		case "status":
			// Only the published vacancies can be asked for (§3.1).
			q.Status, valid = v, v == "published"
		}
		if !valid {
			failures[key] = "invalid"
		}
	}
	// A series day is a point of the in-process series.
	if q.On != "" && !q.InProcess && failures["in_process"] == "" {
		failures["in_process"] = "required"
	}
	if q.From != "" && q.To != "" && failures["from"] == "" && failures["to"] == "" && q.From > q.To {
		failures["to"] = "range"
	}
	if q.Sort == "" {
		q.Sort = sorts[route][0]
	}
	if q.Order == "" {
		q.Order = "desc"
		if slices.Contains(textSorts, q.Sort) {
			q.Order = "asc"
		}
	}
	if len(failures) > 0 {
		return Query{}, invalidFilter(failures)
	}
	return q, nil
}

func invalidFilter(failures map[string]string) *InvalidFilter {
	fields := make([]Field, 0, len(failures))
	for key, code := range failures {
		fields = append(fields, Field{key, code})
	}
	slices.SortFunc(fields, func(a, b Field) int { return strings.Compare(a.Field, b.Field) })
	return &InvalidFilter{Fields: fields}
}

// dashListing is a parsed dashboard list request.
type dashListing struct {
	company uuid.UUID
	viewer  Viewer
	route   Route
	export  bool
	q       Query
}

func prepareDashboardList(company uuid.UUID, viewer Viewer, raw string, route Route, export bool) (dashListing, error) {
	q, err := parseDashboardList(raw, route, export)
	if err != nil {
		return dashListing{}, err
	}
	q.Viewer = viewer.scope()
	return dashListing{company, viewer, route, export, q}, nil
}

// listing adapts the request to the metrics keyset helpers.
func (l dashListing) listing() listing {
	return listing{company: l.company, route: l.route, export: l.export, q: l.q}
}

// checkWindow rejects on, from and to outside the response's window (on: the
// series days, from the previous window's end; from/to: the window days).
func checkWindow(q Query, w Window) error {
	failures := map[string]string{}
	if q.On != "" && (q.On < w.PreviousTo || q.On > w.To) {
		failures["on"] = "range"
	}
	if q.From != "" && (q.From < w.From || q.From > w.To) {
		failures["from"] = "range"
	}
	if q.To != "" && (q.To < w.From || q.To > w.To) {
		failures["to"] = "range"
	}
	if len(failures) > 0 {
		return invalidFilter(failures)
	}
	return nil
}

// finishDashboard checks the window bounds, then the cursor (a filter error
// wins over a cursor error), and cuts the page.
func finishDashboard[T, F any](l dashListing, h dashboardHeader, b *built[T, F]) (*DashboardList[T, F], error) {
	if err := checkWindow(l.q, h.Window); err != nil {
		return nil, err
	}
	from, err := after(l.company, l.route, l.q)
	if err != nil {
		return nil, err
	}
	items, next, err := page(l.company, l.route, l.q, b.rows, from, b.less, b.at)
	if err != nil {
		return nil, err
	}
	return &DashboardList[T, F]{dashboardHeader: h, Total: len(b.rows), Facets: b.facets, AppliedFilters: b.applied, Items: items, NextCursor: next}, nil
}

// dashboardApplied echoes the request's filters. The vacancy is named only
// when it is in the caller's scope: another recruiter's vacancy, another
// company's or an unknown id resolve with title null (no name leaks).
func dashboardApplied(q Query, scoped []*HistoryVacancy) map[string]any {
	out := map[string]any{}
	if q.VacancyID != nil {
		f := VacancyFilter{DraftID: *q.VacancyID}
		if i := slices.IndexFunc(scoped, func(v *HistoryVacancy) bool { return v.ID == *q.VacancyID }); i >= 0 {
			f.Title = &scoped[i].Title
		}
		out["vacancy"] = f
	}
	for key, value := range map[string]string{"on": q.On, "state": q.State, "status": q.Status, "from": q.From, "to": q.To} {
		if value != "" {
			out[key] = value
		}
	}
	for key, values := range map[string][]string{"stage_kind": q.StageKinds, "channel": q.Channels} {
		if values != nil {
			out[key] = values
		}
	}
	if q.InProcess {
		out["in_process"] = true
	}
	if q.Stalled {
		out["stalled"] = true
	}
	return out
}

// DashboardCandidateList answers GET …/dashboard/lists/candidates. With
// in_process (and on) it reads the history snapshot, the summary's and the
// vacancies section's source: participations in process at the end of the
// day (today without on) of vacancies published then. Without it, the
// pipeline snapshot of the pipeline section and attention.stalled.
func (s *Service) DashboardCandidateList(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*DashboardList[CandidateRow, CandidateFacets], error) {
	l, err := prepareDashboardList(company, viewer, raw, RouteDashboardCandidates, false)
	if err != nil {
		return nil, err
	}
	h, b, err := s.buildDashCandidates(ctx, l)
	if err != nil {
		return nil, err
	}
	return finishDashboard(l, h, b)
}

func (s *Service) buildDashCandidates(ctx context.Context, l dashListing) (dashboardHeader, *built[CandidateRow, CandidateFacets], error) {
	q := l.q
	b := &built[CandidateRow, CandidateFacets]{rows: []CandidateRow{}}
	add := func(r CandidateRow) {
		kindOK := q.StageKinds == nil || slices.Contains(q.StageKinds, r.Stage.Kind)
		stalledOK := !q.Stalled || r.Stalled
		// Each facet ignores only its own filter.
		if stalledOK {
			b.facets.StageKind.add(r.Stage.Kind)
		}
		if kindOK && r.Stalled {
			b.facets.Stalled++
		}
		if kindOK && stalledOK {
			b.rows = append(b.rows, r)
		}
	}
	var h dashboardHeader
	var scoped []*HistoryVacancy
	if q.InProcess {
		snap, err := s.history(ctx, l.company)
		if err != nil {
			return h, nil, err
		}
		h = newDashboardHeader(q.Window, snap.AsOf, l.viewer)
		scoped = s.visible(snap, l.viewer)
		day := q.On
		if day == "" {
			day = h.Window.To
		}
		end := dayEnd(day)
		// Days in stage run to the end of that day, or to as_of today.
		ref := end.Add(-time.Nanosecond)
		if snap.AsOf.Before(ref) {
			ref = snap.AsOf
		}
		for _, v := range scoped {
			if (q.VacancyID != nil && v.ID != *q.VacancyID) || !v.publishedAt(end) {
				continue
			}
			for i := range v.Tracks {
				t := &v.Tracks[i]
				stage, active := t.stageAt(end)
				if !active || !v.Pipeline.inProcess(stage) {
					continue
				}
				kind, name, _ := v.Pipeline.stageOf(stage)
				entry := t.entryAt(stage, end)
				days := s.calendar.BetweenInstants(entry, ref)
				add(CandidateRow{ParticipationID: t.ID, Candidate: t.Candidate, Vacancy: VacancyRef{v.ID, v.Title}, Stage: StageRef{kind, name},
					BusinessDaysInStage: days, Stalled: kind != "placement" && days >= StalledThreshold, EnteredStageAt: entry.UTC()})
			}
		}
	} else {
		pq := Query{VacancyID: q.VacancyID}
		if !l.viewer.Owner {
			pq.RecruiterID = &l.viewer.UserID
		}
		pipe, err := s.pipelineView(ctx, l.company, pq)
		if err != nil {
			return h, nil, err
		}
		h = newDashboardHeader(q.Window, pipe.snap.AsOf, l.viewer)
		for _, r := range pipe.rows {
			add(CandidateRow{ParticipationID: r.p.ID, Candidate: r.p.Candidate, Vacancy: VacancyRef{r.vac.ID, r.vac.Title},
				Stage: StageRef{r.kind, r.name}, BusinessDaysInStage: r.days, Stalled: r.stalled, EnteredStageAt: r.p.EnteredAt.UTC()})
		}
		if q.VacancyID != nil {
			snap, err := s.history(ctx, l.company)
			if err != nil {
				return h, nil, err
			}
			scoped = s.visible(snap, l.viewer)
		}
	}
	b.applied = dashboardApplied(q, scoped)
	sortRows(l.listing(), b, candidateColumns, func(r CandidateRow) uuid.UUID { return r.ParticipationID })
	return h, b, nil
}

// StateFacet counts the attention deliveries by state.
type StateFacet struct {
	Overdue     int `json:"overdue"`
	DueThisWeek int `json:"due_this_week"`
}

type DashboardDeliveryFacets struct {
	State StateFacet `json:"state"`
}

// DashboardDeliveryList answers GET …/dashboard/lists/deliveries: the
// attention deliveries (§3.2, state now) as metrics §5.1 rows; overdue rows
// are result overdue, due-this-week rows pending.
func (s *Service) DashboardDeliveryList(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*DashboardList[DeliveryListRow, DashboardDeliveryFacets], error) {
	l, err := prepareDashboardList(company, viewer, raw, RouteDashboardDeliveries, false)
	if err != nil {
		return nil, err
	}
	h, b, err := s.buildDashDeliveries(ctx, l)
	if err != nil {
		return nil, err
	}
	return finishDashboard(l, h, b)
}

func (s *Service) buildDashDeliveries(ctx context.Context, l dashListing) (dashboardHeader, *built[DeliveryListRow, DashboardDeliveryFacets], error) {
	snap, err := s.history(ctx, l.company)
	if err != nil {
		return dashboardHeader{}, nil, err
	}
	q := l.q
	h := newDashboardHeader(q.Window, snap.AsOf, l.viewer)
	b := &built[DeliveryListRow, DashboardDeliveryFacets]{rows: []DeliveryListRow{}}
	people := snap.Data.people()
	today := LocalDate(snap.AsOf)
	sunday := weekEnd(today)
	scoped := s.visible(snap, l.viewer)
	for _, v := range scoped {
		d := v.Delivery
		if (q.VacancyID != nil && v.ID != *q.VacancyID) || !v.open() || !d.Configured || d.Commitment == nil || d.TargetReachedAt != nil {
			continue
		}
		var state string
		switch c := *d.Commitment; {
		case c < today:
			state = "overdue"
			b.facets.State.Overdue++
		case c <= sunday:
			state = "due_this_week"
			b.facets.State.DueThisWeek++
		default:
			continue
		}
		if q.State != "" && q.State != state {
			continue
		}
		result, late := v.DeliveryResult(snap.AsOf, s.calendar)
		row := DeliveryListRow{Vacancy: VacancyRef{v.ID, v.Title}, Requester: v.Requester, AttributedTo: v.attributedPeople(result, people),
			CommitmentDate: d.Commitment, OriginalCommitmentDate: d.OriginalCommitment, Renegotiations: d.Renegotiations, Result: result,
			BusinessDaysLate: late, Delivered: v.Delivered(), Target: d.Target}
		if state == "overdue" {
			n := s.calendar.Between(civilDate(*d.Commitment), civilDate(today))
			row.BusinessDaysOverdue = &n
		}
		b.rows = append(b.rows, row)
	}
	b.applied = dashboardApplied(q, scoped)
	sortRows(l.listing(), b, deliveryColumns, func(r DeliveryListRow) uuid.UUID { return r.Vacancy.DraftID })
	return h, b, nil
}

// DashboardVacancyRow is one vacancy in scope (§5): its status at the end of
// today, in process (0 unless published: its candidates list opens only
// published vacancies) and positions (DD3).
type DashboardVacancyRow struct {
	Vacancy     VacancyRef `json:"vacancy"`
	Requester   *Requester `json:"requester"`
	Responsible *Person    `json:"responsible"`
	Status      string     `json:"status"`
	PublishedAt time.Time  `json:"published_at"`
	InProcess   int        `json:"in_process"`
	Positions   Positions  `json:"positions"`
}

// positionsOpen is required minus covered, never below 0.
func (r DashboardVacancyRow) positionsOpen() int {
	return max(r.Positions.Required-r.Positions.Covered, 0)
}

// StatusFacet counts the vacancies by status.
type StatusFacet struct {
	Published int `json:"published"`
	Paused    int `json:"paused"`
	Closed    int `json:"closed"`
	Finished  int `json:"finished"`
}

func (f *StatusFacet) add(status string) {
	*map[string]*int{"published": &f.Published, "paused": &f.Paused, "closed": &f.Closed, "finished": &f.Finished}[status]++
}

type DashboardVacancyFacets struct {
	Status StatusFacet `json:"status"`
}

var dashboardVacancyColumns = map[string]sortColumn[DashboardVacancyRow]{
	"published_at":   {keyTime, func(r DashboardVacancyRow) *string { return timeKey(r.PublishedAt) }},
	"title":          {keyText, func(r DashboardVacancyRow) *string { return textKey(r.Vacancy.Title) }},
	"positions_open": {keyInt, func(r DashboardVacancyRow) *string { n := r.positionsOpen(); return intKey(&n) }},
	"in_process":     {keyInt, func(r DashboardVacancyRow) *string { return intKey(&r.InProcess) }},
}

// DashboardVacancyList answers GET …/dashboard/lists/vacancies: every vacancy
// in scope published at least once; status=published is the summary's
// published vacancies and positions.
func (s *Service) DashboardVacancyList(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*DashboardVacancyList, error) {
	l, err := prepareDashboardList(company, viewer, raw, RouteDashboardVacancies, false)
	if err != nil {
		return nil, err
	}
	h, b, err := s.buildDashVacancies(ctx, l)
	if err != nil {
		return nil, err
	}
	list, err := finishDashboard(l, h, b)
	if err != nil {
		return nil, err
	}
	out := &DashboardVacancyList{DashboardList: *list}
	for _, r := range b.rows {
		out.Positions.Covered += r.Positions.Covered
		out.Positions.Required += r.Positions.Required
	}
	return out, nil
}

// DashboardVacancyList is the vacancies list response. Positions aggregates
// every row of the filtered result (not only the page), so status=published
// answers the summary's positions figure.
type DashboardVacancyList struct {
	DashboardList[DashboardVacancyRow, DashboardVacancyFacets]
	Positions Positions `json:"positions"`
}

func (s *Service) buildDashVacancies(ctx context.Context, l dashListing) (dashboardHeader, *built[DashboardVacancyRow, DashboardVacancyFacets], error) {
	snap, err := s.history(ctx, l.company)
	if err != nil {
		return dashboardHeader{}, nil, err
	}
	q := l.q
	h := newDashboardHeader(q.Window, snap.AsOf, l.viewer)
	b := &built[DashboardVacancyRow, DashboardVacancyFacets]{rows: []DashboardVacancyRow{}}
	end := dayEnd(h.Window.To)
	scoped := s.visible(snap, l.viewer)
	people := snap.Data.people()
	for _, v := range scoped {
		if q.VacancyID != nil && v.ID != *q.VacancyID {
			continue
		}
		row := DashboardVacancyRow{Vacancy: VacancyRef{v.ID, v.Title}, Requester: v.Requester, Responsible: people.personPtr(v.Responsible),
			PublishedAt: v.PublishedAt.UTC()}
		switch {
		case v.publishedAt(end):
			row.Status, row.InProcess = "published", v.inProcessAt(end)
		case v.Finished:
			row.Status = "finished"
		case v.Status == "closed":
			row.Status = "closed"
		default:
			row.Status = "paused"
		}
		row.Positions.add(v)
		b.facets.Status.add(row.Status)
		if q.Status != "" && q.Status != row.Status {
			continue
		}
		b.rows = append(b.rows, row)
	}
	b.applied = dashboardApplied(q, scoped)
	sortRows(l.listing(), b, dashboardVacancyColumns, func(r DashboardVacancyRow) uuid.UUID { return r.Vacancy.DraftID })
	return h, b, nil
}

// DashboardApplicationList answers GET …/dashboard/lists/applications: the
// participations of the vacancies in scope (any state) created from from to
// to (the window by default), per vacancy and channel as metrics §5.6. Its
// total sums the selected channels: an origin day's organic + manual, or one
// side with channel.
func (s *Service) DashboardApplicationList(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*DashboardList[ApplicationRow, ApplicationFacets], error) {
	l, err := prepareDashboardList(company, viewer, raw, RouteDashboardApplications, false)
	if err != nil {
		return nil, err
	}
	h, b, total, err := s.buildDashApplications(ctx, l)
	if err != nil {
		return nil, err
	}
	out, err := finishDashboard(l, h, b)
	if err != nil {
		return nil, err
	}
	out.Total = total
	return out, nil
}

func (s *Service) buildDashApplications(ctx context.Context, l dashListing) (dashboardHeader, *built[ApplicationRow, ApplicationFacets], int, error) {
	snap, err := s.history(ctx, l.company)
	if err != nil {
		return dashboardHeader{}, nil, 0, err
	}
	q := l.q
	h := newDashboardHeader(q.Window, snap.AsOf, l.viewer)
	b := &built[ApplicationRow, ApplicationFacets]{rows: []ApplicationRow{}}
	from, to := cmpOr(q.From, h.Window.From), cmpOr(q.To, h.Window.To)
	scoped := s.visible(snap, l.viewer)
	total := 0
	for _, v := range scoped {
		if q.VacancyID != nil && v.ID != *q.VacancyID {
			continue
		}
		byChannel := map[string]int{}
		for _, t := range v.Tracks {
			if d := LocalDate(t.CreatedAt); d < from || d > to {
				continue
			}
			channel := t.Channel
			if !slices.Contains(channels, channel) {
				channel = "unknown"
			}
			byChannel[channel]++
		}
		b.facets.Channel.add(byChannel)
		row := ApplicationRow{Vacancy: VacancyRef{v.ID, v.Title}, Requester: v.Requester, Portal: byChannel["portal"],
			CareersSite: byChannel["careers_site"], Manual: byChannel["manual"], Unknown: byChannel["unknown"]}
		for _, channel := range channels {
			if q.Channels == nil || slices.Contains(q.Channels, channel) {
				row.Total += byChannel[channel]
			}
		}
		if row.Total == 0 {
			continue
		}
		total += row.Total
		b.rows = append(b.rows, row)
	}
	b.applied = dashboardApplied(q, scoped)
	sortRows(l.listing(), b, applicationColumns, func(r ApplicationRow) uuid.UUID { return r.Vacancy.DraftID })
	return h, b, total, nil
}

func cmpOr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

var dashboardVacancyHeader = []string{"ID vacante", "Vacante", "Solicitante", "Responsable", "Estado", "Publicada", "En proceso", "Cubiertas", "Requeridas"}

func dashboardVacancyRecord(r DashboardVacancyRow) []string {
	responsible := ""
	if r.Responsible != nil {
		responsible = cellPerson(*r.Responsible)
	}
	return []string{r.Vacancy.DraftID.String(), r.Vacancy.Title, cellRequester(r.Requester), responsible, r.Status, cellInstant(r.PublishedAt),
		strconv.Itoa(r.InProcess), strconv.Itoa(r.Positions.Covered), strconv.Itoa(r.Positions.Required)}
}

// DashboardExport answers GET …/dashboard/lists/{kind}/export (metrics §8):
// the list's filters, sort and order, every row; not audited (DD4). The
// file is dashboard-<kind>-<window from>-<window to>.csv.
func (s *Service) DashboardExport(ctx context.Context, company uuid.UUID, viewer Viewer, kind, raw string) (*Export, error) {
	route, ok := map[string]Route{"candidates": RouteDashboardCandidates, "deliveries": RouteDashboardDeliveries,
		"vacancies": RouteDashboardVacancies, "applications": RouteDashboardApplications}[kind]
	if !ok {
		return nil, ErrUnknownKind
	}
	l, err := prepareDashboardList(company, viewer, raw, route, true)
	if err != nil {
		return nil, err
	}
	out := &Export{}
	var h dashboardHeader
	switch route {
	case RouteDashboardCandidates:
		var b *built[CandidateRow, CandidateFacets]
		if h, b, err = s.buildDashCandidates(ctx, l); err == nil {
			out.Header, out.rows, out.record = candidateHeader, len(b.rows), func(i int) []string { return candidateRecord(b.rows[i]) }
		}
	case RouteDashboardDeliveries:
		var b *built[DeliveryListRow, DashboardDeliveryFacets]
		if h, b, err = s.buildDashDeliveries(ctx, l); err == nil {
			out.Header, out.rows, out.record = deliveryHeader, len(b.rows), func(i int) []string { return deliveryRecord(b.rows[i]) }
		}
	case RouteDashboardVacancies:
		var b *built[DashboardVacancyRow, DashboardVacancyFacets]
		if h, b, err = s.buildDashVacancies(ctx, l); err == nil {
			out.Header, out.rows, out.record = dashboardVacancyHeader, len(b.rows), func(i int) []string { return dashboardVacancyRecord(b.rows[i]) }
		}
	case RouteDashboardApplications:
		var b *built[ApplicationRow, ApplicationFacets]
		if h, b, _, err = s.buildDashApplications(ctx, l); err == nil {
			out.Header, out.rows, out.record = applicationHeader, len(b.rows), func(i int) []string { return applicationRecord(b.rows[i]) }
		}
	}
	if err != nil {
		return nil, err
	}
	if err := checkWindow(l.q, h.Window); err != nil {
		return nil, err
	}
	if out.rows > s.exportLimit {
		return nil, &TooLarge{RowCount: out.rows, Limit: s.exportLimit}
	}
	out.Filename = fmt.Sprintf("dashboard-%s-%s-%s.csv", kind, h.Window.From, h.Window.To)
	return out, nil
}
