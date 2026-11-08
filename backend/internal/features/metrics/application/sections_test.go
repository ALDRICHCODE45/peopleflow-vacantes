package application

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// weekdays is a holiday-free business calendar.
func weekdays(d time.Time) bool { return d.Weekday() != time.Saturday && d.Weekday() != time.Sunday }

// periodStore serves one dataset per period ("from..to"); a period it does not
// know loads empty.
type periodStore struct {
	Store
	mu       sync.Mutex
	data     map[string]*Dataset
	loads    int
	inFlight int
	peak     int
	hold     chan struct{} // when set, every load waits on it
}

func (s *periodStore) Load(_ context.Context, _ uuid.UUID, scope Scope) (*Dataset, error) {
	s.mu.Lock()
	s.loads++
	s.inFlight++
	s.peak = max(s.peak, s.inFlight)
	s.mu.Unlock()
	if s.hold != nil {
		<-s.hold
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.inFlight--
	if d, ok := s.data[scope.Period.From+".."+scope.Period.To]; ok {
		return d, nil
	}
	return &Dataset{People: map[uuid.UUID]Person{}}, nil
}

func at(v string) time.Time {
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		panic(err)
	}
	return t
}

func ptr[T any](v T) *T { return &v }

// sameRate compares rates by value (Value is a pointer).
func sameRate(a, b Rate) bool {
	return a.Numerator == b.Numerator && a.Denominator == b.Denominator &&
		(a.Value == nil) == (b.Value == nil) && (a.Value == nil || *a.Value == *b.Value)
}

func newTestService(store Store, now time.Time) *Service {
	return NewService(store, weekdays, func() time.Time { return now })
}

