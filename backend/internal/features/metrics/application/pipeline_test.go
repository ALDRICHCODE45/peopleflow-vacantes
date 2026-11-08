package application

import (
	"context"
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

// pipelineStore serves one pipeline snapshot (and the list store's period
// dataset, names and audit rows) and counts the pipeline loads.
type pipelineStore struct {
	*listStore
	pipeline *PipelineData
	loads    atomic.Int32
	hold     chan struct{} // when set, every pipeline load waits on it
}

func (s *pipelineStore) LoadPipeline(context.Context, uuid.UUID) (*PipelineData, error) {
	s.loads.Add(1)
	if s.hold != nil {
		<-s.hold
	}
	return s.pipeline, nil
}

// holidays is the weekday calendar minus the given dates.
func holidays(dates ...string) Calendar {
	return func(d time.Time) bool { return weekdays(d) && !slices.Contains(dates, d.Format(time.DateOnly)) }
}

// stagedPipeline builds a pipeline with the default kinds, the given custom
// stages after in_process, and the given retired stages.
func stagedPipeline(custom []string, retired ...string) Pipeline {
	p := Pipeline{Exit: uuid.New()}
	for _, kind := range []string{"new", "screening", "screening_ok", "in_process"} {
		p.Stages = append(p.Stages, PipelineStage{ID: uuid.New(), Kind: kind, Name: strings.ToUpper(kind)})
	}
	for _, name := range custom {
		p.Stages = append(p.Stages, PipelineStage{ID: uuid.New(), Kind: "custom", Name: name})
	}
	p.Stages = append(p.Stages, PipelineStage{ID: uuid.New(), Kind: "placement", Name: "Placement"})
	for _, name := range retired {
		p.Retired = append(p.Retired, PipelineStage{ID: uuid.New(), Kind: "custom", Name: name})
	}
	return p
}

func (p Pipeline) stage(name string) uuid.UUID {
	for _, s := range append(slices.Clone(p.Stages), p.Retired...) {
		if s.Name == name {
			return s.ID
		}
	}
	panic(name)
}

func openVacancy(title string, pl Pipeline) *OpenVacancy {
	return &OpenVacancy{ID: uuid.New(), Title: title, Pipeline: pl, Participations: []Participation{}}
}

func (v *OpenVacancy) with(name, stage, entered string) uuid.UUID {
	id := uuid.New()
	var stageID uuid.UUID
	if stage == "EXIT" {
		stageID = v.Pipeline.Exit
	} else {
		stageID = v.Pipeline.stage(stage)
	}
	v.Participations = append(v.Participations, Participation{ID: id, Candidate: Candidate{ID: uuid.New(), FullName: name}, StageID: stageID, EnteredAt: at(entered)})
	return id
}

// pipelineFixture: at as_of Tuesday 2026-03-24 with Monday 2026-03-16 a
// holiday. Entered on Thursday 03-12 = 7 business days (stalled); Friday
// 03-13 = 6 (not stalled, 7 without the holiday).
type pipelineFixture struct {
	store              *pipelineStore
	svc                *Service
	company, actor     uuid.UUID
	u, x               uuid.UUID
	a, b               *OpenVacancy
	alfa, beta, omega  *OpenVacancy
	zeta, placed       *OpenVacancy
	p1, p2, p5, p7, p8 uuid.UUID
}

const pipelineAsOf = "2026-03-24T18:00:00Z"

func newPipelineFixture() *pipelineFixture {
	fx := &pipelineFixture{company: uuid.New(), actor: uuid.New(), u: uuid.New(), x: uuid.New()}
	fx.a = openVacancy("Analista", stagedPipeline([]string{"Entrevista"}, "Vieja"))
	fx.p1 = fx.a.with("Pía", "NEW", "2026-03-13T18:00:00Z")
	fx.p2 = fx.a.with("Pablo", "NEW", "2026-03-12T18:00:00Z")
	fx.a.with("Quique", "Entrevista", "2026-03-24T15:00:00Z")
	fx.a.with("Rosa", "Placement", "2026-02-02T18:00:00Z")
	fx.p5 = fx.a.with("Sergio", "Vieja", "2026-03-02T18:00:00Z")
	fx.a.with("Tere", "EXIT", "2026-01-05T18:00:00Z")
	fx.a.Tramos = []Tramo{{ID: uuid.New(), UserID: fx.u, Start: at("2026-01-05T16:00:00Z")}}
	fx.a.Responsible = &fx.u

	fx.b = openVacancy("Backend", stagedPipeline([]string{"Prueba"}))
	fx.p7 = fx.b.with("Uriel", "Prueba", "2026-03-12T18:00:00Z")
	fx.p8 = fx.b.with("Vera", "SCREENING", "2026-03-23T18:00:00Z")
	fx.b.Requester = &Requester{Kind: "client", ID: &fx.x, Name: ptr("Acme")}
	// u's tramo on B ended before as_of: B is not u's under recruiter_id.
	fx.b.Tramos = []Tramo{{ID: uuid.New(), UserID: fx.u, Start: at("2026-01-05T16:00:00Z"), End: ptr(at("2026-03-01T18:00:00Z"))}}

	one := func(title string) *OpenVacancy {
		v := openVacancy(title, stagedPipeline(nil))
		v.with("C "+title, "IN_PROCESS", "2026-03-20T18:00:00Z")
		return v
	}
	fx.alfa, fx.beta, fx.omega, fx.zeta = one("alfa"), one("Beta"), one("Omega"), one("Zeta")
	fx.placed = openVacancy("Colocada", stagedPipeline(nil))
	fx.placed.with("Wendy", "Placement", "2026-03-20T18:00:00Z")

	fx.store = &pipelineStore{listStore: &listStore{data: &Dataset{People: map[uuid.UUID]Person{}}}, pipeline: &PipelineData{
		Vacancies: []*OpenVacancy{fx.zeta, fx.b, fx.omega, fx.a, fx.beta, fx.placed, fx.alfa},
		People:    map[uuid.UUID]Person{fx.u: {UserID: fx.u, Name: ptr("Ursula")}},
	}}
	fx.svc = NewService(fx.store, holidays("2026-03-16"), func() time.Time { return at(pipelineAsOf) })
	return fx
}

func (fx *pipelineFixture) section(t *testing.T, query string) *PipelineSection {
	t.Helper()
	out, err := fx.svc.Pipeline(context.Background(), fx.company, q1+query)
	if err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return out
}

func (fx *pipelineFixture) candidates(t *testing.T, query string) *List[CandidateRow, CandidateFacets] {
	t.Helper()
	out, err := fx.svc.ListCandidates(context.Background(), fx.company, fx.actor, q1+query)
	if err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return out
}

func jsonOf(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestStageEntry_OnlyIntakeMoveAndRecoveryReset(t *testing.T) {
	events := []StageEvent{
		{Kind: "intake", At: at("2026-03-01T18:00:00Z")},
		{Kind: "substate", At: at("2026-03-05T18:00:00Z")},
		{Kind: "not_applicable", At: at("2026-03-06T18:00:00Z")},
	}
	if got, ok := StageEntry(events); !ok || !got.Equal(at("2026-03-01T18:00:00Z")) {
		t.Fatalf("substate and not_applicable reset the entry: %v %v", got, ok)
	}
	events = append(events, StageEvent{Kind: "recovery", At: at("2026-03-10T18:00:00Z")}, StageEvent{Kind: "substate", At: at("2026-03-11T18:00:00Z")})
	if got, _ := StageEntry(events); !got.Equal(at("2026-03-10T18:00:00Z")) {
		t.Fatalf("recovery did not reset the entry: %v", got)
	}
	// Order of the rows does not matter; a later move wins.
	events = append([]StageEvent{{Kind: "move", At: at("2026-03-12T18:00:00Z")}}, events...)
	if got, _ := StageEntry(events); !got.Equal(at("2026-03-12T18:00:00Z")) {
		t.Fatalf("latest move: %v", got)
	}
	if _, ok := StageEntry([]StageEvent{{Kind: "substate", At: at("2026-03-05T18:00:00Z")}}); ok {
		t.Fatal("an entry without intake, move or recovery")
	}
}

func TestPipeline_StagesByKindDaysStalledAndRetired(t *testing.T) {
	fx := newPipelineFixture()
	got := fx.section(t, "")
	if got.StalledThreshold != 7 || got.Period.From != "2026-01-01" || !got.AsOf.Equal(at(pipelineAsOf)) {
		t.Fatalf("header %+v", got)
	}
	f := func(n float64) *float64 { return &n }
	want := []StageFigure{
		// 03-13 → 6 (holiday), 03-12 → 7: median 6.5, one stalled.
		{Kind: "new", Candidates: 2, MedianBusinessDaysInStage: f(6.5), Stalled: 1},
		{Kind: "screening", Candidates: 1, MedianBusinessDaysInStage: f(1), Stalled: 0},
		{Kind: "screening_ok", Candidates: 0, MedianBusinessDaysInStage: nil, Stalled: 0},
		{Kind: "in_process", Candidates: 4, MedianBusinessDaysInStage: f(2), Stalled: 0},
		// Every vacancy's custom stages fold into custom: 0 and 7 days.
		{Kind: "custom", Candidates: 2, MedianBusinessDaysInStage: f(3.5), Stalled: 1},
		// Placement is never stalled, however long.
		// Placement: 02-02 → 35 and 03-20 → 2.
		{Kind: "placement", Candidates: 2, MedianBusinessDaysInStage: f(18.5), Stalled: 0},
		// A stage no longer in the configuration; the exit stage is not
		// counted.
		{Kind: "retired", Candidates: 1, MedianBusinessDaysInStage: f(15), Stalled: 1},
	}
	if !reflect.DeepEqual(got.Stages, want) {
		t.Fatalf("stages\n got %s\nwant %s", jsonOf(t, got.Stages), jsonOf(t, want))
	}
	// retired is omitted at 0.
	fx.a.Participations = slices.DeleteFunc(fx.a.Participations, func(p Participation) bool { return p.ID == fx.p5 })
	fx.svc = NewService(fx.store, holidays("2026-03-16"), func() time.Time { return at(pipelineAsOf) })
	if stages := fx.section(t, "").Stages; len(stages) != 6 || stages[5].Kind != "placement" {
		t.Fatalf("%+v", stages)
	}
}

func TestPipeline_TopVacanciesBoundedTiesByTitle(t *testing.T) {
	fx := newPipelineFixture()
	got := fx.section(t, "")
	var titles []string
	for _, v := range got.TopVacancies {
		titles = append(titles, v.Vacancy.Title)
	}
	// A: 4 outside placement and exit (retired included); B: 2; then the
	// ones by title, case-insensitive; Zeta falls off; Colocada (placement
	// only) never counts.
	if !reflect.DeepEqual(titles, []string{"Analista", "Backend", "alfa", "Beta", "Omega"}) {
		t.Fatalf("%v", titles)
	}
	a, b := got.TopVacancies[0], got.TopVacancies[1]
	if a.InProcess != 4 || a.Responsible == nil || a.Responsible.UserID != fx.u || *a.Responsible.Name != "Ursula" || a.Requester != nil {
		t.Fatalf("A %+v", a)
	}
	if b.InProcess != 2 || b.Responsible != nil || b.Requester == nil || *b.Requester.Name != "Acme" {
		t.Fatalf("B %+v", b)
	}
}

func TestPipeline_RecruiterAndRequesterFilters(t *testing.T) {
	fx := newPipelineFixture()
	// u holds an open tramo on A only at as_of.
	got := fx.section(t, "&recruiter_id="+fx.u.String())
	if len(got.TopVacancies) != 1 || got.TopVacancies[0].Vacancy.DraftID != fx.a.ID || got.Stages[1].Candidates != 0 {
		t.Fatalf("%+v", got)
	}
	got = fx.section(t, "&requester_kind=client&requester_id="+fx.x.String())
	if len(got.TopVacancies) != 1 || got.TopVacancies[0].Vacancy.DraftID != fx.b.ID || got.Stages[0].Candidates != 0 {
		t.Fatalf("%+v", got)
	}
	// The period is validated and echoed, never applied.
	if got := fx.section(t, ""); got.Stages[0].Candidates != 2 {
		t.Fatal(got)
	}
	if out, err := fx.svc.Pipeline(context.Background(), fx.company, "from=2020-01-01&to=2020-01-31"); err != nil || out.Stages[0].Candidates != 2 || out.Period.From != "2020-01-01" {
		t.Fatalf("%+v %v", out, err)
	}
	for _, bad := range []string{"from=2026-01-01", q1 + "&limit=5", q1 + "&sort=title", q1 + "&stage_kind=new"} {
		if _, err := fx.svc.Pipeline(context.Background(), fx.company, bad); err == nil {
			t.Fatalf("%s accepted", bad)
		}
	}
}

// Every §4.4 figure equals the total of its candidates drill-down.
func TestCandidates_FigureEqualsTotal(t *testing.T) {
	fx := newPipelineFixture()
	for _, common := range []string{"", "&recruiter_id=" + fx.u.String(), "&requester_kind=client", "&requester_id=none"} {
		section := fx.section(t, common)
		checked := 0
		for _, s := range section.Stages {
			if got := fx.candidates(t, common+"&stage_kind="+s.Kind).Total; got != s.Candidates {
				t.Fatalf("%s %s: figure %d, total %d", common, s.Kind, s.Candidates, got)
			}
			if got := fx.candidates(t, common+"&stage_kind="+s.Kind+"&stalled=true").Total; got != s.Stalled {
				t.Fatalf("%s %s stalled: figure %d, total %d", common, s.Kind, s.Stalled, got)
			}
			checked += s.Candidates
		}
		for _, v := range section.TopVacancies {
			if got := fx.candidates(t, common+"&vacancy_id="+v.Vacancy.DraftID.String()+"&"+InProcessQuery).Total; got != v.InProcess {
				t.Fatalf("%s %s in process: figure %d, total %d", common, v.Vacancy.Title, v.InProcess, got)
			}
		}
		if common == "" && checked != 12 {
			t.Fatalf("checked %d candidates", checked)
		}
	}
}

func TestCandidates_RowsSortFacetsAndAppliedFilters(t *testing.T) {
	fx := newPipelineFixture()
	got := fx.candidates(t, "&stage_kind=new")
	if got.Total != 2 || len(got.Items) != 2 {
		t.Fatalf("%+v", got)
	}
	// Default: most business days in stage first.
	row := got.Items[0]
	want := CandidateRow{ParticipationID: fx.p2, Candidate: row.Candidate, Vacancy: VacancyRef{fx.a.ID, "Analista"}, Stage: StageRef{"new", "NEW"},
		BusinessDaysInStage: 7, Stalled: true, EnteredStageAt: at("2026-03-12T18:00:00Z")}
	if !reflect.DeepEqual(row, want) || row.Candidate.FullName != "Pablo" || got.Items[1].ParticipationID != fx.p1 || got.Items[1].Stalled {
		t.Fatalf("%+v", got.Items)
	}
	// The retired row is named by its retired stage.
	if r := fx.candidates(t, "&stage_kind=retired").Items; len(r) != 1 || r[0].Stage != (StageRef{"retired", "Vieja"}) || r[0].ParticipationID != fx.p5 {
		t.Fatalf("%+v", r)
	}
	names := func(l *List[CandidateRow, CandidateFacets]) string {
		return strings.Join(titles(l.Items, func(r CandidateRow) string { return r.Candidate.FullName }), ",")
	}
	if got := names(fx.candidates(t, "&stage_kind=custom,new&sort=candidate")); got != "Pablo,Pía,Quique,Uriel" {
		t.Fatal(got)
	}
	if got := names(fx.candidates(t, "&vacancy_id="+fx.b.ID.String()+"&sort=entered_stage_at&order=asc")); got != "Uriel,Vera" {
		t.Fatal(got)
	}
	// Backend before Analista; the Analista ties go by id.
	if got := names(fx.candidates(t, "&stage_kind=new,custom&sort=title&order=desc")); !strings.HasPrefix(got, "Uriel,") || len(strings.Split(got, ",")) != 4 {
		t.Fatal(got)
	}
	// Facets: each ignores only its own filter.
	got = fx.candidates(t, "&stage_kind=new&stalled=true")
	if got.Total != 1 || got.Facets.Stalled != 1 ||
		got.Facets.StageKind != (StageKindFacet{New: 1, Custom: 1, Retired: 1}) {
		t.Fatalf("facets %+v total %d", got.Facets, got.Total)
	}
	all := fx.candidates(t, "")
	if all.Total != 12 || all.Facets.Stalled != 3 || all.Facets.StageKind != (StageKindFacet{New: 2, Screening: 1, InProcess: 4, Custom: 2, Placement: 2, Retired: 1}) {
		t.Fatalf("facets %+v total %d", all.Facets, all.Total)
	}
	// Retired leaves the facet's JSON at 0; every other kind stays.
	fx.a.Participations = slices.DeleteFunc(fx.a.Participations, func(p Participation) bool { return p.ID == fx.p5 })
	fx.svc = NewService(fx.store, holidays("2026-03-16"), func() time.Time { return at(pipelineAsOf) })
	facet := decode(t, fx.candidates(t, ""))["facets"].(map[string]any)["stage_kind"].(map[string]any)
	if _, ok := facet["retired"]; ok || len(facet) != 6 || facet["screening_ok"] != float64(0) {
		t.Fatalf("%v", facet)
	}
	// Applied filters echo the plain filters and resolve the names from
	// the pipeline snapshot.
	got = fx.candidates(t, "&stage_kind=custom,new&stalled=true&recruiter_id="+fx.u.String()+"&vacancy_id="+fx.a.ID.String())
	wantApplied := map[string]any{"stage_kind": []string{"custom", "new"}, "stalled": true, "recruiter": Person{UserID: fx.u, Name: ptr("Ursula")},
		"vacancy": VacancyFilter{DraftID: fx.a.ID, Title: ptr("Analista")}}
	if jsonOf(t, got.AppliedFilters) != jsonOf(t, wantApplied) || len(fx.store.names) != 0 {
		t.Fatalf("%s (names %v)", jsonOf(t, got.AppliedFilters), fx.store.names)
	}
	for _, bad := range []string{"&stage_kind=new,new", "&stage_kind=exit", "&stalled=false", "&channel=portal", "&sort=hired_at"} {
		if _, err := fx.svc.ListCandidates(context.Background(), fx.company, fx.actor, q1+bad); err == nil {
			t.Fatalf("%s accepted", bad)
		}
	}
}

func TestCandidates_PagesAuditedFailClosed(t *testing.T) {
	fx := newPipelineFixture()
	first := fx.candidates(t, "&limit=5&stage_kind=new,in_process,custom,placement,retired&vacancy_id="+fx.a.ID.String())
	if first.Total != 5 || len(first.Items) != 5 || first.NextCursor != nil {
		t.Fatalf("%+v", first)
	}
	page := fx.candidates(t, "&limit=7")
	var walked []uuid.UUID
	for {
		for _, r := range page.Items {
			walked = append(walked, r.ParticipationID)
		}
		if page.NextCursor == nil {
			break
		}
		page = fx.candidates(t, "&limit=7&cursor="+*page.NextCursor)
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range walked {
		seen[id] = true
	}
	if len(walked) != 12 || len(seen) != 12 {
		t.Fatalf("walked %d", len(walked))
	}
	if len(fx.store.audits) != 3 {
		t.Fatalf("audits %d", len(fx.store.audits))
	}
	a := fx.store.audits[0]
	wantFilters := map[string]any{"from": "2026-01-01", "to": "2026-03-31", "sort": "business_days_in_stage", "order": "desc", "limit": 5,
		"vacancy_id": fx.a.ID.String(), "stage_kind": []string{"new", "in_process", "custom", "placement", "retired"}}
	if a.Company != fx.company || a.Actor != fx.actor || a.Exported || a.Report != "candidates" || a.Vacancy == nil || *a.Vacancy != fx.a.ID ||
		!a.VacancyOwned || !reflect.DeepEqual(a.Filters, wantFilters) {
		t.Fatalf("audit %+v", a)
	}
	if f := fx.store.audits[1].Filters; f["vacancy_id"] != nil || f["limit"] != 7 {
		t.Fatalf("%v", f)
	}
	fx.store.failAudit = true
	if out, err := fx.svc.ListCandidates(context.Background(), fx.company, fx.actor, q1); err == nil || out != nil {
		t.Fatalf("fail-closed: %+v %v", out, err)
	}
	fx.store.failAudit = false
	if _, err := fx.svc.ListCandidates(context.Background(), fx.company, fx.actor, q1+"&stalled=nope"); err == nil || len(fx.store.audits) != 3 {
		t.Fatalf("rejected request: %v, audits %d", err, len(fx.store.audits))
	}
	// The export is audited once, with the row count; above the limit it
	// writes nothing.
	export, err := fx.svc.Export(context.Background(), fx.company, fx.actor, "candidates", q1+"&stalled=true")
	if err != nil || export.Len() != 3 || export.Filename != "metricas-candidates-2026-01-01-2026-03-31.csv" {
		t.Fatalf("%+v %v", export, err)
	}
	last := fx.store.audits[len(fx.store.audits)-1]
	if len(fx.store.audits) != 4 || !last.Exported || last.Report != "candidates" || last.RowCount != 3 ||
		!reflect.DeepEqual(last.Filters, map[string]any{"from": "2026-01-01", "to": "2026-03-31", "sort": "business_days_in_stage", "order": "desc", "stalled": true}) {
		t.Fatalf("export audit %+v", last)
	}
	if rec := export.Record(0); len(rec) != len(export.Header) || rec[8] != "true" {
		t.Fatalf("%q %q", export.Header, rec)
	}
	fx.svc.WithExportLimit(2)
	if _, err := fx.svc.Export(context.Background(), fx.company, fx.actor, "candidates", q1+"&stalled=true"); err == nil || len(fx.store.audits) != 4 {
		t.Fatalf("too large: %v", err)
	}
	fx.svc.WithExportLimit(ExportLimit)
	fx.store.failAudit = true
	if out, err := fx.svc.Export(context.Background(), fx.company, fx.actor, "candidates", q1); err == nil || out != nil {
		t.Fatalf("export fail-closed: %v", err)
	}
}

// The pipeline snapshot is keyed by company only: every period shares it,
// concurrent misses load once, another company loads its own, and it expires
// with the period snapshots' TTL.
func TestPipeline_SnapshotPerCompany(t *testing.T) {
	fx := newPipelineFixture()
	clock := &fakeClock{now: at(pipelineAsOf)}
	fx.store.hold = make(chan struct{})
	fx.svc = NewService(fx.store, holidays("2026-03-16"), clock.Now)
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			query := q1
			if i%2 == 0 {
				query = "from=2025-01-01&to=2025-01-31"
			}
			if i%3 == 0 {
				_, err := fx.svc.ListCandidates(context.Background(), fx.company, fx.actor, query)
				errs <- err
				return
			}
			_, err := fx.svc.Pipeline(context.Background(), fx.company, query)
			errs <- err
		}()
	}
	waitFor(t, func() bool { return fx.svc.pipelines.waiters(fx.company) == 20 })
	close(fx.store.hold)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if fx.store.loads.Load() != 1 {
		t.Fatalf("loads %d, want 1", fx.store.loads.Load())
	}
	fx.svc.Pipeline(context.Background(), uuid.New(), q1)
	if fx.store.loads.Load() != 2 {
		t.Fatalf("another company: loads %d", fx.store.loads.Load())
	}
	clock.Add(SnapshotTTL - time.Second)
	fx.section(t, "")
	if fx.store.loads.Load() != 2 {
		t.Fatal("reloaded within the TTL")
	}
	clock.Add(time.Second)
	if got := fx.section(t, ""); fx.store.loads.Load() != 3 || !got.AsOf.Equal(clock.Now()) {
		t.Fatalf("after the TTL: loads %d, as_of %v", fx.store.loads.Load(), got.AsOf)
	}
}

func TestApplications_TotalIsTheChannelSumWithFacets(t *testing.T) {
	u := uuid.New()
	v1 := vacancy("Uno", "2026-01-05T16:00:00Z").withTramo(u, "2026-01-05T16:00:00Z")
	v1.Origin = map[string]int{"portal": 2, "manual": 1, "unknown": 1}
	v2 := vacancy("dos", "2026-01-05T16:00:00Z")
	v2.Origin = map[string]int{"careers_site": 3}
	v3 := vacancy("Tres", "2026-01-05T16:00:00Z") // no application in the period
	store := &listStore{data: &Dataset{Vacancies: []*Vacancy{v1, v2, v3}, People: map[uuid.UUID]Person{}}}
	svc := newTestService(store, at("2026-03-20T18:00:00Z"))
	list := func(query string) *List[ApplicationRow, ApplicationFacets] {
		t.Helper()
		out, err := svc.ListApplications(context.Background(), uuid.New(), q1+query)
		if err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		return out
	}
	origin, err := svc.Origin(context.Background(), uuid.New(), q1)
	if err != nil {
		t.Fatal(err)
	}
	all := list("")
	facets := Origin{Portal: 2, CareersSite: 3, Manual: 1, Unknown: 1}
	if all.Total != 7 || all.Facets.Channel != facets || all.Facets.Channel != origin.ByChannel {
		t.Fatalf("%+v", all)
	}
	// Default total desc; ties would go by id.
	if got := titles(all.Items, func(r ApplicationRow) string { return r.Vacancy.Title }); !reflect.DeepEqual(got, []string{"Uno", "dos"}) {
		t.Fatal(got)
	}
	if r := all.Items[0]; r != (ApplicationRow{Vacancy: VacancyRef{v1.ID, "Uno"}, Portal: 2, Manual: 1, Unknown: 1, Total: 4}) {
		t.Fatalf("%+v", r)
	}
	// Each channel's origin figure is the list total for that channel.
	for channel, n := range map[string]int{"portal": 2, "careers_site": 3, "manual": 1, "unknown": 1} {
		if got := list("&channel=" + channel).Total; got != n {
			t.Fatalf("%s: %d, want %d", channel, got, n)
		}
	}
	// The selected channels make the total and the row total; the facet
	// ignores the channel filter.
	got := list("&channel=portal,manual")
	if got.Total != 3 || len(got.Items) != 1 || got.Items[0].Total != 3 || got.Items[0].Unknown != 1 || got.Facets.Channel != facets {
		t.Fatalf("%+v", got)
	}
	if got := titles(list("&sort=title").Items, func(r ApplicationRow) string { return r.Vacancy.Title }); !reflect.DeepEqual(got, []string{"dos", "Uno"}) {
		t.Fatal(got)
	}
	if got := list("&recruiter_id=" + u.String()); got.Total != 4 || len(got.Items) != 1 {
		t.Fatalf("%+v", got)
	}
	if got := list("&vacancy_id=" + v2.ID.String()); got.Total != 3 || got.Facets.Channel != (Origin{CareersSite: 3}) {
		t.Fatalf("%+v", got)
	}
	if got := list("&channel=careers_site"); jsonOf(t, got.AppliedFilters) != `{"channel":["careers_site"]}` {
		t.Fatal(jsonOf(t, got.AppliedFilters))
	}
	for _, bad := range []string{"&channel=fax", "&channel=portal,portal", "&stage_kind=new", "&sort=hired_at"} {
		if _, err := svc.ListApplications(context.Background(), uuid.New(), q1+bad); err == nil {
			t.Fatalf("%s accepted", bad)
		}
	}
	export, err := svc.Export(context.Background(), uuid.New(), uuid.New(), "applications", q1+"&channel=careers_site")
	if err != nil || export.Len() != 1 || !reflect.DeepEqual(export.Record(0), []string{v2.ID.String(), "dos", "Sin solicitante", "0", "3", "0", "0", "3"}) {
		t.Fatalf("%+v %v", export, err)
	}
	if len(store.audits) != 0 {
		t.Fatal("applications audited")
	}
}
