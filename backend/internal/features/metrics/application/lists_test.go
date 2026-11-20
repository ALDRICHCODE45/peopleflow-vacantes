package application

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// listStore serves one dataset for every period and records the names it
// resolves and the audit rows the lists write.
type listStore struct {
	Store
	data *Dataset

	mu        sync.Mutex
	names     []NameQuery
	nameReply Names
	audits    []DetailAudit
	failAudit bool
}

func (s *listStore) Load(context.Context, uuid.UUID, Scope) (*Dataset, error) { return s.data, nil }

func (s *listStore) Names(_ context.Context, _ uuid.UUID, q NameQuery) (Names, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.names = append(s.names, q)
	return s.nameReply, nil
}

func (s *listStore) RecordDetail(_ context.Context, a DetailAudit) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failAudit {
		return errors.New("audit down")
	}
	s.audits = append(s.audits, a)
	return nil
}

func (v *Vacancy) withEntries(n int) *Vacancy {
	for i := 0; i < n; i++ {
		v.Entries = append(v.Entries, Entry{ParticipationID: uuid.New(), At: v.PublishedAt})
	}
	return v
}

// deliveryFixture: six vacancies of the q1 delivery universe at as_of
// 2026-03-20 (weekdays calendar). U carries A (on time), B (late 4), D
// (overdue); W carries C (late 1); E is pending, F not configured.
type deliveryFixture struct {
	u, w             uuid.UUID
	a, b, c, d, e, f *Vacancy
	store            *listStore
	svc              *Service
	company          uuid.UUID
}

func newDeliveryFixture() *deliveryFixture {
	fx := &deliveryFixture{u: uuid.New(), w: uuid.New(), company: uuid.New()}
	fx.a = vacancy("Alfa", "2026-01-05T16:00:00Z").withTramo(fx.u, "2026-01-05T16:00:00Z").withDelivery("2026-01-20", 1, ptr("2026-01-15T18:00:00Z")).withEntries(1)
	fx.b = vacancy("beta", "2026-01-05T16:00:00Z").withTramo(fx.u, "2026-01-05T16:00:00Z").withDelivery("2026-01-31", 1, ptr("2026-02-05T18:00:00Z")).withEntries(3)
	fx.c = vacancy("Gamma", "2026-01-05T16:00:00Z").withTramo(fx.w, "2026-01-05T16:00:00Z").withDelivery("2026-02-10", 1, ptr("2026-02-11T18:00:00Z")).withEntries(2)
	fx.d = vacancy("Delta", "2026-01-05T16:00:00Z").withTramo(fx.u, "2026-01-05T16:00:00Z").withDelivery("2026-03-02", 4, nil)
	fx.e = vacancy("Eps", "2026-01-05T16:00:00Z").withTramo(fx.u, "2026-01-05T16:00:00Z").withDelivery("2026-03-30", 2, nil)
	fx.f = vacancy("Zeta", "2026-01-05T16:00:00Z").withTramo(fx.w, "2026-01-05T16:00:00Z")
	fx.store = &listStore{data: &Dataset{Vacancies: []*Vacancy{fx.a, fx.b, fx.c, fx.d, fx.e, fx.f}, People: map[uuid.UUID]Person{
		fx.u: {UserID: fx.u, Name: ptr("Ursula")}, fx.w: {UserID: fx.w, Name: ptr("Walter")},
	}}}
	fx.svc = newTestService(fx.store, at("2026-03-20T18:00:00Z"))
	return fx
}

func (fx *deliveryFixture) list(t *testing.T, query string) *List[DeliveryListRow, DeliveryFacets] {
	t.Helper()
	out, err := fx.svc.ListDeliveries(context.Background(), fx.company, q1+query)
	if err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return out
}

func titles[T any](items []T, title func(T) string) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = title(it)
	}
	return out
}

func deliveryTitles(items []DeliveryListRow) []string {
	return titles(items, func(r DeliveryListRow) string { return r.Vacancy.Title })
}

// byID orders vacancies by id: the tie-break of every keyset.
func byID(vs ...*Vacancy) []string {
	s := slices.Clone(vs)
	slices.SortFunc(s, func(a, b *Vacancy) int { return strings.Compare(a.ID.String(), b.ID.String()) })
	return titles(s, func(v *Vacancy) string { return v.Title })
}

