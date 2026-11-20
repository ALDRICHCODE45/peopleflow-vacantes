package application

import (
	"context"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

// The replacement keys of every row that names a vacancy (replacement-processes-v1
// §«Metrics», R6b): kind, root_draft_id and sequence on the shared VacancyRef,
// `replacements` on the flat vacancies rows, `process` on the per-vacancy
// details, a process_kind column on the exports, and the dashboard counting an
// active private replacement as an active vacancy once (Q1).

var refKeys = []string{"draft_id", "kind", "root_draft_id", "sequence", "title"}

// vacancyRefs collects every VacancyRef of a decoded response: the objects under a
// «vacancy» key with a draft_id. applied_filters.vacancy (VacancyFilter) and the
// dashboard's recent rows (RecentVacancy) keep their own shapes and are not refs.
func vacancyRefs(v any, path string, out *[]refAt) {
	switch x := v.(type) {
	case map[string]any:
		for key, child := range x {
			if key == "applied_filters" || key == "recent" {
				continue
			}
			if m, ok := child.(map[string]any); ok && key == "vacancy" {
				if _, isRef := m["draft_id"]; isRef {
					*out = append(*out, refAt{path + "." + key, m})
					continue
				}
			}
			vacancyRefs(child, path+"."+key, out)
		}
	case []any:
		for _, child := range x {
			vacancyRefs(child, path, out)
		}
	}
}

type refAt struct {
	path string
	ref  map[string]any
}

// checkRefs asserts every ref of body has exactly the five keys and the right
// placement for the ids it names; it returns how many it saw.
func checkRefs(t *testing.T, label string, body any, root uuid.UUID, replacements ...uuid.UUID) int {
	t.Helper()
	var refs []refAt
	vacancyRefs(decode(t, body), label, &refs)
	for _, r := range refs {
		keys := make([]string, 0, len(r.ref))
		for k := range r.ref {
			keys = append(keys, k)
		}
		slices.Sort(keys)
		if !slices.Equal(keys, refKeys) {
			t.Errorf("%s: keys %v", r.path, keys)
			continue
		}
		id := r.ref["draft_id"].(string)
		if slices.ContainsFunc(replacements, func(u uuid.UUID) bool { return u.String() == id }) {
			if r.ref["kind"] != "replacement" || r.ref["root_draft_id"] != root.String() || r.ref["sequence"] != float64(1) {
				t.Errorf("%s: replacement ref %v", r.path, r.ref)
			}
		} else if r.ref["kind"] != "original" || r.ref["root_draft_id"] != id || r.ref["sequence"] != nil {
			t.Errorf("%s: original ref %v", r.path, r.ref)
		}
	}
	return len(refs)
}

func TestVacancyRef_EveryMetricsRowCarriesTheKeys(t *testing.T) {
	fx := newChainFixture()
	ctx := context.Background()
	seen := map[string]int{}
	check := func(label string, body any, err error, min int) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		n := checkRefs(t, label, body, fx.root.ID, fx.repl.ID)
		if n < min {
			t.Errorf("%s: %d refs, want at least %d", label, n, min)
		}
		seen[label] = n
	}
	deliveries, err := fx.svc.ListDeliveries(ctx, fx.company, q1)
	check("deliveries", deliveries, err, 2)
	placements, err := fx.svc.ListPlacements(ctx, fx.company, fx.actor, q1)
	check("placements", placements, err, 3)
	reassignments, err := fx.svc.Reassignments(ctx, fx.company, q1)
	check("reassignments", reassignments, err, 1)
	candidates, err := fx.svc.ListCandidates(ctx, fx.company, fx.actor, q1)
	check("candidates", candidates, err, 3)
	applications, err := fx.svc.ListApplications(ctx, fx.company, q1)
	check("applications", applications, err, 2)
	delays, err := fx.svc.Delays(ctx, fx.company, q1)
	check("delays.overdue.top", delays, err, 1)
	pipeline, err := fx.svc.Pipeline(ctx, fx.company, q1)
	check("pipeline.top_vacancies", pipeline, err, 1)
	// The summary and the flat vacancies rows name no VacancyRef.
	summary, err := fx.svc.Summary(ctx, fx.company, q1)
	check("summary", summary, err, 0)
	if seen["summary"] != 0 {
		t.Errorf("summary carries refs")
	}
}