// decode round-trips a response through JSON so tests read the wire shape.
func decode(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func vacancy(title string, published string) *Vacancy {
	return &Vacancy{ID: uuid.New(), Title: title, PublishedAt: at(published), Origin: map[string]int{}}
}

// tramo assigns user for [start, open).
func (v *Vacancy) withTramo(user uuid.UUID, start string) *Vacancy {
	v.Tramos = append(v.Tramos, Tramo{ID: uuid.New(), UserID: user, Start: at(start)})
	v.Functions = append(v.Functions, Function{UserID: user, Function: "responsible", Start: at(start)})
	return v
}

func (v *Vacancy) withClose(when string, reason *string, target *string) *Vacancy {
	v.Closes = append(v.Closes, Close{At: at(when), Reason: reason, Target: target})
	return v
}

func (v *Vacancy) withDelivery(commitment string, target int, reached *string) *Vacancy {
	v.Delivery = DeliveryFacts{Configured: true, Commitment: ptr(commitment), Target: ptr(target)}
	if reached != nil {
		r := at(*reached)
		v.Delivery.TargetReachedAt = &r
	}
	return v
}

const q1 = "from=2026-01-01&to=2026-03-31"

// V1: closed counts distinct vacancies by the reason of their last close in
// the period; the median uses the first filled close; closing target and
// by_requester.filled follow the same rule (§3.1).
func TestSummary_ClosedCountsDistinctVacancies(t *testing.T) {
	user := uuid.New()
	// cancelled → reopen → filled: one vacancy, filled; median from Jan 12.
	reopened := vacancy("Reabierta", "2026-01-05T16:00:00Z").withTramo(user, "2026-01-05T16:00:00Z").
		withClose("2026-01-07T18:00:00Z", ptr("cancelled"), nil).
		withClose("2026-01-12T18:00:00Z", ptr("filled"), ptr("2026-01-10")).
		withClose("2026-02-16T18:00:00Z", ptr("filled"), ptr("2026-03-01"))
	// filled → cancelled: counts as cancelled, not in the median.
	undone := vacancy("Deshecha", "2026-01-05T16:00:00Z").withTramo(user, "2026-01-05T16:00:00Z").
		withClose("2026-01-09T18:00:00Z", ptr("filled"), nil).
		withClose("2026-01-20T18:00:00Z", ptr("cancelled"), nil)
	// a close before the period does not count.
	old := vacancy("Vieja", "2025-11-03T16:00:00Z").withTramo(user, "2025-11-03T16:00:00Z").
		withClose("2025-12-15T18:00:00Z", ptr("filled"), nil).
		withClose("2026-03-02T18:00:00Z", nil, nil)
	store := &periodStore{data: map[string]*Dataset{"2026-01-01..2026-03-31": {Vacancies: []*Vacancy{reopened, undone, old}, People: map[uuid.UUID]Person{}}}}
	got, err := newTestService(store, at("2026-04-01T18:00:00Z")).Summary(context.Background(), uuid.New(), q1)
	if err != nil {
		t.Fatal(err)
	}
	if got.Vacancies.Closed != (ClosedCounts{Filled: 1, Cancelled: 1, NoReason: 1}) {
		t.Fatalf("closed %+v", got.Vacancies.Closed)
	}
	// Jan 5 → Jan 12 = 5 business days (the first filled close).
	if m := got.Vacancies.MedianBusinessDaysToClose; m == nil || *m != 5 {
		t.Fatalf("median %v", m)
	}
	// Judged at the first filled close: Jan 12 > target Jan 10.
	if got.Vacancies.ClosingTarget != (ClosingTarget{Late: 1}) {
		t.Fatalf("closing target %+v", got.Vacancies.ClosingTarget)
	}
	if len(got.ByRequester) != 1 || got.ByRequester[0].Filled != 1 {
		t.Fatalf("by requester %+v", got.ByRequester)
	}
	// Per month, the last close in that month: Jan has reopened (filled, its
	// last January close) and undone (cancelled); Feb reopened again.
	want := []ClosedMonth{
		{Month: "2026-01", ClosedCounts: ClosedCounts{Filled: 1, Cancelled: 1}},
		{Month: "2026-02", ClosedCounts: ClosedCounts{Filled: 1}},
		{Month: "2026-03", ClosedCounts: ClosedCounts{NoReason: 1}},
	}
	for i, m := range want {
		if got.ClosedByMonth[i] != m {
			t.Fatalf("closed_by_month[%d] %+v, want %+v", i, got.ClosedByMonth[i], m)
		}
	}
}

func TestPeriod_Previous(t *testing.T) {
	for _, tc := range []struct{ from, to, prevFrom, prevTo string }{
		{"2025-01-01", "2025-03-31", "2024-10-03", "2024-12-31"},
		{"2024-03-01", "2024-03-31", "2024-01-30", "2024-02-29"},
		{"2026-11-08", "2026-11-08", "2026-11-07", "2026-11-07"},
	} {
		p := mustPeriod(t, tc.from, tc.to)
		prev := p.Previous()
		if prev.From != tc.prevFrom || prev.To != tc.prevTo {
			t.Fatalf("%s..%s: previous %s..%s, want %s..%s", tc.from, tc.to, prev.From, prev.To, tc.prevFrom, tc.prevTo)
		}
		if !prev.End.Equal(p.Start) {
			t.Fatalf("previous does not end where the period starts")
		}
	}
}

// V2 / N1 / N2: headline current vs previous with the same filters, the
// previous period loaded in parallel, as_of on every response.
func TestSummary_HeadlinePreviousPeriodAndOnTimeByMonth(t *testing.T) {
	ana, beto := uuid.New(), uuid.New()
	// Current period (Q1 2026).
	onTime := vacancy("A", "2026-01-05T16:00:00Z").withTramo(ana, "2026-01-05T16:00:00Z").
		withDelivery("2026-01-20", 1, ptr("2026-01-15T18:00:00Z"))
	late := vacancy("B", "2026-01-05T16:00:00Z").withTramo(beto, "2026-01-05T16:00:00Z").
		withDelivery("2026-03-10", 1, ptr("2026-03-12T18:00:00Z"))
	late.Credits = []Credit{{ID: uuid.New(), HiredAt: at("2026-03-12T18:00:00Z"), Status: "active"}}
	overdue := vacancy("C", "2026-01-05T16:00:00Z").withTramo(ana, "2026-01-05T16:00:00Z").
		withDelivery("2026-03-20", 2, nil)
	overdue.Reassigns = []Reassignment{{ID: uuid.New(), At: at("2026-02-02T18:00:00Z"), Reason: "workload"}}
	// Previous period (2025-10-03..2025-12-31): fulfilled after the window
	// ends, judged with today's knowledge (late), not replayed as pending.
	prevLate := vacancy("P", "2025-10-06T16:00:00Z").withTramo(ana, "2025-10-06T16:00:00Z").
		withDelivery("2025-12-15", 1, ptr("2026-01-08T18:00:00Z"))
	prevBeto := vacancy("Q", "2025-10-06T16:00:00Z").withTramo(beto, "2025-10-06T16:00:00Z").
		withDelivery("2025-11-14", 1, ptr("2025-11-10T18:00:00Z"))
	store := &periodStore{hold: make(chan struct{}), data: map[string]*Dataset{
		"2026-01-01..2026-03-31": {Vacancies: []*Vacancy{onTime, late, overdue}, People: map[uuid.UUID]Person{}},
		"2025-10-03..2025-12-31": {Vacancies: []*Vacancy{prevLate, prevBeto}, People: map[uuid.UUID]Person{}},
	}}
	now := at("2026-03-25T18:00:00Z")
	s := newTestService(store, now)
	done := make(chan struct{})
	var got *Summary
	var err error
	go func() { got, err = s.Summary(context.Background(), uuid.New(), q1); close(done) }()
	waitFor(t, func() bool { store.mu.Lock(); defer store.mu.Unlock(); return store.inFlight == 2 })
	close(store.hold)
	<-done
	if err != nil {
		t.Fatal(err)
	}
	body := decode(t, got)
	if body["definitions_version"] != "v2" || body["as_of"] != "2026-03-25T18:00:00Z" {
		t.Fatalf("header %v %v", body["definitions_version"], body["as_of"])
	}
	if pp := body["previous_period"].(map[string]any); pp["from"] != "2025-10-03" || pp["to"] != "2025-12-31" {
		t.Fatalf("previous_period %v", pp)
	}
	h := got.Headline
	if !sameRate(h.OnTimeRate.Current, NewRate(1, 3)) || !sameRate(h.OnTimeRate.Previous, NewRate(1, 2)) {
		t.Fatalf("on_time_rate %+v", h.OnTimeRate)
	}
	if h.Assigned != (Delta[int]{3, 2}) || h.Placements != (Delta[int]{1, 0}) || h.Reassignments != (Delta[int]{1, 0}) {
		t.Fatalf("headline %+v", h)
	}
	if h.MedianBusinessDaysToClose.Current != nil || h.MedianBusinessDaysToClose.Previous != nil {
		t.Fatalf("median %+v", h.MedianBusinessDaysToClose)
	}
	// N2: dense over Jan..Mar by commitment month; Feb has no judged delivery.
	wantMonths := []MonthRate{{"2026-01", NewRate(1, 1)}, {"2026-02", NewRate(0, 0)}, {"2026-03", NewRate(0, 2)}}
	if len(got.OnTimeByMonth) != 3 {
		t.Fatalf("on_time_by_month %+v", got.OnTimeByMonth)
	}
	for i, m := range wantMonths {
		if got.OnTimeByMonth[i].Month != m.Month || !sameRate(got.OnTimeByMonth[i].Rate, m.Rate) {
			t.Fatalf("month %d: %+v, want %+v", i, got.OnTimeByMonth[i], m)
		}
	}

	// The same filters apply to the previous period.
	got, err = s.Summary(context.Background(), uuid.New(), q1+"&recruiter_id="+beto.String())
	if err != nil {
		t.Fatal(err)
	}
	if got.Headline.Assigned != (Delta[int]{1, 1}) || !sameRate(got.Headline.OnTimeRate.Previous, NewRate(1, 1)) || !sameRate(got.Headline.OnTimeRate.Current, NewRate(0, 1)) {
		t.Fatalf("filtered headline %+v", got.Headline)
	}
}

// The snapshot's load instant is the "now" of every now-dependent rule, also
// on cache hits after the clock moved.
func TestService_AsOfIsTheSnapshotNow(t *testing.T) {
	pending := vacancy("A", "2026-01-05T16:00:00Z").withDelivery("2026-03-20", 1, nil)
	store := &periodStore{data: map[string]*Dataset{"2026-01-01..2026-03-31": {Vacancies: []*Vacancy{pending}, People: map[uuid.UUID]Person{}}}}
	now := at("2026-03-20T23:00:00Z") // Mar 20, 17:00 in Mexico City: still pending
	s := NewService(store, weekdays, func() time.Time { return now })
	company := uuid.New()
	first, err := s.Closures(context.Background(), company, q1)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(30 * time.Second) // Mar 21 locally would be overdue; the snapshot still says Mar 20
	second, _ := s.Closures(context.Background(), company, q1)
	if first.DeliveryStatus.Pending != 1 || second.DeliveryStatus.Pending != 1 || !second.AsOf.Equal(first.AsOf) {
		t.Fatalf("first %+v second %+v", first.DeliveryStatus, second.DeliveryStatus)
	}
	if store.loads != 1 {
		t.Fatalf("loads %d", store.loads)
	}
}

func TestClosures_ClosedAddsUpByLastReason(t *testing.T) {
	a := vacancy("A", "2026-01-05T16:00:00Z").
		withClose("2026-02-02T18:00:00Z", ptr("filled"), nil).
		withClose("2026-02-10T18:00:00Z", ptr("other"), nil)
	b := vacancy("B", "2026-01-05T16:00:00Z").withClose("2026-02-03T18:00:00Z", ptr("filled"), nil)
	c := vacancy("C", "2026-01-05T16:00:00Z").withDelivery("2026-01-30", 1, ptr("2026-01-29T18:00:00Z"))
	store := &periodStore{data: map[string]*Dataset{"2026-01-01..2026-03-31": {Vacancies: []*Vacancy{a, b, c}, People: map[uuid.UUID]Person{}}}}
	got, err := newTestService(store, at("2026-04-01T18:00:00Z")).Closures(context.Background(), uuid.New(), q1)
	if err != nil {
		t.Fatal(err)
	}
	want := []ClosuresMonth{
		{Month: "2026-01"},
		{Month: "2026-02", Closed: 2, ClosedCounts: ClosedCounts{Filled: 1, Other: 1}},
		{Month: "2026-03"},
	}
	for i, m := range want {
		if got.ClosedByMonth[i] != m {
			t.Fatalf("month %d: %+v, want %+v", i, got.ClosedByMonth[i], m)
		}
	}
	if got.DeliveryStatus != (DeliveryStatus{OnTime: 1}) {
		t.Fatalf("delivery status %+v", got.DeliveryStatus)
	}
}

func TestCompliance_LateBuckets(t *testing.T) {
	// Commitment Fri 2026-01-09; late by 0 (Sat 10), 2 (Tue 13), 3 (Wed 14),
	// 5 (Fri 16), 6 (Mon 19) business days.
	var vs []*Vacancy
	for _, reached := range []string{"2026-01-10T18:00:00Z", "2026-01-13T18:00:00Z", "2026-01-14T18:00:00Z", "2026-01-16T18:00:00Z", "2026-01-19T18:00:00Z"} {
		vs = append(vs, vacancy("L", "2026-01-05T16:00:00Z").withDelivery("2026-01-09", 1, ptr(reached)))
	}
	vs = append(vs, vacancy("On", "2026-01-05T16:00:00Z").withDelivery("2026-02-09", 1, ptr("2026-02-02T18:00:00Z")))
	store := &periodStore{data: map[string]*Dataset{"2026-01-01..2026-03-31": {Vacancies: vs, People: map[uuid.UUID]Person{}}}}
	got, err := newTestService(store, at("2026-04-01T18:00:00Z")).Compliance(context.Background(), uuid.New(), q1)
	if err != nil {
		t.Fatal(err)
	}
	if got.LateBuckets != (LateBuckets{UpTo2: 2, From3To5: 2, Over5: 1}) {
		t.Fatalf("buckets %+v", got.LateBuckets)
	}
	if len(got.OnTimeByMonth) != 3 || !sameRate(got.OnTimeByMonth[0].Rate, NewRate(0, 5)) || !sameRate(got.OnTimeByMonth[1].Rate, NewRate(1, 1)) {
		t.Fatalf("on_time_by_month %+v", got.OnTimeByMonth)
	}
}

func TestDelays_OverdueTopClosingTargetAndReasons(t *testing.T) {
	var vs []*Vacancy
	// as_of Wed 2026-03-25 (Mexico City). Overdue business days from the
	// commitment date: Mar 2 → 17, Mar 10 → 11, Mar 10 → 11 (title tie),
	// Mar 18 → 5, Mar 23 → 2.
	for _, o := range []struct{ title, commitment string }{{"Zeta", "2026-03-10"}, {"Eme", "2026-03-23"}, {"Alfa", "2026-03-10"}, {"Beta", "2026-03-02"}, {"Ce", "2026-03-18"}} {
		v := vacancy(o.title, "2026-01-05T16:00:00Z").withDelivery(o.commitment, 3, nil)
		v.Entries = []Entry{{ParticipationID: uuid.New(), At: at("2026-02-02T18:00:00Z")}}
		vs = append(vs, v)
	}
	// Pending (not overdue) and an on-time delivery stay out of overdue.
	vs = append(vs, vacancy("Pend", "2026-01-05T16:00:00Z").withDelivery("2026-03-31", 1, nil))
	closed := vacancy("Cerrada", "2026-01-05T16:00:00Z").withClose("2026-02-02T18:00:00Z", ptr("filled"), ptr("2026-02-10"))
	closed.Reassigns = []Reassignment{
		{ID: uuid.New(), At: at("2026-01-20T18:00:00Z"), Reason: "performance"},
		{ID: uuid.New(), At: at("2026-02-20T18:00:00Z"), Reason: "client_request"},
		{ID: uuid.New(), At: at("2025-12-20T18:00:00Z"), Reason: "workload"}, // outside the period
	}
	vs = append(vs, closed, vacancy("Sin meta", "2026-01-05T16:00:00Z").withClose("2026-03-02T18:00:00Z", ptr("filled"), nil))
	store := &periodStore{data: map[string]*Dataset{"2026-01-01..2026-03-31": {Vacancies: vs, People: map[uuid.UUID]Person{}}}}
	got, err := newTestService(store, at("2026-03-25T18:00:00Z")).Delays(context.Background(), uuid.New(), q1)
	if err != nil {
		t.Fatal(err)
	}
	if got.ClosingTarget != (ClosingTarget{OnTime: 1, NoTarget: 1}) {
		t.Fatalf("closing target %+v", got.ClosingTarget)
	}
	if got.Overdue.Total != 5 || len(got.Overdue.Top) != 4 {
		t.Fatalf("overdue %+v", got.Overdue)
	}
	for i, w := range []struct {
		title string
		days  int
	}{{"Beta", 17}, {"Alfa", 11}, {"Zeta", 11}, {"Ce", 5}} {
		row := got.Overdue.Top[i]
		if row.Vacancy.Title != w.title || row.BusinessDaysOverdue != w.days || row.Delivered != 1 || row.Target != 3 {
			t.Fatalf("top[%d] %+v, want %s %d", i, row, w.title, w.days)
		}
	}
	if got.ReassignmentsByReason != (ByReason{Performance: 1, ClientRequest: 1}) {
		t.Fatalf("by reason %+v", got.ReassignmentsByReason)
	}
}

func TestOrigin_ByChannel(t *testing.T) {
	a := vacancy("A", "2026-01-05T16:00:00Z")
	a.Origin = map[string]int{"portal": 2, "manual": 1}
	b := vacancy("B", "2026-01-05T16:00:00Z")
	b.Origin = map[string]int{"careers_site": 3, "unknown": 4, "portal": 1}
	store := &periodStore{data: map[string]*Dataset{"2026-01-01..2026-03-31": {Vacancies: []*Vacancy{a, b}, People: map[uuid.UUID]Person{}}}}
	got, err := newTestService(store, at("2026-04-01T18:00:00Z")).Origin(context.Background(), uuid.New(), q1)
	if err != nil {
		t.Fatal(err)
	}
	if got.ByChannel != (Origin{Portal: 3, CareersSite: 3, Manual: 1, Unknown: 4}) {
		t.Fatalf("by channel %+v", got.ByChannel)
	}
}

// The recruiter and requester filters run in Go over the snapshot with the
// loader's SQL semantics (M6), so every filtered variant reuses one load.
func TestService_FiltersRunOverOneSnapshot(t *testing.T) {
	ana := uuid.New()
	acme := uuid.New()
	named := vacancy("Acme", "2026-01-05T16:00:00Z").withTramo(ana, "2026-01-05T16:00:00Z")
	named.Requester = &Requester{Kind: "client", ID: &acme}
	unnamed := vacancy("Cliente", "2026-01-05T16:00:00Z").withTramo(uuid.New(), "2026-01-05T16:00:00Z")
	unnamed.Requester = &Requester{Kind: "client"}
	area := vacancy("Area", "2026-01-05T16:00:00Z").withTramo(uuid.New(), "2026-01-05T16:00:00Z")
	area.Requester = &Requester{Kind: "internal_area", ID: ptr(uuid.New())}
	none := vacancy("Nada", "2026-01-05T16:00:00Z").withTramo(uuid.New(), "2026-01-05T16:00:00Z")
	// Ana's tramo ended before the period: not hers for the filter.
	before := vacancy("Antes", "2025-10-05T16:00:00Z")
	before.Tramos = []Tramo{{UserID: ana, Start: at("2025-10-05T16:00:00Z"), End: ptr(at("2025-12-01T16:00:00Z"))}}
	before.Credits = []Credit{{ID: uuid.New(), HiredAt: at("2026-01-10T18:00:00Z"), Status: "active"}}
	store := &periodStore{data: map[string]*Dataset{"2026-01-01..2026-03-31": {Vacancies: []*Vacancy{named, unnamed, area, none, before}, People: map[uuid.UUID]Person{}}}}
	s := newTestService(store, at("2026-04-01T18:00:00Z"))
	company := uuid.New()
	for query, want := range map[string]int{
		"":                              4,
		"&recruiter_id=" + ana.String(): 1,
		"&requester_id=none":            1,
		"&requester_kind=client":        2,
		"&requester_kind=client&requester_id=none":             1,
		"&requester_kind=client&requester_id=" + acme.String(): 1,
		"&requester_kind=internal_area":                        1,
	} {
		got, err := s.Summary(context.Background(), company, q1+query)
		if err != nil {
			t.Fatal(err)
		}
		if got.Vacancies.Assigned != want {
			t.Errorf("%q: assigned %d, want %d", query, got.Vacancies.Assigned, want)
		}
	}
	// The recruiter filter keeps only vacancies with her tramo in the period.
	got, _ := s.Summary(context.Background(), company, q1+"&recruiter_id="+ana.String())
	if got.Placements.Credits != 0 {
		t.Fatalf("recruiter filter kept a vacancy without her tramo in the period")
	}
	// One load for the period plus one for its previous period.
	if store.loads != 2 {
		t.Fatalf("loads %d, want 2", store.loads)
	}
}

func TestParseQuery_SectionRoutesTakeNoListParams(t *testing.T) {
	for _, route := range []Route{RouteClosures, RouteCompliance, RouteDelays, RouteOrigin} {
		if _, err := ParseQuery(q1+"&recruiter_id="+uuid.NewString(), route); err != nil {
			t.Fatalf("%s: %v", route, err)
		}
		fields := fieldsOf(t, func() error { _, err := ParseQuery(q1+"&limit=10&outcome=open", route); return err }())
		if len(fields) != 2 || fields[0] != (Field{"limit", "unknown"}) || fields[1] != (Field{"outcome", "unknown"}) {
			t.Fatalf("%s: %+v", route, fields)
		}
	}
}