func TestDeliveries_SortOrdersNullsLastAndTiesByID(t *testing.T) {
	fx := newDeliveryFixture()
	for _, tc := range []struct {
		query string
		want  []string
	}{
		// Default: commitment_date desc; not configured (null) last.
		{"", []string{"Eps", "Delta", "Gamma", "beta", "Alfa", "Zeta"}},
		{"&order=asc", []string{"Alfa", "beta", "Gamma", "Delta", "Eps", "Zeta"}},
		{"&sort=commitment_date&order=desc", []string{"Eps", "Delta", "Gamma", "beta", "Alfa", "Zeta"}},
		// Nulls last in both orders, then by id.
		{"&sort=business_days_late&order=desc", append([]string{"beta", "Gamma"}, byID(fx.a, fx.d, fx.e, fx.f)...)},
		{"&sort=business_days_late&order=asc", append([]string{"Gamma", "beta"}, byID(fx.a, fx.d, fx.e, fx.f)...)},
		{"&sort=business_days_overdue", append([]string{"Delta"}, byID(fx.a, fx.b, fx.c, fx.e, fx.f)...)},
		{"&sort=target_reached_at&order=asc", append([]string{"Alfa", "beta", "Gamma"}, byID(fx.d, fx.e, fx.f)...)},
		// Integers compare as numbers (3 > 2 > 1 > 0); ties by id.
		{"&sort=delivered", append([]string{"beta", "Gamma", "Alfa"}, byID(fx.d, fx.e, fx.f)...)},
		// Titles compare case-insensitively; text sorts default to asc.
		{"&sort=title", []string{"Alfa", "beta", "Delta", "Eps", "Gamma", "Zeta"}},
		{"&sort=title&order=desc", []string{"Zeta", "Gamma", "Eps", "Delta", "beta", "Alfa"}},
	} {
		got := fx.list(t, tc.query)
		if !reflect.DeepEqual(deliveryTitles(got.Items), tc.want) {
			t.Fatalf("%q: %v, want %v", tc.query, deliveryTitles(got.Items), tc.want)
		}
		if got.Total != 6 {
			t.Fatalf("%q: total %d", tc.query, got.Total)
		}
	}
}

func TestDeliveries_KeysetPagesWalkEverySortOnce(t *testing.T) {
	fx := newDeliveryFixture()
	for _, sort := range []string{"", "&order=asc", "&sort=title", "&sort=title&order=desc", "&sort=business_days_late", "&sort=business_days_late&order=asc", "&sort=delivered&order=asc"} {
		want := deliveryTitles(fx.list(t, sort).Items)
		var walked []string
		query := sort + "&limit=2"
		for pages := 0; ; pages++ {
			if pages > 5 {
				t.Fatalf("%q: endless pages", sort)
			}
			page := fx.list(t, query)
			if page.Total != 6 {
				t.Fatalf("%q: page total %d", sort, page.Total)
			}
			walked = append(walked, deliveryTitles(page.Items)...)
			if page.NextCursor == nil {
				break
			}
			query = sort + "&limit=2&cursor=" + *page.NextCursor
		}
		if !reflect.DeepEqual(walked, want) {
			t.Fatalf("%q: walked %v, want %v", sort, walked, want)
		}
	}
}

func TestDeliveries_CursorBindsSortAndOrder(t *testing.T) {
	fx := newDeliveryFixture()
	page := fx.list(t, "&sort=title&limit=2")
	if page.NextCursor == nil {
		t.Fatal("no cursor")
	}
	cursor := "&cursor=" + *page.NextCursor
	for _, query := range []string{"&sort=delivered&limit=2", "&sort=title&order=desc&limit=2", "&limit=2", "&sort=title&limit=2&result=late"} {
		if _, err := fx.svc.ListDeliveries(context.Background(), fx.company, q1+query+cursor); !errors.Is(err, ErrInvalidCursor) {
			t.Fatalf("%q: %v", query, err)
		}
	}
	// The same sort spelled with its default order continues; limit is free.
	if _, err := fx.svc.ListDeliveries(context.Background(), fx.company, q1+"&sort=title&order=asc&limit=3"+cursor); err != nil {
		t.Fatal(err)
	}
	// Another route never continues it.
	if _, err := fx.svc.Vacancies(context.Background(), fx.company, q1+"&sort=title&limit=2"+cursor); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("vacancies: %v", err)
	}
}

