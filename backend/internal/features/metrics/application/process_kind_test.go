package application

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// The process_kind filter and the vacancy-level vs process-level split of
// replacement-processes-v1 §«Metrics» (R6a): one logical vacancy, an original
// and one replacement, read through the service.

// chainFixture is one company with the original «Original» (closed filled in
// Q1, assigned to ana) and its replacement «Reemplazo» (started Feb 10,
// assigned to beto, still open), at as_of 2026-04-01.
type chainFixture struct {
	company, actor, ana, beto, lucia uuid.UUID
	root, repl                       *Vacancy
	openRoot, openRepl               *OpenVacancy
	store                            *pipelineStore
	svc                              *Service
}

func newChainFixture() *chainFixture {
	fx := &chainFixture{company: uuid.New(), actor: uuid.New(), ana: uuid.New(), beto: uuid.New(), lucia: uuid.New()}
	// The original: on-time delivery, two hires (one did not hold), filled close.
	fx.root = vacancy("Original", "2026-01-05T16:00:00Z").withTramo(fx.ana, "2026-01-05T16:00:00Z").
		withDelivery("2026-01-15", 1, ptr("2026-01-12T18:00:00Z")).withEntries(1).
		withClose("2026-01-20T18:00:00Z", ptr("filled"), ptr("2026-01-31"))
	fx.root.Headcount = ptr(2)
	fx.root.Origin = map[string]int{"portal": 2}
	fx.root.Credits = []Credit{
		{ID: uuid.New(), HiredAt: at("2026-01-18T18:00:00Z"), Status: "did_not_hold", Candidate: Candidate{ID: uuid.New(), FullName: "Mario"}, Recipients: []Recipient{{UserID: fx.ana, Kind: "direct"}}},
		{ID: uuid.New(), HiredAt: at("2026-01-19T18:00:00Z"), Status: "active", Candidate: Candidate{ID: uuid.New(), FullName: "Lucía"}, Recipients: []Recipient{{UserID: fx.ana, Kind: "direct"}}},
	}
	// The replacement: its own team, delivery (overdue), hire, origin and handover.
	fx.repl = vacancy("Reemplazo", "2026-02-10T16:00:00Z").withTramo(fx.beto, "2026-02-10T16:00:00Z").
		withDelivery("2026-02-20", 1, nil).withEntries(1)
	fx.repl.Kind, fx.repl.RootID, fx.repl.Sequence, fx.repl.ProcessActive = KindReplacement, fx.root.ID, ptr(1), true
	fx.repl.Headcount = ptr(1)
	fx.repl.Origin = map[string]int{"manual": 1}
	fx.repl.Credits = []Credit{{ID: uuid.New(), HiredAt: at("2026-03-01T18:00:00Z"), Status: "active", Candidate: Candidate{ID: uuid.New(), FullName: "Nora"}, Recipients: []Recipient{{UserID: fx.beto, Kind: "direct"}}}}
	fx.repl.Reassigns = []Reassignment{{ID: uuid.New(), At: at("2026-03-05T18:00:00Z"), Reason: "workload", From: fx.ana, To: fx.beto, By: fx.ana, FromStarted: at("2026-02-10T16:00:00Z"), Snapshot: []byte(`{}`)}}

	pl := stagedPipeline(nil)
	fx.openRoot = openVacancy("Original", pl)
	fx.openRoot.ID = fx.root.ID
	fx.openRoot.Tramos = fx.root.Tramos
	fx.openRepl = openVacancy("Reemplazo", pl)
	fx.openRepl.ID, fx.openRepl.Kind, fx.openRepl.RootID, fx.openRepl.Sequence = fx.repl.ID, KindReplacement, fx.root.ID, ptr(1)
	fx.openRepl.Tramos = fx.repl.Tramos
	fx.openRepl.with("Pía", "NEW", "2026-03-30T18:00:00Z")
	fx.openRepl.with("Quique", "IN_PROCESS", "2026-03-20T18:00:00Z")
	fx.openRoot.with("Rosa", "SCREENING", "2026-03-27T18:00:00Z")

	fx.store = &pipelineStore{listStore: &listStore{data: &Dataset{Vacancies: []*Vacancy{fx.root, fx.repl}, People: map[uuid.UUID]Person{
		fx.ana: {UserID: fx.ana, Name: ptr("Ana")}, fx.beto: {UserID: fx.beto, Name: ptr("Beto")},
	}}}, pipeline: &PipelineData{Vacancies: []*OpenVacancy{fx.openRoot, fx.openRepl}, People: map[uuid.UUID]Person{}}}
	fx.svc = newTestService(chainStore{fx.store}, at("2026-04-01T18:00:00Z"))
	return fx
}