func TestVacancyRows_CarryTheReplacementsSummary(t *testing.T) {
	fx := newChainFixture()
	got, err := fx.svc.Vacancies(context.Background(), fx.company, q1)
	if err != nil || len(got.Items) != 1 {
		t.Fatalf("%v %+v", err, got)
	}
	row := decode(t, got.Items[0])
	if _, has := row["kind"]; has {
		t.Errorf("a flat vacancies row gained a kind: %v", row)
	}
	want := map[string]any{"count": float64(1), "active_draft_id": fx.repl.ID.String()}
	if !reflect.DeepEqual(row["replacements"], want) {
		t.Errorf("replacements %v, want %v", row["replacements"], want)
	}
	// A vacancy with none: count 0, no active one.
	plain := vacancy("Común", "2026-01-05T16:00:00Z").withTramo(fx.ana, "2026-01-05T16:00:00Z")
	alone := newTestService(&listStore{data: &Dataset{Vacancies: []*Vacancy{plain}, People: map[uuid.UUID]Person{}}}, at("2026-04-01T18:00:00Z"))
	got, err = alone.Vacancies(context.Background(), fx.company, q1)
	if err != nil || len(got.Items) != 1 {
		t.Fatalf("%v %+v", err, got)
	}
	if row := decode(t, got.Items[0]); !reflect.DeepEqual(row["replacements"], map[string]any{"count": float64(0), "active_draft_id": nil}) {
		t.Errorf("replacements %v", row["replacements"])
	}
}

func TestDetails_NameTheProcess(t *testing.T) {
	fx := newChainFixture()
	store := &detailStore{Store: fx.store, refs: map[uuid.UUID]ProcessRef{
		fx.root.ID: {Kind: KindOriginal, RootDraftID: fx.root.ID},
		fx.repl.ID: {Kind: KindReplacement, RootDraftID: fx.root.ID, Sequence: ptr(2)},
	}}
	svc := newTestService(store, at("2026-04-01T18:00:00Z"))
	for id, want := range map[uuid.UUID]map[string]any{
		fx.root.ID: {"kind": "original", "root_draft_id": fx.root.ID.String(), "sequence": nil},
		fx.repl.ID: {"kind": "replacement", "root_draft_id": fx.root.ID.String(), "sequence": float64(2)},
	} {
		deliveries, err := svc.Deliveries(context.Background(), fx.company, fx.actor, id, q1)
		if err != nil {
			t.Fatal(err)
		}
		if got := decode(t, deliveries); !reflect.DeepEqual(got["process"], want) || got["draft_id"] != id.String() {
			t.Errorf("deliveries %v", got)
		}
		placements, err := svc.Placements(context.Background(), fx.company, fx.actor, id, q1)
		if err != nil {
			t.Fatal(err)
		}
		if got := decode(t, placements); !reflect.DeepEqual(got["process"], want) {
			t.Errorf("placements %v", got)
		}
	}
}

func TestExports_GainAProcessKindColumn(t *testing.T) {
	fx := newChainFixture()
	ctx := context.Background()
	for _, kind := range []string{"deliveries", "placements", "reassignments", "candidates", "applications"} {
		e, err := fx.svc.Export(ctx, fx.company, fx.actor, kind, q1)
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		last := len(e.Header) - 1
		if e.Header[last] != "Tipo de proceso" {
			t.Errorf("%s: header %v", kind, e.Header)
		}
		got := []string{}
		for i := 0; i < e.Len(); i++ {
			rec := e.Record(i)
			if len(rec) != len(e.Header) {
				t.Fatalf("%s: %d cells for %d columns", kind, len(rec), len(e.Header))
			}
			got = append(got, rec[last])
		}
		slices.Sort(got)
		if !slices.Contains(got, "replacement") || !slices.Contains(got, "original") && kind != "reassignments" {
			t.Errorf("%s: process kinds %v", kind, got)
		}
		// The export of a process_kind is that kind's rows, every cell its code.
		only, err := fx.svc.Export(ctx, fx.company, fx.actor, kind, q1+"&process_kind=replacement")
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < only.Len(); i++ {
			if only.Record(i)[last] != "replacement" {
				t.Errorf("%s: %v", kind, only.Record(i))
			}
		}
	}
	// The vacancies export is roots only and keeps its columns.
	e, err := fx.svc.Export(ctx, fx.company, fx.actor, "vacancies", q1)
	if err != nil || e.Header[len(e.Header)-1] != "Reasignaciones" {
		t.Errorf("vacancies header %v %v", e.Header, err)
	}
}