func TestDeliveries_FiltersFacetsAndRowShape(t *testing.T) {
	fx := newDeliveryFixture()
	// The result facet ignores the result filter only.
	got := fx.list(t, "&result=late&attributed_to="+fx.u.String())
	if !reflect.DeepEqual(deliveryTitles(got.Items), []string{"beta"}) || got.Total != 1 {
		t.Fatalf("%v %d", deliveryTitles(got.Items), got.Total)
	}
	// process_kind (R6a) counts the rows passing every other filter: one original.
	if want := (DeliveryFacets{Result: DeliveryStatus{OnTime: 1, Late: 1, Overdue: 1}, ProcessKind: &ProcessKindFacet{Original: 1}}); !reflect.DeepEqual(got.Facets, want) {
		t.Fatalf("facets %+v", got.Facets)
	}
	row := got.Items[0]
	if row.Result != "late" || row.BusinessDaysLate == nil || *row.BusinessDaysLate != 4 || row.BusinessDaysOverdue != nil ||
		row.Delivered != 3 || row.Target == nil || *row.Target != 1 || row.CommitmentDate == nil || *row.CommitmentDate != "2026-01-31" ||
		row.TargetReachedAt == nil || !row.TargetReachedAt.Equal(at("2026-02-05T18:00:00Z")) ||
		len(row.AttributedTo) != 1 || row.AttributedTo[0].UserID != fx.u || row.Vacancy.DraftID != fx.b.ID {
		t.Fatalf("row %+v", row)
	}
	// Facets with no filter add up to the total.
	all := fx.list(t, "")
	if want := (DeliveryFacets{Result: DeliveryStatus{OnTime: 1, Late: 2, Overdue: 1, Pending: 1, NotConfigured: 1}, ProcessKind: &ProcessKindFacet{Original: 6}}); !reflect.DeepEqual(all.Facets, want) {
		t.Fatalf("all facets %+v", all.Facets)
	}
	overdue := fx.list(t, "&result=overdue")
	if r := overdue.Items[0]; r.BusinessDaysOverdue == nil || *r.BusinessDaysOverdue != 14 || r.BusinessDaysLate != nil {
		t.Fatalf("overdue row %+v", r)
	}
	for query, want := range map[string][]string{
		"&result=on_time,late,overdue":             {"Delta", "Gamma", "beta", "Alfa"},
		"&result=late&late_bucket=up_to_2":         {"Gamma"},
		"&late_bucket=from_3_to_5":                 {"beta"},
		"&late_bucket=over_5":                      {},
		"&commitment_month=2026-02":                {"Gamma"},
		"&commitment_month=2026-01&result=on_time": {"Alfa"},
		"&attributed_to=" + fx.w.String():          {"Gamma"},
		"&attributed_to=" + uuid.NewString():       {},
		"&vacancy_id=" + fx.c.ID.String():          {"Gamma"},
		"&recruiter_id=" + fx.w.String():           {"Gamma", "Zeta"},
		"&result=pending,not_configured":           {"Eps", "Zeta"},
	} {
		got := fx.list(t, query)
		if titles := deliveryTitles(got.Items); !slices.Equal(titles, want) || got.Total != len(want) {
			t.Fatalf("%q: %v (%d), want %v", query, titles, got.Total, want)
		}
	}
	// A late bucket keeps late rows only, so its facet shows only late.
	if got := fx.list(t, "&late_bucket=up_to_2"); !reflect.DeepEqual(got.Facets, DeliveryFacets{Result: DeliveryStatus{Late: 1}, ProcessKind: &ProcessKindFacet{Original: 1}}) {
		t.Fatalf("bucket facets %+v", got.Facets)
	}
}

func TestParseQuery_ListGrammar(t *testing.T) {
	id := uuid.NewString()
	q, err := ParseQuery(q1+"&result=late,on_time&sort=delivered&order=asc&vacancy_id="+id+"&attributed_to="+id+"&late_bucket=over_5&commitment_month=2026-02", RouteDeliveries)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(q.Results, []string{"late", "on_time"}) || q.Sort != "delivered" || q.Order != "asc" || q.VacancyID == nil ||
		q.AttributedTo == nil || q.LateBucket != "over_5" || q.CommitmentMonth != "2026-02" {
		t.Fatalf("%+v", q)
	}
	// Defaults resolve per route; text sorts default to asc.
	for _, tc := range []struct {
		route       Route
		query       string
		sort, order string
	}{
		{RouteDeliveries, "", "commitment_date", "desc"},
		{RouteVacancies, "", "opened_at", "desc"},
		{RoutePlacements, "", "hired_at", "desc"},
		{RouteReassignments, "", "performed_at", "desc"},
		{RouteVacancies, "&sort=title", "title", "asc"},
		{RoutePlacements, "&sort=candidate", "candidate", "asc"},
		{RouteReassignments, "&sort=reason", "reason", "asc"},
		{RouteVacancies, "&sort=business_days_to_close", "business_days_to_close", "desc"},
	} {
		q, err := ParseQuery(q1+tc.query, tc.route)
		if err != nil || q.Sort != tc.sort || q.Order != tc.order {
			t.Fatalf("%s%s: %+v %v", tc.route, tc.query, q, err)
		}
	}
	held, err := ParseQuery(q1+"&held=false&recipient="+id, RoutePlacements)
	if err != nil || held.Held == nil || *held.Held || held.Recipient == nil {
		t.Fatalf("%+v %v", held, err)
	}
	vac, err := ParseQuery(q1+"&scope=closed_assigned&closed_month=2026-02&close_reason=filled,no_reason&closing_target=no_target&credited_to="+id+"&outcome=open", RouteVacancies)
	if err != nil || vac.Scope != "closed_assigned" || vac.ClosedMonth != "2026-02" || !slices.Equal(vac.CloseReasons, []string{"filled", "no_reason"}) ||
		vac.ClosingTarget != "no_target" || vac.CreditedTo == nil || vac.Outcome != "open" {
		t.Fatalf("%+v %v", vac, err)
	}
	re, err := ParseQuery(q1+"&recruiter_id="+id+"&direction=lost&reason=workload,other", RouteReassignments)
	if err != nil || re.Direction != "lost" || !slices.Equal(re.Reasons, []string{"workload", "other"}) {
		t.Fatalf("%+v %v", re, err)
	}
}

