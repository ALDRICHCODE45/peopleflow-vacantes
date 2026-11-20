package application

import (
	"context"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// historyStore serves one history snapshot per company (empty otherwise),
// the pipeline snapshot, and counts the history loads per company.
type historyStore struct {
	*pipelineStore
	history map[uuid.UUID]*HistoryData
	mu      sync.Mutex
	loads   map[uuid.UUID]int
	since   time.Time
}

func (s *historyStore) LoadHistory(_ context.Context, company uuid.UUID, since time.Time) (*HistoryData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loads == nil {
		s.loads = map[uuid.UUID]int{}
	}
	s.loads[company]++
	s.since = since
	if d, ok := s.history[company]; ok {
		return d, nil
	}
	return &HistoryData{People: map[uuid.UUID]Person{}}, nil
}

func historyVacancy(title, published string, pl Pipeline) *HistoryVacancy {
	return &HistoryVacancy{Vacancy: &Vacancy{ID: uuid.New(), Title: title, PublishedAt: at(published)}, Status: "published", Pipeline: pl}
}

// track adds a participation with its stage rows: kind, stage name ("EXIT"
// for the exit stage) and instant, the first one its creation.
func (v *HistoryVacancy) track(rows ...[3]string) *Track {
	p := Track{ID: uuid.New(), CreatedAt: at(rows[0][2]), Channel: "portal"}
	for _, r := range rows {
		stage := v.Pipeline.Exit
		if r[1] != "EXIT" {
			stage = v.Pipeline.stage(r[1])
		}
		p.Moves = append(p.Moves, StageMove{Kind: r[0], StageID: stage, At: at(r[2])})
		if r[0] != "substate" {
			p.StageID, p.Discarded = stage, r[0] == "discard"
		}
	}
	v.Tracks = append(v.Tracks, p)
	return &v.Tracks[len(v.Tracks)-1]
}

func (v *HistoryVacancy) event(action, when string) {
	v.Lifecycle = append(v.Lifecycle, LifecycleEvent{action, at(when)})
}

// historyFixture: as_of Tuesday 2026-03-24 12:00 in Mexico City. A local day
// ends at 06:00 UTC of the next date. Window 7: 03-18..03-24, previous end
// point 03-17.
type historyFixture struct {
	store          *historyStore
	svc            *Service
	company, u     uuid.UUID
	a, b, c, d     *HistoryVacancy
	p1, p2, p3, p4 *Track
}

const historyAsOf = "2026-03-24T18:00:00Z"

func newHistoryFixture() *historyFixture {
	fx := &historyFixture{company: uuid.New(), u: uuid.New()}
	pl := stagedPipeline([]string{"Entrevista"}, "Vieja")
	fx.a = historyVacancy("Analista", "2026-01-05T16:00:00Z", pl)
	// p1: new, screening on 03-19 local afternoon, placement on 03-22.
	fx.p1 = fx.a.track([3]string{"intake", "NEW", "2026-03-10T18:00:00Z"}, [3]string{"move", "SCREENING", "2026-03-19T20:00:00Z"},
		[3]string{"move", "Placement", "2026-03-22T18:00:00Z"})
	// p2: screening, discarded on 03-20, recovered into in_process on 03-23.
	fx.p2 = fx.a.track([3]string{"intake", "SCREENING", "2026-03-01T18:00:00Z"}, [3]string{"discard", "EXIT", "2026-03-20T18:00:00Z"},
		[3]string{"recovery", "IN_PROCESS", "2026-03-23T18:00:00Z"})
	// p3: a substate row (whatever stage id it carries) never moves it.
	fx.p3 = fx.a.track([3]string{"intake", "SCREENING_OK", "2026-03-01T18:00:00Z"}, [3]string{"substate", "NEW", "2026-03-18T18:00:00Z"})
	// p4: into screening one second before 03-18 local midnight: counts on 03-17.
	fx.p4 = fx.a.track([3]string{"intake", "NEW", "2026-03-01T18:00:00Z"}, [3]string{"move", "SCREENING", "2026-03-18T05:59:59Z"})
	// A retired stage counts as in process.
	fx.a.track([3]string{"intake", "Vieja", "2026-03-23T07:00:00Z"})
	fx.a.Tramos = []Tramo{{ID: uuid.New(), UserID: fx.u, Start: at("2026-01-05T16:00:00Z")}}
	fx.a.Headcount, fx.a.ActiveCredits = ptr(3), 1

	// B: closed on 03-20, reopened on 03-23; u's tramo ended before as_of.
	fx.b = historyVacancy("Backend", "2026-01-05T16:00:00Z", pl)
	fx.b.track([3]string{"intake", "IN_PROCESS", "2026-03-01T18:00:00Z"})
	fx.b.event("close", "2026-03-20T18:00:00Z")
	fx.b.event("reopen", "2026-03-23T18:00:00Z")
	fx.b.Tramos = []Tramo{{ID: uuid.New(), UserID: fx.u, Start: at("2026-01-05T16:00:00Z"), End: ptr(at("2026-03-01T18:00:00Z"))}}
	fx.b.ActiveCredits = 2

	// C: published on 03-19, paused on 03-22 (paused is not published).
	fx.c = historyVacancy("Cajero", "2026-03-19T18:00:00Z", pl)
	fx.c.track([3]string{"intake", "SCREENING", "2026-03-19T18:00:00Z"})
	fx.c.event("pause", "2026-03-22T18:00:00Z")
	fx.c.Status = "paused"
	fx.c.Headcount = ptr(2)

	// D: closed for good on 03-18.
	fx.d = historyVacancy("Diseño", "2026-01-05T16:00:00Z", pl)
	fx.d.event("close", "2026-03-18T18:00:00Z")
	fx.d.Status = "closed"

	fx.store = &historyStore{pipelineStore: &pipelineStore{listStore: &listStore{}, pipeline: &PipelineData{People: map[uuid.UUID]Person{}}},
		history: map[uuid.UUID]*HistoryData{fx.company: {Vacancies: []*HistoryVacancy{fx.a, fx.b, fx.c, fx.d}, People: map[uuid.UUID]Person{}}}}
	fx.svc = NewService(fx.store, holidays("2026-03-16"), func() time.Time { return at(historyAsOf) })
	return fx
}

func (fx *historyFixture) summary(t *testing.T, viewer Viewer, raw string) *DashboardSummarySection {
	t.Helper()
	out, err := fx.svc.DashboardSummary(context.Background(), fx.company, viewer, raw)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func seriesValues(s []DayValue) map[string]int {
	out := map[string]int{}
	for _, d := range s {
		out[d.Date] = d.Value
	}
	return out
}

func TestPublishedAt_PublicationAndLifecycleEvents(t *testing.T) {
	v := historyVacancy("V", "2026-03-02T18:00:00Z", Pipeline{})
	v.event("pause", "2026-03-05T18:00:00Z")
	v.event("resume", "2026-03-06T18:00:00Z")
	v.event("close", "2026-03-10T18:00:00Z")
	v.event("finish_process", "2026-03-11T18:00:00Z")
	v.event("reopen", "2026-03-12T18:00:00Z")
	for date, want := range map[string]bool{
		"2026-03-01": false, // before its publication
		"2026-03-02": true,
		"2026-03-05": false, // paused
		"2026-03-06": true,  // resumed
		"2026-03-10": false, // closed
		"2026-03-11": false, // finished
		"2026-03-12": true,  // reopened
		"2026-04-01": true,
	} {
		if got := v.publishedAt(dayEnd(date)); got != want {
			t.Errorf("end of %s: published %v, want %v", date, got, want)
		}
	}
	// An event at the exact local midnight belongs to the next day.
	w := historyVacancy("W", "2026-03-02T18:00:00Z", Pipeline{})
	w.event("close", "2026-03-04T06:00:00Z") // 03-04 00:00 local
	if !w.publishedAt(dayEnd("2026-03-03")) || w.publishedAt(dayEnd("2026-03-04")) {
		t.Fatal("midnight boundary")
	}
}

func TestStageAt_MovesDiscardRecoveryAndFallback(t *testing.T) {
	fx := newHistoryFixture()
	stage, active := fx.p2.stageAt(dayEnd("2026-03-21"))
	if active {
		t.Fatalf("discarded p2 active at %v", stage)
	}
	if stage, active = fx.p2.stageAt(dayEnd("2026-03-23")); !active || stage != fx.a.Pipeline.stage("IN_PROCESS") {
		t.Fatalf("recovered p2: %v %v", stage, active)
	}
	if _, active = fx.p1.stageAt(at("2026-03-10T17:00:00Z")); active {
		t.Fatal("p1 active before its intake")
	}
	// Without rows: the current stage from its creation.
	p := Track{ID: uuid.New(), CreatedAt: at("2026-03-10T18:00:00Z"), StageID: fx.a.Pipeline.stage("SCREENING")}
	if _, active = p.stageAt(at("2026-03-10T17:00:00Z")); active {
		t.Fatal("fallback before creation")
	}
	if stage, active = p.stageAt(dayEnd("2026-03-10")); !active || stage != p.StageID {
		t.Fatal("fallback")
	}
	p.Discarded = true
	if _, active = p.stageAt(dayEnd("2026-03-10")); active {
		t.Fatal("discarded fallback")
	}
}

// The series is rebuilt from the intervals at the end of every local day:
// moves, a discard and its recovery, a substate row ignored, a vacancy closed
// and reopened mid-window, a vacancy published then paused mid-window.
func TestDashboardSummary_InProcessSeriesFromIntervals(t *testing.T) {
	fx := newHistoryFixture()
	got := fx.summary(t, Viewer{UserID: uuid.New(), Owner: true}, "window=7")
	wantWindow := Window{7, "2026-03-18", "2026-03-24", "2026-03-11", "2026-03-17"}
	if got.Window != wantWindow || got.Scope != "company" || got.DefinitionsVersion != "d2" || !got.AsOf.Equal(at(historyAsOf)) {
		t.Fatalf("header %+v", got.dashboardHeader)
	}
	// A: p1 19–21, p2 17–19 and 23–24, p3 and p4 every day, retired 23–24;
	// B: 17–19 and 23–24; C: 19–21.
	want := map[string]int{"2026-03-17": 4, "2026-03-18": 4, "2026-03-19": 6, "2026-03-20": 4, "2026-03-21": 4, "2026-03-22": 2, "2026-03-23": 5, "2026-03-24": 5}
	if len(got.InProcess.Series) != 8 || got.InProcess.Series[0].Date != "2026-03-17" || got.InProcess.Series[7].Date != "2026-03-24" {
		t.Fatalf("series dates %v", got.InProcess.Series)
	}
	if v := seriesValues(got.InProcess.Series); !reflect.DeepEqual(v, want) {
		t.Fatalf("series %v, want %v", v, want)
	}
	if got.InProcess.Current != 5 || got.InProcess.Previous != 4 {
		t.Fatalf("in_process %+v", got.InProcess.Delta)
	}
	// End of 03-17: A, B, D; end of 03-24: A, B (C paused, D closed).
	if got.PublishedVacancies != (Delta[int]{2, 3}) {
		t.Fatalf("published %+v", got.PublishedVacancies)
	}
	// Published now: A (3 required, 1 credit) and B (no headcount, 2 credits).
	if got.Positions != (Positions{Covered: 3, Required: 3}) {
		t.Fatalf("positions %+v", got.Positions)
	}
	if got.PoolAdded != nil {
		t.Fatalf("pool_added without a talent base: %+v", got.PoolAdded)
	}
}

// A recruiter sees only the vacancies where they have an open tramo at
// as_of: A, not B (their tramo ended) nor C and D.
func TestDashboardSummary_RecruiterScope(t *testing.T) {
	fx := newHistoryFixture()
	got := fx.summary(t, Viewer{UserID: fx.u}, "")
	if got.Scope != "own_vacancies" || got.Window.Days != 30 {
		t.Fatalf("header %+v", got.dashboardHeader)
	}
	v := seriesValues(got.InProcess.Series)
	for date, want := range map[string]int{"2026-03-17": 3, "2026-03-19": 4, "2026-03-22": 2, "2026-03-24": 4} {
		if v[date] != want {
			t.Errorf("%s: %d, want %d", date, v[date], want)
		}
	}
	if len(got.InProcess.Series) != 31 || got.PublishedVacancies != (Delta[int]{1, 1}) || got.Positions != (Positions{1, 3}) {
		t.Fatalf("%d points, published %+v, positions %+v", len(got.InProcess.Series), got.PublishedVacancies, got.Positions)
	}
	// Another user with no tramo sees nothing.
	none := fx.summary(t, Viewer{UserID: uuid.New()}, "window=7")
	if none.InProcess.Current != 0 || none.PublishedVacancies != (Delta[int]{}) || none.Positions != (Positions{}) {
		t.Fatalf("%+v", none)
	}
}

// The history snapshot never depends on the caller: owner and recruiters of
// one company share a load; another company loads its own.
func TestDashboard_HistoryCacheKeyedByCompanyOnly(t *testing.T) {
	fx := newHistoryFixture()
	ctx := context.Background()
	for _, viewer := range []Viewer{{UserID: uuid.New(), Owner: true}, {UserID: fx.u}, {UserID: uuid.New()}} {
		for _, raw := range []string{"", "window=7", "window=90"} {
			if _, err := fx.svc.DashboardSummary(ctx, fx.company, viewer, raw); err != nil {
				t.Fatal(err)
			}
			if _, err := fx.svc.DashboardVacancies(ctx, fx.company, viewer, raw); err != nil {
				t.Fatal(err)
			}
		}
	}
	other := uuid.New()
	if _, err := fx.svc.DashboardRecent(ctx, other, Viewer{UserID: uuid.New(), Owner: true}, ""); err != nil {
		t.Fatal(err)
	}
	if fx.store.loads[fx.company] != 1 || fx.store.loads[other] != 1 {
		t.Fatalf("loads %v", fx.store.loads)
	}
	// The history starts 182 local days before as_of.
	if want := time.Date(2025, 9, 23, 0, 0, 0, 0, zone); !fx.store.since.Equal(want) {
		t.Fatalf("since %v, want %v", fx.store.since, want)
	}
}

func TestDashboardVacancies_TopByInProcessWithPositions(t *testing.T) {
	fx := newHistoryFixture()
	got, err := fx.svc.DashboardVacancies(context.Background(), fx.company, Viewer{UserID: uuid.New(), Owner: true}, "")
	if err != nil {
		t.Fatal(err)
	}
	// Published now: A (p2, p3, p4 and the retired one) and B (one); C is
	// paused, D closed.
	want := []ActiveVacancy{
		{Vacancy: VacancyRef{DraftID: fx.a.ID, Title: "Analista", Kind: KindOriginal, RootDraftID: fx.a.ID}, InProcess: 4, Positions: Positions{1, 3}},
		{Vacancy: VacancyRef{DraftID: fx.b.ID, Title: "Backend", Kind: KindOriginal, RootDraftID: fx.b.ID}, InProcess: 1, Positions: Positions{2, 0}},
	}
	if !reflect.DeepEqual(got.Top, want) {
		t.Fatalf("%+v", got.Top)
	}
}

func TestWeekEnd_MondayToSunday(t *testing.T) {
	for date, want := range map[string]string{
		"2026-03-23": "2026-03-29", // Monday
		"2026-03-24": "2026-03-29",
		"2026-03-28": "2026-03-29", // Saturday
		"2026-03-29": "2026-03-29", // Sunday covers only Sunday
		"2026-03-30": "2026-04-05",
	} {
		if got := weekEnd(date); got != want {
			t.Errorf("%s: %s, want %s", date, got, want)
		}
	}
}

func TestParseWindow_Strict(t *testing.T) {
	for raw, want := range map[string]int{"": 30, "window=7": 7, "window=30": 30, "window=90": 90} {
		if got, err := ParseWindow(raw); err != nil || got != want {
			t.Errorf("%q: %d %v", raw, got, err)
		}
	}
	for raw, want := range map[string][]Field{
		"window=14":          {{"window", "invalid"}},
		"window=":            {{"window", "invalid"}},
		"window=7&window=7":  {{"window", "duplicate"}},
		"from=2026-01-01":    {{"from", "unknown"}},
		"recruiter_id=x&w=1": {{"recruiter_id", "unknown"}, {"w", "unknown"}},
	} {
		_, err := ParseWindow(raw)
		f, ok := err.(*InvalidFilter)
		if !ok || !reflect.DeepEqual(f.Fields, want) {
			t.Errorf("%q: %v", raw, err)
		}
	}
}
