package application

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

// deliveryVacancy is an open vacancy with a configured, unfulfilled delivery.
func (fx *historyFixture) deliveryVacancy(title, commitment string, target int) *HistoryVacancy {
	v := historyVacancy(title, "2026-01-05T16:00:00Z", stagedPipeline(nil))
	v.Delivery = DeliveryFacts{Configured: true, Commitment: ptr(commitment), Target: ptr(target)}
	v.Tramos = []Tramo{{ID: uuid.New(), UserID: fx.u, Start: at("2026-01-05T16:00:00Z")}}
	fx.store.history[fx.company].Vacancies = append(fx.store.history[fx.company].Vacancies, v)
	return v
}

func attentionTitles(rows []AttentionDelivery) []string {
	out := []string{}
	for _, r := range rows {
		out = append(out, r.Vacancy.Title)
	}
	return out
}

func (fx *historyFixture) attention(t *testing.T, viewer Viewer) *AttentionSection {
	t.Helper()
	out, err := fx.svc.DashboardAttention(context.Background(), fx.company, viewer, "")
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// As of Tuesday 2026-03-24 (Monday 03-16 a holiday): overdue before today,
// due this week from today through Sunday 03-29; fulfilled, unconfigured,
// closed and next week's deliveries are neither.
func TestDashboardAttention_OverdueAndDueThisWeek(t *testing.T) {
	fx := newHistoryFixture()
	owner := Viewer{UserID: uuid.New(), Owner: true}
	o1 := fx.deliveryVacancy("Uno", "2026-03-13", 4) // Friday: 6 business days (holiday)
	o1.Entries = []Entry{{ParticipationID: uuid.New()}, {ParticipationID: uuid.New()}}
	fx.deliveryVacancy("dos", "2026-03-23", 2)  // 1 business day
	fx.deliveryVacancy("Tres", "2026-03-23", 2) // tie by title
	fx.deliveryVacancy("Hoy", "2026-03-24", 1)
	fx.deliveryVacancy("Domingo", "2026-03-29", 1)
	fx.deliveryVacancy("Lunes", "2026-03-30", 1) // next week
	f := fx.deliveryVacancy("Cumplida", "2026-03-20", 1)
	f.Delivery.TargetReachedAt = ptr(at("2026-03-19T18:00:00Z"))
	c := fx.deliveryVacancy("Cerrada", "2026-03-20", 1)
	c.Status = "closed"
	p := fx.deliveryVacancy("Pausada", "2026-03-25", 1)
	p.Status = "paused" // paused is open
	n := fx.deliveryVacancy("Sin config", "2026-03-25", 1)
	n.Delivery.Configured = false
	got := fx.attention(t, owner)
	if got.Overdue.Total != 3 || got.DueThisWeek.Total != 3 {
		t.Fatalf("totals %d %d: %v %v", got.Overdue.Total, got.DueThisWeek.Total, attentionTitles(got.Overdue.Top), attentionTitles(got.DueThisWeek.Top))
	}
	if g := attentionTitles(got.Overdue.Top); g[0] != "Uno" || g[1] != "dos" || g[2] != "Tres" {
		t.Fatalf("overdue order %v", g)
	}
	if r := got.Overdue.Top[0]; *r.BusinessDaysOverdue != 6 || r.Delivered != 2 || r.Target != 4 || r.CommitmentDate != "2026-03-13" {
		t.Fatalf("%+v", r)
	}
	if g := attentionTitles(got.DueThisWeek.Top); g[0] != "Hoy" || g[1] != "Pausada" || g[2] != "Domingo" {
		t.Fatalf("due order %v", g)
	}
	if got.DueThisWeek.Top[0].BusinessDaysOverdue != nil {
		t.Fatal("due rows carry no business_days_overdue")
	}
	// A recruiter sees only their own vacancies: none of these is theirs
	// once their tramos are gone.
	for _, v := range fx.store.history[fx.company].Vacancies {
		v.Tramos = nil
	}
	if r := fx.attention(t, Viewer{UserID: fx.u}); r.Overdue.Total != 0 || r.DueThisWeek.Total != 0 || r.Scope != "own_vacancies" {
		t.Fatalf("%+v", r)
	}
}

// On Sunday the week covers only Sunday; Saturday is already overdue.
func TestDashboardAttention_SundayCoversOnlySunday(t *testing.T) {
	fx := newHistoryFixture()
	fx.svc.WithClock(func() time.Time { return at("2026-03-29T18:00:00Z") })
	fx.deliveryVacancy("Sábado", "2026-03-28", 1)
	fx.deliveryVacancy("Domingo", "2026-03-29", 1)
	fx.deliveryVacancy("Lunes", "2026-03-30", 1)
	got := fx.attention(t, Viewer{UserID: uuid.New(), Owner: true})
	if g := attentionTitles(got.DueThisWeek.Top); len(g) != 1 || g[0] != "Domingo" {
		t.Fatalf("due %v", g)
	}
	// Saturday to Sunday: no business day in (sat, sun].
	if g := got.Overdue.Top; len(g) != 1 || g[0].Vacancy.Title != "Sábado" || *g[0].BusinessDaysOverdue != 0 {
		t.Fatalf("overdue %+v", g)
	}
}

// Stalled comes from the pipeline snapshot (DV1), scoped like the pipeline
// section, most days first, top 5 with the total.
func TestDashboardAttention_StalledFromPipeline(t *testing.T) {
	px := newPipelineFixture()
	fx := newHistoryFixture()
	fx.store.pipelineStore = px.store
	fx.svc = NewService(fx.store, holidays("2026-03-16"), func() time.Time { return at(pipelineAsOf) })
	got := fx.attention(t, Viewer{UserID: uuid.New(), Owner: true})
	// p2 (new, 7 days), Sergio (retired, 16), Uriel (custom, 7).
	if got.Stalled.Total != 3 || got.Stalled.ThresholdBusinessDays != 7 || len(got.Stalled.Top) != 3 {
		t.Fatalf("%+v", got.Stalled)
	}
	if top := got.Stalled.Top[0]; top.ParticipationID != px.p5 || top.Stage.Kind != "retired" || top.Stage.Name != "Vieja" {
		t.Fatalf("%+v", top)
	}
	if got.Stalled.Top[1].Candidate.FullName != "Pablo" || got.Stalled.Top[2].Candidate.FullName != "Uriel" {
		t.Fatalf("ties by candidate: %+v", got.Stalled.Top)
	}
	// Recruiter u has an open tramo on A only.
	mine := fx.attention(t, Viewer{UserID: px.u})
	if mine.Stalled.Total != 2 {
		t.Fatalf("%+v", mine.Stalled)
	}
	pipe, err := fx.svc.DashboardPipeline(context.Background(), fx.company, Viewer{UserID: px.u}, "window=90")
	if err != nil {
		t.Fatal(err)
	}
	stalled := 0
	for _, s := range pipe.Stages {
		stalled += s.Stalled
	}
	if stalled != mine.Stalled.Total || pipe.Window.Days != 90 || pipe.StalledThreshold != 7 {
		t.Fatalf("pipeline %+v", pipe)
	}
}

func TestDashboardRecentAndOrigin_Scoped(t *testing.T) {
	fx := newHistoryFixture()
	mk := func(v *HistoryVacancy, stage uuid.UUID, when string) RecentRow {
		r := RecentRow{ParticipationID: uuid.New(), Stage: RecentStage{ID: stage}, Source: "organic", AppliedAt: at(when)}
		v.Recent = append(v.Recent, r)
		return r
	}
	fx.a.Pipeline.ExitName = "Descartados"
	r1 := mk(fx.a, fx.a.Pipeline.Exit, "2026-03-24T10:00:00Z")
	mk(fx.b, fx.b.Pipeline.stage("SCREENING"), "2026-03-24T11:00:00Z")
	r3 := mk(fx.a, fx.a.Pipeline.stage("Vieja"), "2026-03-23T10:00:00Z")
	for i := 0; i < 4; i++ {
		mk(fx.c, fx.c.Pipeline.stage("NEW"), "2026-03-20T10:00:00Z")
	}
	all, err := fx.svc.DashboardRecent(context.Background(), fx.company, Viewer{UserID: uuid.New(), Owner: true}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Recent) != 5 || all.Recent[0].Vacancy.Title != "Backend" || all.Recent[1].ParticipationID != r1.ParticipationID {
		t.Fatalf("%+v", all.Recent)
	}
	mine, _ := fx.svc.DashboardRecent(context.Background(), fx.company, Viewer{UserID: fx.u}, "")
	if len(mine.Recent) != 2 || mine.Recent[0].ParticipationID != r1.ParticipationID || mine.Recent[1].ParticipationID != r3.ParticipationID {
		t.Fatalf("%+v", mine.Recent)
	}
	if s := mine.Recent[0].Stage; s.Kind != "discarded" || s.Name != "Descartados" {
		t.Fatalf("exit stage %+v", s)
	}
	if s := mine.Recent[1].Stage; s.Kind != "custom" || s.Name != "Vieja" || mine.Recent[1].Vacancy.ID != fx.a.ID {
		t.Fatalf("retired stage %+v", mine.Recent[1])
	}

	// Origin: one point per window day, by creation date (local), manual vs
	// every other channel, any state.
	fx.a.Tracks[0].Channel = "manual"                                                                                                    // created 03-10: outside window 7
	fx.a.Tracks[4].Channel = "careers_site"                                                                                              // created 03-23 local 01:00
	fx.c.Tracks[0].Channel = "manual"                                                                                                    // 03-19
	fx.c.Tracks = append(fx.c.Tracks, Track{ID: uuid.New(), CreatedAt: at("2026-03-24T05:00:00Z"), Channel: "unknown", Discarded: true}) // 03-23 local
	o, err := fx.svc.DashboardOrigin(context.Background(), fx.company, Viewer{UserID: uuid.New(), Owner: true}, "window=7")
	if err != nil {
		t.Fatal(err)
	}
	if len(o.ByDay) != 7 || o.ByDay[0].Date != "2026-03-18" || o.ByDay[6].Date != "2026-03-24" {
		t.Fatalf("%+v", o.ByDay)
	}
	if o.ByDay[1] != (OriginDay{"2026-03-19", 0, 1}) || o.ByDay[5] != (OriginDay{"2026-03-23", 2, 0}) {
		t.Fatalf("%+v", o.ByDay)
	}
	mo, _ := fx.svc.DashboardOrigin(context.Background(), fx.company, Viewer{UserID: fx.u}, "window=7")
	if mo.ByDay[1] != (OriginDay{"2026-03-19", 0, 0}) || mo.ByDay[5] != (OriginDay{"2026-03-23", 1, 0}) {
		t.Fatalf("recruiter %+v", mo.ByDay)
	}
}

// A carried participation (replacement process) is not a new application:
// the origin chart and the applications list skip it, while the operational
// figures (in process, candidates list) keep counting it.
func TestDashboard_CarriedParticipationIsNotAnApplication(t *testing.T) {
	fx := newHistoryFixture()
	ctx := context.Background()
	owner := Viewer{UserID: uuid.New(), Owner: true}
	origin := func(viewer Viewer) []OriginDay {
		o, err := fx.svc.DashboardOrigin(ctx, fx.company, viewer, "window=7")
		if err != nil {
			t.Fatal(err)
		}
		return o.ByDay
	}
	apps := func(viewer Viewer, raw string) *DashboardList[ApplicationRow, ApplicationFacets] {
		out, err := fx.svc.DashboardApplicationList(ctx, fx.company, viewer, raw)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	inProcess := func(viewer Viewer) int {
		v, err := fx.svc.DashboardVacancies(ctx, fx.company, viewer, "")
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range v.Top {
			if r.Vacancy.DraftID == fx.a.ID {
				return r.InProcess
			}
		}
		t.Fatal("Analista not listed")
		return 0
	}
	recruiter := Viewer{UserID: fx.u}
	baseOwner, baseMine := origin(owner), origin(recruiter)
	baseApps, baseMineApps := apps(owner, "window=7&from=2026-03-18&to=2026-03-24"), apps(recruiter, "window=7&from=2026-03-18&to=2026-03-24")
	baseInProcess := inProcess(owner)
	baseCandidates := dashCandidates(t, fx.svc, fx.company, owner, "in_process=true&on=2026-03-24&limit=100").Total

	// Two carried rows (portal and manual channels) in process on Analista, one
	// on Cajero, and one on Diseño, a vacancy with no other participation.
	carriedAnalista := fx.a.track([3]string{"intake", "SCREENING", "2026-03-23T18:00:00Z"})
	carriedAnalista.Carried = true
	manual := fx.a.track([3]string{"intake", "IN_PROCESS", "2026-03-22T18:00:00Z"})
	manual.Carried, manual.Channel = true, "manual"
	carriedCajero := fx.c.track([3]string{"intake", "SCREENING", "2026-03-23T18:00:00Z"})
	carriedCajero.Carried = true
	carriedDiseno := fx.d.track([3]string{"intake", "SCREENING", "2026-03-23T18:00:00Z"})
	carriedDiseno.Carried = true

	if got := origin(owner); !reflect.DeepEqual(got, baseOwner) {
		t.Fatalf("owner origin counts carried rows: %+v, want %+v", got, baseOwner)
	}
	if got := origin(recruiter); !reflect.DeepEqual(got, baseMine) {
		t.Fatalf("recruiter origin counts carried rows: %+v, want %+v", got, baseMine)
	}
	for _, c := range []struct {
		viewer Viewer
		base   *DashboardList[ApplicationRow, ApplicationFacets]
	}{{owner, baseApps}, {recruiter, baseMineApps}} {
		got := apps(c.viewer, "window=7&from=2026-03-18&to=2026-03-24")
		if got.Total != c.base.Total || !reflect.DeepEqual(got.Items, c.base.Items) {
			t.Fatalf("applications count carried rows: %d %+v, want %d %+v", got.Total, got.Items, c.base.Total, c.base.Items)
		}
	}
	for _, r := range apps(owner, "window=7&from=2026-03-18&to=2026-03-24").Items {
		if r.Vacancy.DraftID == fx.d.ID {
			t.Fatalf("a vacancy with only carried rows is listed: %+v", r)
		}
	}
	if manualOnly := apps(owner, "window=7&from=2026-03-22&to=2026-03-22&channel=manual"); manualOnly.Total != 0 {
		t.Fatalf("carried manual row counted as an application: %+v", manualOnly)
	}

	if got := inProcess(owner); got != baseInProcess+2 {
		t.Fatalf("in process = %d, want %d: carried rows keep counting", got, baseInProcess+2)
	}
	list := dashCandidates(t, fx.svc, fx.company, owner, "in_process=true&on=2026-03-24&limit=100")
	if list.Total != baseCandidates+2 { // Cajero (paused) and Diseño (closed) are not published on that day
		t.Fatalf("candidates in process = %d, want %d", list.Total, baseCandidates+2)
	}
	found := false
	for _, r := range list.Items {
		found = found || r.ParticipationID == carriedAnalista.ID
	}
	if !found {
		t.Fatal("carried participation missing from the candidates list")
	}
}