func TestParseQuery_ListRejections(t *testing.T) {
	for _, tc := range []struct {
		query string
		route Route
		want  []Field
	}{
		{"&sort=nope", RouteDeliveries, []Field{{"sort", "invalid"}}},
		{"&sort=hired_at", RouteDeliveries, []Field{{"sort", "invalid"}}},
		{"&order=up", RouteDeliveries, []Field{{"order", "invalid"}}},
		{"&result=late&result=on_time", RouteDeliveries, []Field{{"result", "duplicate"}}},
		{"&result=late,", RouteDeliveries, []Field{{"result", "invalid"}}},
		{"&result=late,early", RouteDeliveries, []Field{{"result", "invalid"}}},
		{"&result=late,late", RouteDeliveries, []Field{{"result", "invalid"}}},
		{"&late_bucket=over_9", RouteDeliveries, []Field{{"late_bucket", "invalid"}}},
		{"&commitment_month=2026-13", RouteDeliveries, []Field{{"commitment_month", "invalid"}}},
		{"&attributed_to=x", RouteDeliveries, []Field{{"attributed_to", "invalid"}}},
		{"&vacancy_id=x", RouteDeliveries, []Field{{"vacancy_id", "invalid"}}},
		{"&held=yes", RoutePlacements, []Field{{"held", "invalid"}}},
		{"&recipient=x", RoutePlacements, []Field{{"recipient", "invalid"}}},
		{"&result=late", RoutePlacements, []Field{{"result", "unknown"}}},
		{"&scope=all", RouteVacancies, []Field{{"scope", "invalid"}}},
		{"&close_reason=won", RouteVacancies, []Field{{"close_reason", "invalid"}}},
		{"&closing_target=soon", RouteVacancies, []Field{{"closing_target", "invalid"}}},
		{"&closed_month=2026-1", RouteVacancies, []Field{{"closed_month", "invalid"}}},
		{"&direction=received", RouteReassignments, []Field{{"recruiter_id", "required"}}},
		{"&direction=gone&recruiter_id=" + uuid.NewString(), RouteReassignments, []Field{{"direction", "invalid"}}},
		{"&reason=workload,boredom", RouteReassignments, []Field{{"reason", "invalid"}}},
		{"&sort=title", RouteRecruiters, []Field{{"sort", "unknown"}}},
		{"&sort=title", RouteSummary, []Field{{"sort", "unknown"}}},
	} {
		_, err := ParseQuery(q1+tc.query, tc.route)
		if got := fieldsOf(t, err); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s %q: %v, want %v", tc.route, tc.query, got, tc.want)
		}
	}
	// Exports take the list's filters and sort, never a cursor or a limit.
	if _, err := ParseExportQuery(q1+"&sort=title&order=desc&result=late", RouteDeliveries); err != nil {
		t.Fatal(err)
	}
	if got := fieldsOf(t, func() error { _, err := ParseExportQuery(q1+"&cursor=x&limit=5", RouteDeliveries); return err }()); !reflect.DeepEqual(got, []Field{{"cursor", "unknown"}, {"limit", "unknown"}}) {
		t.Fatal(got)
	}
}