// chainStore answers the recruiter detail's tramo lookup.
type chainStore struct{ *pipelineStore }

func (chainStore) HadTramo(context.Context, uuid.UUID, uuid.UUID) (bool, error) { return true, nil }

var allKinds = []string{"", "&process_kind=original", "&process_kind=replacement"}

func TestProcessKind_ParserAcceptsOneValueOnEveryMetricsRoute(t *testing.T) {
	routes := []Route{RouteSummary, RouteRecruiters, RouteRecruiter, RouteVacancies, RouteReassignments, RouteDetail, RouteClosures, RouteCompliance,
		RouteDelays, RouteOrigin, RouteDeliveries, RoutePlacements, RoutePipeline, RouteCandidates, RouteApplications}
	for _, route := range routes {
		for _, kind := range []string{KindOriginal, KindReplacement} {
			q, err := ParseQuery(q1+"&process_kind="+kind, route)
			if err != nil || q.ProcessKind != kind {
				t.Errorf("%s %s: %v %q", route, kind, err, q.ProcessKind)
			}
			if route.sortable() {
				if q, err := ParseExportQuery(q1+"&process_kind="+kind, route); err != nil || q.ProcessKind != kind {
					t.Errorf("export %s %s: %v %q", route, kind, err, q.ProcessKind)
				}
			}
		}
		if q, err := ParseQuery(q1, route); err != nil || q.ProcessKind != "" {
			t.Errorf("%s without the filter: %v %q", route, err, q.ProcessKind)
		}
	}
}

func TestProcessKind_ParserRejectsInvalidAndRepeated(t *testing.T) {
	for query, code := range map[string]string{
		"&process_kind=other":                             "invalid",
		"&process_kind=":                                  "invalid",
		"&process_kind=Original":                          "invalid",
		"&process_kind=original,replacement":              "invalid",
		"&process_kind=original&process_kind=replacement": "duplicate",
		"&process_kind=original&process_kind=original":    "duplicate",
	} {
		_, err := ParseQuery(q1+query, RouteDeliveries)
		var bad *InvalidFilter
		if !errors.As(err, &bad) || !reflect.DeepEqual(bad.Fields, []Field{{"process_kind", code}}) {
			t.Errorf("%q: %v", query, err)
		}
	}
}

func TestProcessKind_DashboardHasNoSuchFilterInV1(t *testing.T) {
	_, err := ParseWindow("window=7&process_kind=original")
	var bad *InvalidFilter
	if !errors.As(err, &bad) || !reflect.DeepEqual(bad.Fields, []Field{{"process_kind", "unknown"}}) {
		t.Fatalf("%v", err)
	}
	if _, err := parseDashboardList("process_kind=original", RouteDashboardVacancies, false); err == nil {
		t.Fatal("a dashboard list accepted process_kind")
	}
}