// historyChain is the dashboard's logical vacancy: the original closed and finished
// on 02-10, its private replacement started 02-12 and still open (as_of Tuesday
// 2026-03-24), overdue and with a candidate in process.
type historyChain struct {
	*historyFixture
	root, repl *HistoryVacancy
	openRepl   *OpenVacancy
}

func newHistoryChain() *historyChain {
	fx := &historyFixture{company: uuid.New(), u: uuid.New()}
	pl := stagedPipeline(nil)
	c := &historyChain{historyFixture: fx}
	c.root = historyVacancy("Original", "2026-01-05T16:00:00Z", pl)
	c.root.event("close", "2026-02-10T18:00:00Z")
	c.root.event("finish_process", "2026-02-12T16:00:00Z")
	c.root.Status, c.root.Finished = "closed", true
	c.root.Headcount, c.root.ActiveCredits = ptr(2), 1
	c.root.Tramos = []Tramo{{ID: uuid.New(), UserID: fx.u, Start: at("2026-01-05T16:00:00Z")}}
	c.repl = historyVacancy("Reemplazo", "2026-02-12T16:00:00Z", pl)
	c.repl.Kind, c.repl.RootID, c.repl.Sequence, c.repl.ProcessActive = KindReplacement, c.root.ID, ptr(1), true
	c.repl.Headcount = ptr(1)
	c.repl.Tramos = []Tramo{{ID: uuid.New(), UserID: fx.u, Start: at("2026-02-12T16:00:00Z")}}
	c.repl.Delivery = DeliveryFacts{Configured: true, Commitment: ptr("2026-03-10"), Target: ptr(1)}
	c.repl.track([3]string{"intake", "SCREENING", "2026-03-02T18:00:00Z"})
	c.repl.Tracks[0].Candidate = Candidate{ID: uuid.New(), FullName: "Pía"}

	c.openRepl = openVacancy("Reemplazo", pl)
	c.openRepl.ID, c.openRepl.Kind, c.openRepl.RootID, c.openRepl.Sequence = c.repl.ID, KindReplacement, c.root.ID, ptr(1)
	c.openRepl.Tramos = c.repl.Tramos
	c.openRepl.with("Pía", "SCREENING", "2026-03-02T18:00:00Z")
	fx.store = &historyStore{pipelineStore: &pipelineStore{listStore: &listStore{}, pipeline: &PipelineData{Vacancies: []*OpenVacancy{c.openRepl}, People: map[uuid.UUID]Person{}}},
		history: map[uuid.UUID]*HistoryData{fx.company: {Vacancies: []*HistoryVacancy{c.root, c.repl}, People: map[uuid.UUID]Person{}}}}
	fx.svc = NewService(fx.store, holidays("2026-03-16"), func() time.Time { return at(historyAsOf) })
	return c
}