func TestVacancies_ScopesRowFieldsAndCloseReasonFacet(t *testing.T) {
	u := uuid.New()
	company := uuid.New()
	// Filled twice: last close filled, measured at the first (Jan 12 → 5
	// business days from Jan 5), on time against Jan 15.
	filled := vacancy("Cubierta", "2026-01-05T16:00:00Z").withTramo(u, "2026-01-05T16:00:00Z").
		withClose("2026-01-12T18:00:00Z", ptr("filled"), ptr("2026-01-15")).
		withClose("2026-02-16T18:00:00Z", ptr("filled"), nil)
	filled.Credits = []Credit{{ID: uuid.New(), HiredAt: at("2025-12-01T18:00:00Z"), Status: "active", Recipients: []Recipient{{u, "direct"}}}}
	// Filled then cancelled: cancelled, no time to close.
	undone := vacancy("Deshecha", "2026-01-06T16:00:00Z").withTramo(u, "2026-01-06T16:00:00Z").
		withClose("2026-01-09T18:00:00Z", ptr("filled"), nil).withClose("2026-02-20T18:00:00Z", ptr("cancelled"), nil)
	// Legacy close, nobody assigned in the period.
	legacy := vacancy("Antigua", "2025-06-01T16:00:00Z").withClose("2026-03-02T18:00:00Z", nil, nil)
	// Open, assigned.
	open := vacancy("Abierta", "2026-02-01T16:00:00Z").withTramo(u, "2026-02-01T16:00:00Z")
	store := &listStore{data: &Dataset{Vacancies: []*Vacancy{filled, undone, legacy, open}, People: map[uuid.UUID]Person{}}}
	svc := newTestService(store, at("2026-03-20T18:00:00Z"))
	list := func(query string) *List[VacancyRow, VacancyFacets] {
		t.Helper()
		out, err := svc.Vacancies(context.Background(), company, q1+query)
		if err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		return out
	}
	names := func(l *List[VacancyRow, VacancyFacets]) []string {
		return titles(l.Items, func(r VacancyRow) string { return r.Title })
	}
	for query, want := range map[string][]string{
		"":                                   {"Abierta", "Deshecha", "Cubierta", "Antigua"},
		"&scope=activity":                    {"Abierta", "Deshecha", "Cubierta", "Antigua"},
		"&scope=assigned":                    {"Abierta", "Deshecha", "Cubierta"},
		"&scope=closed":                      {"Deshecha", "Cubierta", "Antigua"},
		"&scope=closed_assigned":             {"Deshecha", "Cubierta"},
		"&scope=closed&close_reason=filled":  {"Cubierta"},
		"&close_reason=cancelled,no_reason":  {"Deshecha", "Antigua"},
		"&scope=closed&closed_month=2026-01": {"Deshecha", "Cubierta"},
		"&scope=closed&closed_month=2026-01&close_reason=filled":     {"Deshecha", "Cubierta"},
		"&scope=closed&close_reason=filled&closing_target=on_time":   {"Cubierta"},
		"&scope=closed&close_reason=filled&closing_target=no_target": {},
		"&scope=closed_assigned&credited_to=" + u.String():           {"Cubierta"},
		"&outcome=filled": {"Deshecha", "Cubierta"},
		"&outcome=open":   {"Abierta"},
	} {
		got := list(query)
		if !slices.Equal(names(got), want) || got.Total != len(want) {
			t.Fatalf("%q: %v (%d), want %v", query, names(got), got.Total, want)
		}
	}
	// Only the filled vacancy has a time to close; nulls go last in both orders.
	for _, order := range []string{"asc", "desc"} {
		if got := names(list("&sort=business_days_to_close&order=" + order)); got[0] != "Cubierta" {
			t.Fatalf("%s: %v", order, got)
		}
	}
	// The close_reason facet counts closed rows by their last close, ignoring
	// only close_reason.
	got := list("&scope=closed_assigned&close_reason=filled")
	if want := (VacancyFacets{CloseReason: ClosedCounts{Filled: 1, Cancelled: 1}}); got.Facets != want {
		t.Fatalf("facets %+v", got.Facets)
	}
	if got := list(""); got.Facets != (VacancyFacets{CloseReason: ClosedCounts{Filled: 1, Cancelled: 1, NoReason: 1}}) {
		t.Fatalf("all facets %+v", got.Facets)
	}
	row := list("&close_reason=filled").Items[0]
	if !row.OpenedAt.Equal(at("2026-01-05T16:00:00Z")) || row.LastClose == nil || row.LastClose.Date != "2026-02-16" || *row.LastClose.Reason != "filled" ||
		row.BusinessDaysToClose == nil || *row.BusinessDaysToClose != 5 || row.ClosingTarget == nil || *row.ClosingTarget != "on_time" {
		t.Fatalf("row %+v", row)
	}
	other := list("&close_reason=cancelled").Items[0]
	if other.BusinessDaysToClose != nil || other.ClosingTarget != nil || other.LastClose.Date != "2026-02-20" {
		t.Fatalf("cancelled row %+v", other)
	}
	if o := list("&outcome=open").Items[0]; o.LastClose != nil {
		t.Fatalf("open row %+v", o)
	}
}