// The vacancy-level figures ignore process_kind; the process-level ones belong
// to each process and honor it (D9, the normative table).
func TestProcessKind_SummarySplitsVacancyLevelFromProcessLevel(t *testing.T) {
	fx := newChainFixture()
	type figures struct {
		assigned, closedFilled, positions, required int
		median                                      *float64
		closingTarget                               ClosingTarget
		byRequester                                 []RequesterGroup
		closedByMonth                               []ClosedMonth
		headlineAssigned                            Delta[int]
		headlineMedian                              Delta[*float64]
	}
	vacancyLevel := func(s *Summary) figures {
		return figures{s.Vacancies.Assigned, s.Vacancies.Closed.Filled, s.Placements.PositionsCovered, s.Placements.PositionsRequired,
			s.Vacancies.MedianBusinessDaysToClose, s.Vacancies.ClosingTarget, s.ByRequester, s.ClosedByMonth, s.Headline.Assigned, s.Headline.MedianBusinessDaysToClose}
	}
	var base figures
	for i, kind := range allKinds {
		got, err := fx.svc.Summary(context.Background(), fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		// Original: assigned once (not twice), filled once, covered 1 of 2 positions.
		if i == 0 {
			base = vacancyLevel(got)
			if base.assigned != 1 || base.closedFilled != 1 || base.positions != 1 || base.required != 2 || base.median == nil || *base.median != 11 ||
				base.closingTarget != (ClosingTarget{OnTime: 1}) || len(base.byRequester) != 1 || base.byRequester[0].Vacancies != 1 || base.byRequester[0].Filled != 1 ||
				base.headlineAssigned.Current != 1 {
				t.Fatalf("vacancy-level %+v", base)
			}
		}
		if !reflect.DeepEqual(vacancyLevel(got), base) {
			t.Errorf("%q: vacancy-level figures moved with process_kind: %+v, want %+v", kind, vacancyLevel(got), base)
		}
		var d SummaryDelivery
		var pl SummaryPlacement
		var o Origin
		var r SummaryReassigns
		switch kind {
		case "":
			d, pl, o, r = SummaryDelivery{OnTime: 1, Overdue: 1, Configured: 2, Total: 2, Delivered: 2}, SummaryPlacement{Credits: 3, DidNotHold: 1}, Origin{Portal: 2, Manual: 1}, SummaryReassigns{Total: 1, ByReason: ByReason{Workload: 1}}
		case "&process_kind=original":
			d, pl, o, r = SummaryDelivery{OnTime: 1, Configured: 1, Total: 1, Delivered: 1}, SummaryPlacement{Credits: 2, DidNotHold: 1}, Origin{Portal: 2}, SummaryReassigns{}
		default:
			d, pl, o, r = SummaryDelivery{Overdue: 1, Configured: 1, Total: 1, Delivered: 1}, SummaryPlacement{Credits: 1}, Origin{Manual: 1}, SummaryReassigns{Total: 1, ByReason: ByReason{Workload: 1}}
		}
		// Rates and medians are derived: compare the counts.
		gd := got.Delivery
		gd.OnTimeRate, gd.ConfiguredRate, gd.MedianBusinessDaysToTarget = Rate{}, Rate{}, nil
		gp := got.Placements
		gp.PositionsCovered, gp.PositionsRequired = 0, 0
		if gd != d || gp != pl || got.Origin != o || got.Reassignments != r {
			t.Errorf("%q: delivery %+v placements %+v origin %+v reassignments %+v", kind, gd, gp, got.Origin, got.Reassignments)
		}
		if got.Headline.Placements.Current != pl.Credits || got.Headline.Reassignments.Current != r.Total {
			t.Errorf("%q: headline %+v", kind, got.Headline)
		}
	}
}

// A recruiter who only worked the replacement still has the logical vacancy
// assigned (A5), once; the process-level figures stay with the process.
func TestProcessKind_AssignedCountsTheRootForAReplacementOnlyRecruiter(t *testing.T) {
	fx := newChainFixture()
	got, err := fx.svc.Summary(context.Background(), fx.company, q1+"&recruiter_id="+fx.beto.String())
	if err != nil {
		t.Fatal(err)
	}
	// Beto has a tramo on the replacement only: the original counts once, with its own close.
	if got.Vacancies.Assigned != 1 || got.Vacancies.Closed.Filled != 1 {
		t.Fatalf("vacancies %+v", got.Vacancies)
	}
	// His delivery figures are the replacement's: the original's on-time is not his.
	if d := got.Delivery; d.Total != 1 || d.Overdue != 1 || d.OnTime != 0 {
		t.Fatalf("delivery %+v", d)
	}
	if got, err = fx.svc.Summary(context.Background(), fx.company, q1+"&recruiter_id="+fx.ana.String()+"&process_kind=replacement"); err != nil {
		t.Fatal(err)
	}
	// Ana worked the original only; the replacement filter leaves her no process.
	if got.Vacancies.Assigned != 1 || got.Delivery.Total != 0 {
		t.Fatalf("ana: %+v %+v", got.Vacancies, got.Delivery)
	}
}

func TestProcessKind_SectionsSplitTheSameWay(t *testing.T) {
	fx := newChainFixture()
	for i, kind := range allKinds {
		closures, err := fx.svc.Closures(context.Background(), fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		if jan := closures.ClosedByMonth[0]; jan.Closed != 1 || jan.Filled != 1 {
			t.Errorf("%q: closed_by_month %+v", kind, jan)
		}
		want := [3]DeliveryStatus{{OnTime: 1, Overdue: 1}, {OnTime: 1}, {Overdue: 1}}[i]
		if closures.DeliveryStatus != want {
			t.Errorf("%q: delivery_status %+v, want %+v", kind, closures.DeliveryStatus, want)
		}
		delays, err := fx.svc.Delays(context.Background(), fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		if delays.ClosingTarget != (ClosingTarget{OnTime: 1}) {
			t.Errorf("%q: closing_target %+v", kind, delays.ClosingTarget)
		}
		wantOverdue, wantReassign := [3]int{1, 0, 1}[i], [3]int{1, 0, 1}[i]
		if delays.Overdue.Total != wantOverdue || len(delays.Overdue.Top) != wantOverdue || delays.ReassignmentsByReason.Workload != wantReassign {
			t.Errorf("%q: overdue %d reassignments %+v", kind, delays.Overdue.Total, delays.ReassignmentsByReason)
		}
		origin, err := fx.svc.Origin(context.Background(), fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		if want := [3]Origin{{Portal: 2, Manual: 1}, {Portal: 2}, {Manual: 1}}[i]; origin.ByChannel != want {
			t.Errorf("%q: origin %+v", kind, origin.ByChannel)
		}
		compliance, err := fx.svc.Compliance(context.Background(), fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		// on_time_by_month counts the deliveries judged by their commitment month: Jan (original), Feb (replacement).
		jan, feb := compliance.OnTimeByMonth[0], compliance.OnTimeByMonth[1]
		wantJan, wantFeb := [3]int{1, 1, 0}[i], [3]int{1, 0, 1}[i]
		if jan.Rate.Denominator != wantJan || feb.Rate.Denominator != wantFeb {
			t.Errorf("%q: on_time_by_month %+v %+v", kind, jan, feb)
		}
	}
}

// Every list total equals its figure under every process_kind (the v2 rule).
func TestProcessKind_ListTotalsEqualTheirFigures(t *testing.T) {
	fx := newChainFixture()
	ctx := context.Background()
	for _, kind := range allKinds {
		sum, err := fx.svc.Summary(ctx, fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		deliveries, err := fx.svc.ListDeliveries(ctx, fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		if deliveries.Total != sum.Delivery.Total {
			t.Errorf("%q: deliveries total %d, figure %d", kind, deliveries.Total, sum.Delivery.Total)
		}
		placements, err := fx.svc.ListPlacements(ctx, fx.company, fx.actor, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		if placements.Total != sum.Placements.Credits {
			t.Errorf("%q: placements total %d, figure %d", kind, placements.Total, sum.Placements.Credits)
		}
		reassignments, err := fx.svc.Reassignments(ctx, fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		if reassignments.Total != sum.Reassignments.Total {
			t.Errorf("%q: reassignments total %d, figure %d", kind, reassignments.Total, sum.Reassignments.Total)
		}
		applications, err := fx.svc.ListApplications(ctx, fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		if origin := sum.Origin; applications.Total != origin.Portal+origin.CareersSite+origin.Manual+origin.Unknown {
			t.Errorf("%q: applications total %d, origin %+v", kind, applications.Total, origin)
		}
		// The vacancies list is vacancy-level: the original, whatever the filter.
		vacancies, err := fx.svc.Vacancies(ctx, fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		closed := sum.Vacancies.Closed
		if vacancies.Total != 1 || vacancies.Items[0].DraftID != fx.root.ID || vacancies.Facets.CloseReason != closed {
			t.Errorf("%q: vacancies total %d facet %+v, closed %+v", kind, vacancies.Total, vacancies.Facets, closed)
		}
		if vacancies.Total != sum.Vacancies.Assigned {
			t.Errorf("%q: vacancies total %d, assigned %d", kind, vacancies.Total, sum.Vacancies.Assigned)
		}
	}
}

func TestProcessKind_ListsFilterAndFacetEveryKind(t *testing.T) {
	fx := newChainFixture()
	ctx := context.Background()
	both := &ProcessKindFacet{Original: 1, Replacement: 1}
	for i, kind := range allKinds {
		got, err := fx.svc.ListDeliveries(ctx, fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		titles := [3][]string{{"Original", "Reemplazo"}, {"Original"}, {"Reemplazo"}}[i]
		if !slices.Equal(sortedTitles(got.Items), titles) {
			t.Errorf("%q: deliveries %v", kind, sortedTitles(got.Items))
		}
		// The process_kind facet ignores only process_kind; the result facet honors it.
		if !reflect.DeepEqual(got.Facets.ProcessKind, both) {
			t.Errorf("%q: deliveries process_kind facet %+v", kind, got.Facets.ProcessKind)
		}
		if want := [3]DeliveryStatus{{OnTime: 1, Overdue: 1}, {OnTime: 1}, {Overdue: 1}}[i]; got.Facets.Result != want {
			t.Errorf("%q: result facet %+v", kind, got.Facets.Result)
		}
		if kind != "" && got.AppliedFilters["process_kind"] != kind[len("&process_kind="):] {
			t.Errorf("%q: applied_filters %v", kind, got.AppliedFilters)
		}
	}
	// With another filter in play the facet counts the rows that pass it.
	got, err := fx.svc.ListDeliveries(ctx, fx.company, q1+"&result=overdue&process_kind=original")
	if err != nil {
		t.Fatal(err)
	}
	if got.Total != 0 || !reflect.DeepEqual(got.Facets.ProcessKind, &ProcessKindFacet{Replacement: 1}) || got.Facets.Result != (DeliveryStatus{OnTime: 1}) {
		t.Errorf("result=overdue original: %d %+v %+v", got.Total, got.Facets.ProcessKind, got.Facets.Result)
	}
	placements, err := fx.svc.ListPlacements(ctx, fx.company, fx.actor, q1+"&process_kind=replacement")
	if err != nil {
		t.Fatal(err)
	}
	if placements.Total != 1 || placements.Items[0].Candidate.FullName != "Nora" || !reflect.DeepEqual(placements.Facets.ProcessKind, &ProcessKindFacet{Original: 2, Replacement: 1}) ||
		placements.Facets.Held != (HeldFacet{True: 1}) {
		t.Errorf("placements %d %+v", placements.Total, placements.Facets)
	}
	reassignments, err := fx.svc.Reassignments(ctx, fx.company, q1+"&process_kind=original")
	if err != nil {
		t.Fatal(err)
	}
	if reassignments.Total != 0 || !reflect.DeepEqual(reassignments.Facets.ProcessKind, &ProcessKindFacet{Replacement: 1}) || reassignments.Facets.Reason != (ByReason{}) {
		t.Errorf("reassignments %d %+v", reassignments.Total, reassignments.Facets)
	}
	applications, err := fx.svc.ListApplications(ctx, fx.company, q1+"&process_kind=replacement")
	if err != nil {
		t.Fatal(err)
	}
	if applications.Total != 1 || len(applications.Items) != 1 || applications.Items[0].Vacancy.DraftID != fx.repl.ID ||
		!reflect.DeepEqual(applications.Facets.ProcessKind, &ProcessKindFacet{Original: 2, Replacement: 1}) || applications.Facets.Channel != (Origin{Manual: 1}) {
		t.Errorf("applications %d %+v", applications.Total, applications.Facets)
	}
}

func sortedTitles(rows []DeliveryListRow) []string {
	out := []string{}
	for _, r := range rows {
		out = append(out, r.Vacancy.Title)
	}
	slices.Sort(out)
	return out
}

func TestProcessKind_CandidatesAndPipelineAreProcessLevel(t *testing.T) {
	fx := newChainFixture()
	ctx := context.Background()
	for i, kind := range allKinds {
		section, err := fx.svc.Pipeline(ctx, fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		candidates := 0
		for _, s := range section.Stages {
			candidates += s.Candidates
		}
		if want := [3]int{3, 1, 2}[i]; candidates != want {
			t.Errorf("%q: pipeline candidates %d, want %d", kind, candidates, want)
		}
		list, err := fx.svc.ListCandidates(ctx, fx.company, fx.actor, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		if list.Total != candidates {
			t.Errorf("%q: candidates total %d, pipeline figure %d", kind, list.Total, candidates)
		}
		if !reflect.DeepEqual(list.Facets.ProcessKind, &ProcessKindFacet{Original: 1, Replacement: 2}) {
			t.Errorf("%q: candidates process_kind facet %+v", kind, list.Facets.ProcessKind)
		}
	}
	// A stage filter narrows the process_kind facet but not its own count.
	list, err := fx.svc.ListCandidates(ctx, fx.company, fx.actor, q1+"&stage_kind=new&process_kind=original")
	if err != nil {
		t.Fatal(err)
	}
	if list.Total != 0 || !reflect.DeepEqual(list.Facets.ProcessKind, &ProcessKindFacet{Replacement: 1}) {
		t.Errorf("stage_kind=new original: %d %+v", list.Total, list.Facets.ProcessKind)
	}
}

func TestProcessKind_RecruiterCardsSplitAssignedFromProcessFigures(t *testing.T) {
	fx := newChainFixture()
	ctx := context.Background()
	for i, kind := range allKinds {
		got, err := fx.svc.Recruiters(ctx, fx.company, q1+kind)
		if err != nil {
			t.Fatal(err)
		}
		cards := map[uuid.UUID]Card{}
		for _, c := range got.Items {
			cards[c.UserID] = c
		}
		// Listed people are the ones with a tramo on a selected process.
		wantPeople := [3]int{2, 1, 1}[i]
		if len(cards) != wantPeople {
			t.Fatalf("%q: %d cards", kind, len(cards))
		}
		if ana, ok := cards[fx.ana]; ok {
			// Ana: assigned to the logical vacancy once; her conversion is the original's.
			if ana.Vacancies.Assigned != 1 || ana.Placements.ClosedAssigned != 1 || ana.Placements.Conversion.Numerator != 1 {
				t.Errorf("%q: ana vacancies %+v placements %+v", kind, ana.Vacancies, ana.Placements)
			}
			// Her recipient credits and the reassignment she lost are the processes'.
			wantDirect, wantLost := [3]int{2, 2, 0}[i], [3]int{1, 0, 1}[i]
			if ana.Placements.Direct != wantDirect || ana.Reassignments.Lost != wantLost {
				t.Errorf("%q: ana direct %d lost %d", kind, ana.Placements.Direct, ana.Reassignments.Lost)
			}
		}
		if beto, ok := cards[fx.beto]; ok {
			// Beto only worked the replacement: the logical vacancy is assigned to him all the same.
			if beto.Vacancies.Assigned != 1 || beto.Placements.ClosedAssigned != 1 || beto.Placements.Direct != 1 || beto.Reassignments.Received != 1 || beto.Delivery.Overdue != 1 {
				t.Errorf("%q: beto %+v %+v %+v %+v", kind, beto.Vacancies, beto.Placements, beto.Reassignments, beto.Delivery)
			}
		}
	}
	detail, err := fx.svc.Recruiter(ctx, fx.company, fx.beto, q1+"&process_kind=original")
	if err != nil {
		t.Fatal(err)
	}
	// Under «originales» Beto keeps the vacancy-level assigned and loses the process-level figures.
	if detail.Vacancies.Assigned != 1 || detail.Placements.Direct != 0 || detail.Reassignments.Received != 0 || detail.Delivery.Overdue != 0 {
		t.Errorf("beto original: %+v %+v %+v", detail.Vacancies, detail.Placements, detail.Reassignments)
	}
	if feb := detail.ByMonth[1]; feb.Assigned != 1 {
		t.Errorf("by_month assigned %+v", feb)
	}
}

func TestProcessKind_DetailsReadOneProcessAndFilterByKind(t *testing.T) {
	fx := newChainFixture()
	rows := []DeliveryRow{{Candidate: Candidate{FullName: "x"}}}
	store := &detailStore{Store: fx.store, refs: map[uuid.UUID]ProcessRef{
		fx.root.ID: {Kind: KindOriginal, RootDraftID: fx.root.ID},
		fx.repl.ID: {Kind: KindReplacement, RootDraftID: fx.root.ID, Sequence: ptr(1)},
	}, rows: rows}
	svc := newTestService(store, at("2026-04-01T18:00:00Z"))
	got, err := svc.Deliveries(context.Background(), fx.company, fx.actor, fx.repl.ID, q1+"&process_kind=replacement")
	if err != nil || len(got.Items) != 1 || store.kinds[0] != KindReplacement {
		t.Fatalf("%v %+v kinds %v", err, got, store.kinds)
	}
	if _, err := svc.Placements(context.Background(), fx.company, fx.actor, fx.repl.ID, q1+"&process_kind=bad"); err == nil {
		t.Fatal("an invalid process_kind was accepted by a detail")
	}
}

// detailStore answers the per-process detail reads and records the kind filter.
type detailStore struct {
	Store
	refs  map[uuid.UUID]ProcessRef
	rows  []DeliveryRow
	kinds []string
}

func (s *detailStore) Deliveries(_ context.Context, _, _, draft uuid.UUID, kind string) ([]DeliveryRow, ProcessRef, error) {
	s.kinds = append(s.kinds, kind)
	ref := s.refs[draft]
	if kind != "" && kind != ref.Kind {
		return []DeliveryRow{}, ref, nil
	}
	return s.rows, ref, nil
}

func (s *detailStore) Placements(_ context.Context, _, _, draft uuid.UUID, kind string) ([]PlacementRow, ProcessRef, error) {
	return []PlacementRow{}, s.refs[draft], nil
}

// A cursor is bound to the process_kind it was issued for.
func TestProcessKind_CursorIsBoundToTheFilter(t *testing.T) {
	fx := newChainFixture()
	ctx := context.Background()
	first, err := fx.svc.ListDeliveries(ctx, fx.company, q1+"&limit=1")
	if err != nil || first.NextCursor == nil {
		t.Fatalf("%v %+v", err, first)
	}
	for _, kind := range []string{"&process_kind=original", "&process_kind=replacement"} {
		if _, err := fx.svc.ListDeliveries(ctx, fx.company, q1+"&limit=1"+kind+"&cursor="+*first.NextCursor); !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("%s: cursor of the unfiltered list: %v", kind, err)
		}
	}
	if _, err := fx.svc.ListDeliveries(ctx, fx.company, q1+"&limit=1&cursor="+*first.NextCursor); err != nil {
		t.Fatalf("same filters: %v", err)
	}
	// And the other way: a cursor of the filtered list does not continue the unfiltered one.
	filtered, err := fx.svc.ListDeliveries(ctx, fx.company, q1+"&limit=1&process_kind=original&sort=title")
	if err != nil {
		t.Fatal(err)
	}
	if filtered.NextCursor != nil {
		t.Fatalf("one original row, no next page: %+v", filtered)
	}
}

// Linking a snapshot is what the vacancy-level rules and the replacements key read.
func TestDataset_LinkJoinsEachRootWithItsChain(t *testing.T) {
	fx := newChainFixture()
	second := vacancy("Segundo", "2026-03-01T16:00:00Z").withTramo(fx.lucia, "2026-03-01T16:00:00Z")
	second.Kind, second.RootID, second.Sequence = KindReplacement, fx.root.ID, ptr(2)
	data := &Dataset{Vacancies: []*Vacancy{fx.root, fx.repl, second}}
	data.link()
	data.link() // idempotent
	if r := fx.root.Replacements; r.Count != 2 || r.ActiveDraftID == nil || *r.ActiveDraftID != fx.repl.ID {
		t.Fatalf("replacements %+v", r)
	}
	users := []uuid.UUID{}
	for _, tr := range fx.root.chainTramos() {
		users = append(users, tr.UserID)
	}
	if len(users) != 3 || !slices.Contains(users, fx.ana) || !slices.Contains(users, fx.beto) || !slices.Contains(users, fx.lucia) {
		t.Fatalf("chain tramos %v", users)
	}
	if fx.repl.Replacements.Count != 0 || fx.repl.assignedInChain(&fx.ana, at("2026-01-01T00:00:00Z"), at("2026-04-01T00:00:00Z")) {
		t.Fatalf("a replacement carries no chain: %+v", fx.repl.Replacements)
	}
	var none Vacancy
	if none.kind() != KindOriginal || none.root() != none.ID || !none.selectedBy("") || !none.selectedBy(KindOriginal) || none.selectedBy(KindReplacement) {
		t.Fatalf("zero value is an original: %q", none.kind())
	}
}