// An active private replacement counts as a published vacancy and the logical
// vacancy still counts once (Q1): the finished original is not published.
func TestDashboard_ActiveReplacementCountsOnceAndCarriesTheKeys(t *testing.T) {
	c := newHistoryChain()
	ctx := context.Background()
	for _, viewer := range []Viewer{listOwner, {UserID: c.u}} {
		sum, err := c.svc.DashboardSummary(ctx, c.company, viewer, "window=7")
		if err != nil {
			t.Fatal(err)
		}
		if sum.PublishedVacancies.Current != 1 || sum.PublishedVacancies.Previous != 1 || sum.Positions != (Positions{0, 1}) {
			t.Errorf("owner=%v: published %+v positions %+v", viewer.Owner, sum.PublishedVacancies, sum.Positions)
		}
		list, err := c.svc.DashboardVacancyList(ctx, c.company, viewer, "status=published")
		if err != nil {
			t.Fatal(err)
		}
		// The list total equals the figure; the row is the replacement.
		if list.Total != sum.PublishedVacancies.Current || len(list.Items) != 1 || list.Items[0].Vacancy.DraftID != c.repl.ID || list.Positions != sum.Positions {
			t.Errorf("owner=%v: list %d %+v", viewer.Owner, list.Total, list.Items)
		}
		all, err := c.svc.DashboardVacancyList(ctx, c.company, viewer, "")
		if err != nil {
			t.Fatal(err)
		}
		if all.Total != 2 || all.Facets.Status != (StatusFacet{Published: 1, Finished: 1}) {
			t.Errorf("owner=%v: all %d %+v", viewer.Owner, all.Total, all.Facets)
		}
		section, err := c.svc.DashboardVacancies(ctx, c.company, viewer, "window=7")
		if err != nil || len(section.Top) != 1 || section.Top[0].Vacancy.Kind != KindReplacement {
			t.Fatalf("%v %+v", err, section)
		}
		attention, err := c.svc.DashboardAttention(ctx, c.company, viewer, "window=7")
		if err != nil || attention.Overdue.Total != 1 || attention.Stalled.Total != 1 {
			t.Fatalf("%v %+v", err, attention)
		}
		deliveries, err := c.svc.DashboardDeliveryList(ctx, c.company, viewer, "state=overdue")
		if err != nil || deliveries.Total != attention.Overdue.Total {
			t.Fatalf("%v %+v", err, deliveries)
		}
		inProcess, err := c.svc.DashboardCandidateList(ctx, c.company, viewer, "in_process=true")
		if err != nil {
			t.Fatal(err)
		}
		stalled, err := c.svc.DashboardCandidateList(ctx, c.company, viewer, "stalled=true")
		if err != nil {
			t.Fatal(err)
		}
		applications, err := c.svc.DashboardApplicationList(ctx, c.company, viewer, "")
		if err != nil {
			t.Fatal(err)
		}
		recent, err := c.svc.DashboardRecent(ctx, c.company, viewer, "window=7")
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for label, body := range map[string]any{"vacancies list": all, "vacancies section": section, "attention": attention, "deliveries": deliveries,
			"candidates in_process": inProcess, "candidates stalled": stalled, "applications": applications} {
			got := checkRefs(t, label, body, c.root.ID, c.repl.ID)
			if got == 0 {
				t.Errorf("%s names no vacancy", label)
			}
			n += got
		}
		if n < 8 {
			t.Errorf("only %d refs checked", n)
		}
		// recent keeps its own {id, title}.
		for _, row := range decode(t, recent)["recent"].([]any) {
			if v := row.(map[string]any)["vacancy"].(map[string]any); len(v) != 2 {
				t.Errorf("recent vacancy %v", v)
			}
		}
	}
	// The dashboard exports carry the process kind too.
	for kind, last := range map[string]string{"vacancies": "Tipo de proceso", "deliveries": "Tipo de proceso", "candidates": "Tipo de proceso", "applications": "Tipo de proceso"} {
		e, err := c.svc.DashboardExport(ctx, c.company, listOwner, kind, "")
		if err != nil || e.Header[len(e.Header)-1] != last {
			t.Errorf("%s: %v %v", kind, e.Header, err)
			continue
		}
		for i := 0; i < e.Len(); i++ {
			if rec := e.Record(i); len(rec) != len(e.Header) || (rec[len(rec)-1] != "original" && rec[len(rec)-1] != "replacement") {
				t.Errorf("%s: %v", kind, rec)
			}
		}
	}
}