func placementFixture() (*listStore, *Service, uuid.UUID, uuid.UUID, uuid.UUID) {
	u, w := uuid.New(), uuid.New()
	v := vacancy("Uno", "2026-01-05T16:00:00Z").withTramo(u, "2026-01-05T16:00:00Z")
	v.Credits = []Credit{
		{ID: uuid.New(), HiredAt: at("2026-02-01T18:00:00Z"), Status: "active", Candidate: Candidate{ID: uuid.New(), FullName: "Bruno"}, Recipients: []Recipient{{w, "participant"}, {u, "direct"}}},
		{ID: uuid.New(), HiredAt: at("2026-03-01T18:00:00Z"), Status: "did_not_hold", Candidate: Candidate{ID: uuid.New(), FullName: "ana"}, Recipients: []Recipient{{u, "direct"}}},
		{ID: uuid.New(), HiredAt: at("2025-12-01T18:00:00Z"), Status: "active", Candidate: Candidate{ID: uuid.New(), FullName: "Fuera"}, Recipients: []Recipient{{u, "direct"}}},
	}
	store := &listStore{data: &Dataset{Vacancies: []*Vacancy{v}, People: map[uuid.UUID]Person{
		u: {UserID: u, Name: ptr("Ursula")}, w: {UserID: w, Name: ptr("Walter"), FormerMember: true},
	}}}
	return store, newTestService(store, at("2026-03-20T18:00:00Z")), u, w, v.ID
}

func TestPlacements_ListFacetsAndAuditPerPage(t *testing.T) {
	_, svc, u, w, _ := placementFixture()
	company, actor := uuid.New(), uuid.New()
	list := func(query string) *List[PlacementListRow, PlacementFacets] {
		t.Helper()
		out, err := svc.ListPlacements(context.Background(), company, actor, q1+query)
		if err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		return out
	}
	got := list("&held=true")
	if got.Total != 1 || got.Items[0].Candidate.FullName != "Bruno" || got.Items[0].Status != "active" {
		t.Fatalf("%+v", got)
	}
	if !reflect.DeepEqual(got.Facets, PlacementFacets{Held: HeldFacet{True: 1, False: 1}, ProcessKind: &ProcessKindFacet{Original: 1}}) {
		t.Fatalf("facets %+v", got.Facets)
	}
	// Recipients by kind (direct first), then user id.
	if r := got.Items[0].Recipients; len(r) != 2 || r[0].Person.UserID != u || r[0].Kind != "direct" || r[1].Person.UserID != w || !r[1].Person.FormerMember {
		t.Fatalf("recipients %+v", r)
	}
	if got := list("&sort=candidate"); got.Items[0].Candidate.FullName != "ana" {
		t.Fatalf("candidate sort %+v", got.Items)
	}
	if got := list("&recipient=" + w.String()); got.Total != 1 || !reflect.DeepEqual(got.Facets, PlacementFacets{Held: HeldFacet{True: 1}, ProcessKind: &ProcessKindFacet{Original: 1}}) {
		t.Fatalf("recipient %+v", got)
	}
}

func TestPlacements_AuditRowsAndFailClosed(t *testing.T) {
	store, svc, _, _, draft := placementFixture()
	company, actor := uuid.New(), uuid.New()
	first, err := svc.ListPlacements(context.Background(), company, actor, q1+"&limit=1&vacancy_id="+draft.String())
	if err != nil || first.NextCursor == nil {
		t.Fatalf("%+v %v", first, err)
	}
	if _, err := svc.ListPlacements(context.Background(), company, actor, q1+"&limit=1&vacancy_id="+draft.String()+"&cursor="+*first.NextCursor); err != nil {
		t.Fatal(err)
	}
	if len(store.audits) != 2 {
		t.Fatalf("audits %d", len(store.audits))
	}
	want := map[string]any{"from": "2026-01-01", "to": "2026-03-31", "vacancy_id": draft.String(), "sort": "hired_at", "order": "desc", "limit": 1}
	for _, a := range store.audits {
		if a.Company != company || a.Actor != actor || a.Exported || a.Report != "placements" || a.Vacancy == nil || *a.Vacancy != draft ||
			!a.VacancyOwned || !reflect.DeepEqual(a.Filters, want) {
			t.Fatalf("audit %+v", a)
		}
	}
	// A rejected request audits nothing; a failed audit serves nothing.
	if _, err := svc.ListPlacements(context.Background(), company, actor, q1+"&held=maybe"); err == nil {
		t.Fatal("bad filter accepted")
	}
	store.failAudit = true
	if out, err := svc.ListPlacements(context.Background(), company, actor, q1); err == nil || out != nil {
		t.Fatalf("fail-closed: %+v %v", out, err)
	}
	if len(store.audits) != 2 {
		t.Fatalf("audits %d", len(store.audits))
	}
}

