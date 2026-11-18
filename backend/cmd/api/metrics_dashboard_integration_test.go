//go:build integration

package main

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Company dashboard v2 sections (company-dashboard-v2 §3) through the
// production router. "now" is Tuesday 2026-03-24 12:00 in Mexico City; window
// 7 is 03-18..03-24 with the previous end point 03-17.

var mxDashboardRoutes = []string{"summary", "attention", "pipeline", "vacancies", "recent", "origin"}

type mxDashboard struct {
	*mxFixture
	ana, beto               uuid.UUID
	anaActor, betoActor     draftFlowActor
	stakeholderActor        draftFlowActor
	a, b, c, d              uuid.UUID
	pa1, pa2, pa3, pb1, pc1 uuid.UUID
	pd1                     uuid.UUID
}

func newMXDashboard(t *testing.T, h *draftFlowHarness) *mxDashboard {
	t.Helper()
	h.metrics.WithClock(func() time.Time { return mxAt("2026-03-24T18:00:00Z") })
	t.Cleanup(func() { h.metrics.WithClock(time.Now) })
	s := &mxDashboard{mxFixture: newMXFixture(t, h)}
	s.ana, s.anaActor = s.member("recruiter", "Ana")
	s.beto, s.betoActor = s.member("recruiter", "Beto")
	_, s.stakeholderActor = s.member("stakeholder", "Sofía")
	jan := mxAt("2026-01-05T16:00:00Z")

	// A: Ana responsible; headcount 3; delivery overdue since Friday 03-20.
	s.a = s.draft("Analista", &jan, nil, nil, "with_responsible")
	s.stay(s.a, s.ana, "responsible", jan, nil)
	s.management(s.a, mxPtr(3), nil)
	aStage := mxStages(pipelineconfig.Defaults(s.a))
	s.delivery(s.a, aStage["screening"], 5, "2026-03-20")
	s.pa1 = s.apply(s.a, aStage["new"], "Pía Uno", "portal", mxAt("2026-03-12T18:00:00Z"))
	s.move(s.pa1, aStage["new"], aStage["screening"], s.ana, mxAt("2026-03-19T20:00:00Z"))
	s.move(s.pa1, aStage["screening"], aStage["placement"], s.ana, mxAt("2026-03-22T18:00:00Z"))
	s.credit(s.a, s.pa1, mxAt("2026-03-22T18:00:00Z"), "active")
	s.pa2 = s.apply(s.a, aStage["screening"], "Pablo Dos", "portal", mxAt("2026-03-01T18:00:00Z"))
	s.discardRow(s.pa2, aStage["screening"], aStage["exit"], mxAt("2026-03-20T18:00:00Z"))
	s.recover(s.pa2, aStage["exit"], aStage["in_process"], mxAt("2026-03-23T18:00:00Z"))
	s.exec(`UPDATE process_participations SET previous_stage_id=NULL, reason_group=NULL, reason_code=NULL, discarded_at=NULL WHERE id=$1`, s.pa2)
	s.pa3 = s.apply(s.a, aStage["new"], "Pedro Tres", "portal", mxAt("2026-02-20T18:00:00Z")) // stalled in new

	// B: Beto responsible; closed 03-20, reopened 03-23; due this week.
	s.b = s.draft("Backend", &jan, nil, nil, "with_responsible")
	s.stay(s.b, s.beto, "responsible", jan, nil)
	bStage := mxStages(pipelineconfig.Defaults(s.b))
	s.delivery(s.b, bStage["screening"], 1, "2026-03-26")
	s.pb1 = s.apply(s.b, bStage["in_process"], "Beatriz Secreta", "portal", mxAt("2026-03-01T17:00:00Z"))
	s.lifecycle(s.b, "close", mxAt("2026-03-20T18:00:00Z"), mxPtr("cancelled"))
	s.lifecycle(s.b, "reopen", mxAt("2026-03-23T18:00:00Z"), nil)

	// C: published 03-19, paused 03-22; nobody's tramo.
	s.c = s.draft("Cajero", mxPtr(mxAt("2026-03-19T18:00:00Z")), nil, nil, "with_responsible")
	s.management(s.c, mxPtr(2), nil)
	s.pc1 = s.apply(s.c, mxStages(pipelineconfig.Defaults(s.c))["screening"], "Carla Cuatro", "manual", mxAt("2026-03-19T18:00:00Z"))
	s.lifecycle(s.c, "pause", mxAt("2026-03-22T18:00:00Z"), nil)
	s.exec(`UPDATE vacancy_processes SET status='paused', paused_at=$2 WHERE id=$1`, s.c, mxAt("2026-03-22T18:00:00Z"))

	// D: closed for good on 03-18; a late application still counts in origin.
	s.d = s.draft("Diseño", &jan, nil, nil, "with_responsible")
	s.lifecycle(s.d, "close", mxAt("2026-03-18T18:00:00Z"), mxPtr("filled"))
	s.exec(`UPDATE vacancy_processes SET status='closed', closed_at=$2 WHERE id=$1`, s.d, mxAt("2026-03-18T18:00:00Z"))
	s.pd1 = s.apply(s.d, mxStages(pipelineconfig.Defaults(s.d))["new"], "Diego Cinco", "careers_site", mxAt("2026-03-23T07:00:00Z"))
	return s
}