func TestReassignments_DirectionReasonFacetAndSort(t *testing.T) {
	u, w, x := uuid.New(), uuid.New(), uuid.New()
	v := vacancy("Uno", "2026-01-05T16:00:00Z").withTramo(u, "2026-01-05T16:00:00Z")
	v.Reassigns = []Reassignment{
		{ID: uuid.New(), At: at("2026-01-10T18:00:00Z"), Reason: "workload", From: u, To: w, By: x, FromStarted: at("2026-01-05T16:00:00Z")},
		{ID: uuid.New(), At: at("2026-02-10T18:00:00Z"), Reason: "performance", From: w, To: u, By: x, FromStarted: at("2026-01-10T18:00:00Z")},
		{ID: uuid.New(), At: at("2026-03-10T18:00:00Z"), Reason: "client_request", From: x, To: w, By: x, FromStarted: at("2026-01-10T18:00:00Z")},
	}
	store := &listStore{data: &Dataset{Vacancies: []*Vacancy{v}, People: map[uuid.UUID]Person{}}}
	svc := newTestService(store, at("2026-03-20T18:00:00Z"))
	list := func(query string) *List[ReassignmentRow, ReassignmentFacets] {
		t.Helper()
		out, err := svc.Reassignments(context.Background(), uuid.New(), q1+query)
		if err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		return out
	}
	reasons := func(l *List[ReassignmentRow, ReassignmentFacets]) []string {
		return titles(l.Items, func(r ReassignmentRow) string { return r.Reason })
	}
	for query, want := range map[string][]string{
		"":                            {"client_request", "performance", "workload"},
		"&recruiter_id=" + u.String(): {"performance", "workload"},
		"&recruiter_id=" + u.String() + "&direction=lost":     {"workload"},
		"&recruiter_id=" + u.String() + "&direction=received": {"performance"},
		"&reason=workload,performance":                        {"performance", "workload"},
		"&sort=reason":                                        {"client_request", "performance", "workload"},
		"&sort=performed_at&order=asc":                        {"workload", "performance", "client_request"},
	} {
		got := list(query)
		if !slices.Equal(reasons(got), want) || got.Total != len(want) {
			t.Fatalf("%q: %v", query, reasons(got))
		}
	}
	got := list("&reason=workload&recruiter_id=" + w.String())
	if !reflect.DeepEqual(got.Facets, ReassignmentFacets{Reason: ByReason{Workload: 1, Performance: 1, ClientRequest: 1}, ProcessKind: &ProcessKindFacet{Original: 1}}) || got.Total != 1 {
		t.Fatalf("facets %+v", got.Facets)
	}
}