// discardRow writes the discard history row and the participation's state.
func (f *mxFixture) discardRow(participation, from, exit uuid.UUID, at time.Time) {
	f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,event_kind,from_stage_id,actor_kind,reason_group,reason_code) VALUES($1,$2,$3,$4,$5,'discard',$6,'recruiter','recruiter','profile_mismatch')`,
		uuid.New(), participation, exit, f.ownerID, at, from)
	f.discard(participation, exit, at)
}

func (s *mxDashboard) dash(actor draftFlowActor, route string) map[string]any {
	s.t.Helper()
	r := s.h.do(s.t, "GET", "/v2/me/company/dashboard/"+route, "", actor.token, nil)
	if r.status != 200 {
		s.t.Fatalf("GET %s: %d %s", route, r.status, r.body)
	}
	draftFlowAssertNoStore(s.t, r)
	return draftFlowObject(s.t, r.body)
}

func mxSeries(body map[string]any) string {
	var parts []string
	for _, p := range body["in_process"].(map[string]any)["series"].([]any) {
		pt := p.(map[string]any)
		parts = append(parts, fmt.Sprintf("%s=%d", pt["date"].(string)[5:], mxNum(pt["value"])))
	}
	return strings.Join(parts, " ")
}

func TestDashboardV2_Gate(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	for _, route := range mxDashboardRoutes {
		path := "/v2/me/company/dashboard/" + route
		r := h.do(t, "GET", path, "", s.stakeholderActor.token, nil)
		shAssertBody(t, r, 403, map[string]any{"error": "insufficient role", "code": "forbidden"})
		draftFlowAssertNoStore(t, r)
		draftFlowAssertCatalogError(t, h.do(t, "GET", path, "", "", nil), 401, "unauthenticated")
		for _, actor := range []draftFlowActor{s.owner, s.anaActor} {
			if r := h.do(t, "GET", path+"?window=90", "", actor.token, nil); r.status != 200 {
				t.Fatalf("%s: %d %s", route, r.status, r.body)
			}
		}
		// A recruiter cannot widen the scope: no filter but window exists.
		for query, field := range map[string]map[string]any{
			"recruiter_id=" + s.beto.String(): {"field": "recruiter_id", "code": "unknown"},
			"scope=company":                   {"field": "scope", "code": "unknown"},
			"window=14":                       {"field": "window", "code": "invalid"},
			"window=7&window=7":               {"field": "window", "code": "duplicate"},
		} {
			r := h.do(t, "GET", path+"?"+query, "", s.anaActor.token, nil)
			shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{field}})
		}
	}
	// Another company sees none of this company's dashboard.
	other := newMXFixture(t, h)
	for _, route := range []string{"vacancies", "recent"} {
		r := h.do(t, "GET", "/v2/me/company/dashboard/"+route, "", other.owner.token, nil)
		if r.status != 200 || strings.Contains(string(r.body), "Analista") || strings.Contains(string(r.body), "Pablo") {
			t.Fatalf("%s: %d %s", route, r.status, r.body)
		}
	}
}

func TestDashboardV2_SummaryOwnerAndRecruiter(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	got := s.dash(s.owner, "summary?window=7")
	if got["definitions_version"] != "d2" || got["scope"] != "company" || got["as_of"] != "2026-03-24T18:00:00Z" {
		t.Fatalf("%v", got)
	}
	editJSONEqual(t, got["window"], map[string]any{"days": float64(7), "from": "2026-03-18", "to": "2026-03-24", "previous_from": "2026-03-11", "previous_to": "2026-03-17"})
	// A: pa1 19–21, pa2 17–19 and 23–24 (discarded 20–22); B closed 20–22;
	// C published 19, paused 22.
	if g := mxSeries(got); g != "03-17=2 03-18=2 03-19=4 03-20=2 03-21=2 03-22=0 03-23=2 03-24=2" {
		t.Fatal(g)
	}
	ip := got["in_process"].(map[string]any)
	if ip["current"] != float64(2) || ip["previous"] != float64(2) {
		t.Fatalf("%v", ip)
	}
	editJSONEqual(t, got["published_vacancies"], map[string]any{"current": float64(2), "previous": float64(3)})
	editJSONEqual(t, got["positions"], map[string]any{"covered": float64(1), "required": float64(3)})
	// Pool: 03-19 and 03-23 additions now, 03-12 before (company-wide).
	editJSONEqual(t, got["pool_added"], map[string]any{"current": float64(2), "previous": float64(1)})

	ana := s.dash(s.anaActor, "summary?window=7")
	if ana["scope"] != "own_vacancies" || mxSeries(ana) != "03-17=1 03-18=1 03-19=2 03-20=1 03-21=1 03-22=0 03-23=1 03-24=1" {
		t.Fatalf("%v %s", ana["scope"], mxSeries(ana))
	}
	editJSONEqual(t, ana["published_vacancies"], map[string]any{"current": float64(1), "previous": float64(1)})
	editJSONEqual(t, ana["positions"], map[string]any{"covered": float64(1), "required": float64(3)})
	editJSONEqual(t, ana["pool_added"], map[string]any{"current": float64(2), "previous": float64(1)})
	beto := s.dash(s.betoActor, "summary?window=7")
	if mxSeries(beto) != "03-17=1 03-18=1 03-19=1 03-20=0 03-21=0 03-22=0 03-23=1 03-24=1" {
		t.Fatal(mxSeries(beto))
	}
	// Default window 30: 31 points.
	if n := len(s.dash(s.owner, "summary")["in_process"].(map[string]any)["series"].([]any)); n != 31 {
		t.Fatal(n)
	}
	// Without talent-base access pool_added is null; Ana listed keeps it.
	s.exec(`INSERT INTO company_talent_base_settings(company_id,mode) VALUES($1,'selected_users')`, s.company.companyID)
	s.exec(`INSERT INTO company_talent_base_viewers(company_id,user_id,added_at,added_by) VALUES($1,$2,now(),$3)`, s.company.companyID, s.ana, s.ownerID)
	if v, ok := s.dash(s.betoActor, "summary?window=7")["pool_added"]; !ok || v != nil {
		t.Fatalf("beto pool_added %v", v)
	}
	if s.dash(s.anaActor, "summary?window=7")["pool_added"] == nil || s.dash(s.owner, "summary?window=7")["pool_added"] == nil {
		t.Fatal("listed viewer or owner lost pool_added")
	}
}

func TestDashboardV2_AttentionPipelineVacancies(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	att := s.dash(s.owner, "attention")
	overdue := att["overdue"].(map[string]any)
	if overdue["total"] != float64(1) {
		t.Fatalf("%v", overdue)
	}
	row := overdue["top"].([]any)[0].(map[string]any)
	editJSONEqual(t, row, map[string]any{"vacancy": map[string]any{"draft_id": s.a.String(), "title": "Analista"}, "requester": nil,
		"responsible": mxPerson(s.ana, "Ana", false), "commitment_date": "2026-03-20", "business_days_overdue": float64(2), "delivered": float64(2), "target": float64(5)})
	due := att["due_this_week"].(map[string]any)
	if due["total"] != float64(1) || due["top"].([]any)[0].(map[string]any)["vacancy"].(map[string]any)["title"] != "Backend" {
		t.Fatalf("%v", due)
	}
	if _, ok := due["top"].([]any)[0].(map[string]any)["business_days_overdue"]; ok {
		t.Fatal("due row with business_days_overdue")
	}
	stalled := att["stalled"].(map[string]any)
	top := stalled["top"].([]any)
	if stalled["total"] != float64(2) || stalled["threshold_business_days"] != float64(7) || len(top) != 2 ||
		top[0].(map[string]any)["participation_id"] != s.pa3.String() || top[1].(map[string]any)["participation_id"] != s.pb1.String() {
		t.Fatalf("%v", stalled)
	}
	// Ana: her vacancy only; never Beto's candidates.
	ana := s.dash(s.anaActor, "attention")
	if ana["overdue"].(map[string]any)["total"] != float64(1) || ana["due_this_week"].(map[string]any)["total"] != float64(0) || ana["stalled"].(map[string]any)["total"] != float64(1) {
		t.Fatalf("%v", ana)
	}
	if strings.Contains(fmt.Sprint(ana), "Beatriz") || strings.Contains(fmt.Sprint(ana), "Backend") {
		t.Fatalf("recruiter sees another's vacancy: %v", ana)
	}

	stages := func(body map[string]any) string {
		var parts []string
		for _, raw := range body["stages"].([]any) {
			st := raw.(map[string]any)
			parts = append(parts, fmt.Sprintf("%s=%d/%d", st["kind"], mxNum(st["candidates"]), mxNum(st["stalled"])))
		}
		return strings.Join(parts, " ")
	}
	pipe := s.dash(s.owner, "pipeline")
	if _, ok := pipe["top_vacancies"]; ok || pipe["stalled_threshold_business_days"] != float64(7) {
		t.Fatalf("%v", pipe)
	}
	// Open vacancies A, B and paused C; closed D out.
	if g := stages(pipe); g != "new=1/1 screening=1/0 screening_ok=0/0 in_process=2/1 custom=0/0 placement=1/0" {
		t.Fatal(g)
	}
	if g := stages(s.dash(s.anaActor, "pipeline")); g != "new=1/1 screening=0/0 screening_ok=0/0 in_process=1/0 custom=0/0 placement=1/0" {
		t.Fatal(g)
	}
	if g := stages(s.dash(s.betoActor, "pipeline")); g != "new=0/0 screening=0/0 screening_ok=0/0 in_process=1/1 custom=0/0 placement=0/0" {
		t.Fatal(g)
	}

	vac := s.dash(s.owner, "vacancies")
	editJSONEqual(t, vac["top"], mxJSON(t, []any{
		map[string]any{"vacancy": map[string]any{"draft_id": s.a.String(), "title": "Analista"}, "requester": nil, "responsible": mxPerson(s.ana, "Ana", false),
			"in_process": 1, "positions": map[string]any{"covered": 1, "required": 3}},
		map[string]any{"vacancy": map[string]any{"draft_id": s.b.String(), "title": "Backend"}, "requester": nil, "responsible": mxPerson(s.beto, "Beto", false),
			"in_process": 1, "positions": map[string]any{"covered": 0, "required": 0}},
	}))
	if top := s.dash(s.betoActor, "vacancies")["top"].([]any); len(top) != 1 || top[0].(map[string]any)["vacancy"].(map[string]any)["title"] != "Backend" {
		t.Fatalf("%v", top)
	}
}

func TestDashboardV2_RecentAndOrigin(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	ids := func(body map[string]any) []string {
		out := []string{}
		for _, r := range body["recent"].([]any) {
			out = append(out, r.(map[string]any)["participation_id"].(string))
		}
		return out
	}
	recent := s.dash(s.owner, "recent")
	if g := ids(recent); fmt.Sprint(g) != fmt.Sprint([]string{s.pd1.String(), s.pc1.String(), s.pa1.String(), s.pa2.String(), s.pb1.String()}) {
		t.Fatalf("%v", g)
	}
	first := recent["recent"].([]any)[0].(map[string]any)
	stage := first["stage"].(map[string]any)
	if first["source"] != "organic" || first["added_by"] != nil || first["applied_at"] != "2026-03-23T07:00:00Z" ||
		first["vacancy"].(map[string]any)["id"] != s.d.String() || stage["kind"] != "new" || stage["name"] == "" ||
		first["candidate"].(map[string]any)["kind"] != "organic" || first["candidate"].(map[string]any)["name"] != "Diego Cinco" {
		t.Fatalf("%v", first)
	}
	if g := ids(s.dash(s.anaActor, "recent")); fmt.Sprint(g) != fmt.Sprint([]string{s.pa1.String(), s.pa2.String(), s.pa3.String()}) {
		t.Fatalf("%v", g)
	}
	if body := s.dash(s.betoActor, "recent"); fmt.Sprint(ids(body)) != fmt.Sprint([]string{s.pb1.String()}) || strings.Contains(fmt.Sprint(body), "Pablo") {
		t.Fatalf("%v", body)
	}

	days := func(body map[string]any) map[string]string {
		out := map[string]string{}
		for _, raw := range body["by_day"].([]any) {
			d := raw.(map[string]any)
			if mxNum(d["organic"])+mxNum(d["manual"]) > 0 {
				out[d["date"].(string)] = fmt.Sprintf("%d/%d", mxNum(d["organic"]), mxNum(d["manual"]))
			}
		}
		return out
	}
	o := s.dash(s.owner, "origin?window=7")
	if n := len(o["by_day"].([]any)); n != 7 {
		t.Fatal(n)
	}
	if g := days(o); fmt.Sprint(g) != fmt.Sprint(map[string]string{"2026-03-19": "0/1", "2026-03-23": "1/0"}) {
		t.Fatalf("%v", g)
	}
	if g := days(s.dash(s.anaActor, "origin?window=30")); fmt.Sprint(g) != fmt.Sprint(map[string]string{"2026-03-01": "1/0", "2026-03-12": "1/0"}) {
		t.Fatalf("%v", g)
	}
	if g := days(s.dash(s.anaActor, "origin?window=7")); len(g) != 0 {
		t.Fatalf("%v", g)
	}
}

// The 7-day pool_added equals the old dashboard's pool_added_last_7_days on
// the same data when no addition sits between the rolling now()-7 days and
// the local-day boundary (dashboard-v2.md documents the difference).
func TestDashboardV2_PoolAddedMatchesOldDashboard(t *testing.T) {
	h := newDraftFlowHarness(t)
	f := newMXFixture(t, h)
	now := time.Now()
	jan := now.AddDate(0, -2, 0)
	v := f.draft("Pool", &jan, nil, nil, "with_responsible")
	stage := mxStages(pipelineconfig.Defaults(v))["new"]
	f.apply(v, stage, "Hace una hora", "portal", now.Add(-time.Hour))
	f.apply(v, stage, "Hace dos días", "portal", now.Add(-48*time.Hour))
	f.apply(v, stage, "Hace diez días", "portal", now.Add(-240*time.Hour))
	// The old route's pool figure, through the function it composes (the
	// integration harness does not wire the old dashboard handler).
	tx, err := h.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	old, err := dashboardPoolAdded(t.Context(), tx, f.company.companyID, f.ownerID)
	if err != nil || old == nil {
		t.Fatalf("%v %v", old, err)
	}
	summary := draftFlowObject(t, h.do(t, "GET", "/v2/me/company/dashboard/summary?window=7", "", f.owner.token, nil).body)
	current := summary["pool_added"].(map[string]any)["current"]
	if *old != 2 || current != float64(*old) {
		t.Fatalf("old %v, new %v", *old, current)
	}
}