func TestAppliedFilters_ResolveNamesWithoutCrossCompanyLeak(t *testing.T) {
	store, svc, u, _, draft := placementFixture()
	stranger, requester, foreignVacancy := uuid.New(), uuid.New(), uuid.New()
	company := uuid.New()
	// Names the snapshot holds come from it; the rest from the store, which
	// answers null for people and catalog rows outside the company.
	store.nameReply = Names{People: map[uuid.UUID]Person{stranger: {UserID: stranger, FormerMember: true}}}
	got, err := svc.ListPlacements(context.Background(), company, uuid.New(),
		q1+"&recruiter_id="+u.String()+"&recipient="+stranger.String()+"&requester_kind=client&requester_id="+requester.String()+"&vacancy_id="+foreignVacancy.String()+"&held=true")
	if err != nil {
		t.Fatal(err)
	}
	if got.Total != 0 || len(got.Items) != 0 {
		t.Fatalf("%+v", got)
	}
	wire := decode(t, got)["applied_filters"]
	want := map[string]any{
		"recruiter": map[string]any{"user_id": u.String(), "name": "Ursula", "former_member": false},
		"recipient": map[string]any{"user_id": stranger.String(), "name": nil, "former_member": true},
		"requester": map[string]any{"kind": "client", "id": requester.String(), "name": nil},
		"vacancy":   map[string]any{"draft_id": foreignVacancy.String(), "title": nil},
		"held":      true,
	}
	if !reflect.DeepEqual(wire, want) {
		t.Fatalf("applied %#v", wire)
	}
	if len(store.names) != 1 || !slices.Equal(store.names[0].People, []uuid.UUID{stranger}) || store.names[0].Vacancy == nil ||
		*store.names[0].Vacancy != foreignVacancy || store.names[0].Requester == nil {
		t.Fatalf("name query %+v", store.names)
	}
	// The audit row knows the vacancy is not this company's.
	if a := store.audits[len(store.audits)-1]; a.Vacancy == nil || *a.Vacancy != foreignVacancy || a.VacancyOwned {
		t.Fatalf("audit %+v", a)
	}
	// Names the snapshot knows need no query; «sin solicitante» is "none";
	// a kind alone is echoed as sent; absent keys are absent.
	store.names = nil
	got, err = svc.ListPlacements(context.Background(), company, uuid.New(), q1+"&vacancy_id="+draft.String()+"&requester_id=none")
	if err != nil {
		t.Fatal(err)
	}
	if wire := decode(t, got)["applied_filters"]; !reflect.DeepEqual(wire, map[string]any{
		"vacancy": map[string]any{"draft_id": draft.String(), "title": "Uno"}, "requester": "none",
	}) || len(store.names) != 0 {
		t.Fatalf("applied %#v, queries %d", wire, len(store.names))
	}
	fx := newDeliveryFixture()
	out := fx.list(t, "&requester_kind=internal_area&result=late,on_time&commitment_month=2026-01")
	if wire := decode(t, out)["applied_filters"]; !reflect.DeepEqual(wire, map[string]any{
		"requester_kind": "internal_area", "result": []any{"late", "on_time"}, "commitment_month": "2026-01",
	}) {
		t.Fatalf("plain %#v", wire)
	}
	if wire := decode(t, fx.list(t, ""))["applied_filters"]; !reflect.DeepEqual(wire, map[string]any{}) {
		t.Fatalf("empty %#v", wire)
	}
}

func TestExport_SameRowsAuditBeforeStreamAndLimit(t *testing.T) {
	store, svc, _, _, _ := placementFixture()
	company, actor := uuid.New(), uuid.New()
	export, err := svc.Export(context.Background(), company, actor, "placements", q1+"&sort=candidate")
	if err != nil {
		t.Fatal(err)
	}
	if export.Filename != "metricas-placements-2026-01-01-2026-03-31.csv" || export.Len() != 2 {
		t.Fatalf("%+v", export)
	}
	if export.Header[0] != "ID crédito" || len(export.Record(0)) != len(export.Header) || export.Record(0)[2] != "ana" {
		t.Fatalf("%v %v", export.Header, export.Record(0))
	}
	if len(store.audits) != 1 || !store.audits[0].Exported || store.audits[0].RowCount != 2 || store.audits[0].Report != "placements" ||
		!reflect.DeepEqual(store.audits[0].Filters, map[string]any{"from": "2026-01-01", "to": "2026-03-31", "sort": "candidate", "order": "asc"}) {
		t.Fatalf("audit %+v", store.audits)
	}
	// Not audited kinds write nothing.
	for _, kind := range []string{"deliveries", "vacancies", "reassignments"} {
		if _, err := svc.Export(context.Background(), company, actor, kind, q1); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
	}
	if len(store.audits) != 1 {
		t.Fatalf("unaudited kinds wrote %d", len(store.audits)-1)
	}
	// Above the limit: 422 with the count, nothing audited.
	svc.WithExportLimit(1)
	_, err = svc.Export(context.Background(), company, actor, "placements", q1)
	var tooLarge *TooLarge
	if !errors.As(err, &tooLarge) || tooLarge.RowCount != 2 || tooLarge.Limit != 1 || len(store.audits) != 1 {
		t.Fatalf("%v %+v", err, store.audits)
	}
	svc.WithExportLimit(2)
	store.failAudit = true
	if out, err := svc.Export(context.Background(), company, actor, "placements", q1); err == nil || out != nil {
		t.Fatalf("fail-closed %v", err)
	}
	if _, err := svc.Export(context.Background(), company, actor, "placements", q1+"&cursor=x"); fieldsOf(t, err)[0] != (Field{"cursor", "unknown"}) {
		t.Fatal(err)
	}
}
