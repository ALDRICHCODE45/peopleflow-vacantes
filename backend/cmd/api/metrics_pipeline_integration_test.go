//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Pipeline section, candidates and applications lists (stakeholder-metrics-v2
// §4.4, §5.5, §5.6) through the production router. "now" is Tuesday
// 2026-03-24; "long ago" entries are weeks old (stalled), "recent" ones one
// business day old.

const mxPipelineRange = "from=2026-03-01&to=2026-03-31"

var mxPipelineRoutes = []string{"pipeline", "candidates", "applications", "candidates/export", "applications/export"}

type mxPipeline struct {
	*mxFixture
	ana, stakeholder           uuid.UUID
	anaActor, stakeholderActor draftFlowActor
	acme                       uuid.UUID
	a, b, closed               uuid.UUID
	aStage, bStage             map[string]uuid.UUID
	bExit                      uuid.UUID
	p1, p2, p3, p4, p5, p6     uuid.UUID
	q1, q2, q3                 uuid.UUID
}

func mxStages(config pipelineconfig.Configuration) map[string]uuid.UUID {
	out := map[string]uuid.UUID{"exit": uuid.MustParse(config.Exit.ID)}
	for _, s := range append(config.Stages, config.RetiredStages()...) {
		key := s.Kind
		if s.Kind == "custom" {
			key = s.Name
		}
		out[key] = uuid.MustParse(s.ID)
	}
	return out
}

func newMXPipeline(t *testing.T, h *draftFlowHarness) *mxPipeline {
	t.Helper()
	h.metrics.WithClock(func() time.Time { return mxAt("2026-03-24T18:00:00Z") })
	t.Cleanup(func() { h.metrics.WithClock(time.Now) })
	s := &mxPipeline{mxFixture: newMXFixture(t, h)}
	s.ana, s.anaActor = s.member("recruiter", "Ana")
	s.stakeholder, s.stakeholderActor = s.member("stakeholder", "Sofía")
	s.acme = s.requester("client", "Acme")
	longAgo, recent := mxAt("2026-02-20T18:00:00Z"), mxAt("2026-03-23T18:00:00Z")

	// A: default pipeline, Ana responsible.
	s.a = s.draft("Analista", mxPtr(mxAt("2026-01-05T16:00:00Z")), nil, nil, "with_responsible")
	s.stay(s.a, s.ana, "responsible", mxAt("2026-01-05T16:00:00Z"), nil)
	s.aStage = mxStages(pipelineconfig.Defaults(s.a))
	s.p1 = s.apply(s.a, s.aStage["new"], "Pedro Viejo", "portal", longAgo)
	s.history(s.p1, s.aStage["new"], "not_applicable", recent) // never resets the entry
	s.p2 = s.apply(s.a, s.aStage["new"], "Paula", "careers_site", recent)
	s.correct(s.p2, "Paula Corregida")
	s.p3 = s.apply(s.a, s.aStage["new"], "Sub Estado", "portal", longAgo)
	s.history(s.p3, s.aStage["new"], "substate", recent) // never resets the entry
	s.p4 = s.apply(s.a, s.aStage["new"], "Recuperada", "portal", mxAt("2026-02-02T18:00:00Z"))
	s.move(s.p4, s.aStage["new"], s.aStage["screening"], s.ana, longAgo)
	s.recover(s.p4, s.aStage["exit"], s.aStage["screening"], recent) // resets it
	s.p5 = s.apply(s.a, s.aStage["new"], "Colocada", "portal", mxAt("2026-02-02T18:00:00Z"))
	s.move(s.p5, s.aStage["new"], s.aStage["placement"], s.ana, longAgo) // never stalled
	s.p6 = s.apply(s.a, s.aStage["new"], "Descartada", "manual", mxAt("2026-03-10T18:00:00Z"))
	s.discard(s.p6, s.aStage["exit"], mxAt("2026-03-11T18:00:00Z")) // not counted

	// B: stored pipeline with a custom stage and a retired one; Ana's tramo
	// ended before now; requester Acme.
	s.b = s.draft("Backend", mxPtr(mxAt("2026-01-05T16:00:00Z")), mxPtr("client"), &s.acme, "with_responsible")
	s.tramo(s.b, s.ana, mxAt("2026-01-05T16:00:00Z"), mxPtr(mxAt("2026-03-01T18:00:00Z")))
	config := pipelineconfig.Defaults(s.b)
	custom := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Entrevista"}
	config.Stages = append(config.Stages[:4:4], custom, config.Stages[4])
	config.Retired = []pipelineconfig.RetiredStage{{Stage: pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Vieja"}, Position: 4}}
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	s.exec(`INSERT INTO job_draft_pipeline_configs(draft_id,version,configuration) VALUES($1,1,$2)`, s.b, raw)
	s.bStage = mxStages(config)
	s.q1 = s.apply(s.b, s.bStage["Entrevista"], "Quique", "portal", mxAt("2026-03-02T18:00:00Z"))
	s.q2 = s.apply(s.b, s.bStage["Vieja"], "Rita", "unknown", mxAt("2026-03-05T18:00:00Z"))
	s.q3 = s.apply(s.b, s.bStage["in_process"], "Sara", "portal", mxAt("2026-03-20T18:00:00Z"))

	// Closed: out of the pipeline, its March application still counts.
	s.closed = s.draft("Cerrada", mxPtr(mxAt("2026-01-05T16:00:00Z")), nil, nil, "with_responsible")
	s.exec(`UPDATE vacancy_processes SET status='closed', closed_at=$2 WHERE id=$1`, s.closed, mxAt("2026-03-10T18:00:00Z"))
	s.apply(s.closed, mxStages(pipelineconfig.Defaults(s.closed))["new"], "Tomás", "portal", mxAt("2026-03-03T18:00:00Z"))
	return s
}

// history appends a substate or not_applicable row into the current stage.
func (f *mxFixture) history(participation, stage uuid.UUID, kind string, at time.Time) {
	if kind == "substate" {
		f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,event_kind,actor_kind,to_substate_id,to_substate_name) VALUES($1,$2,$3,$4,$5,'substate','recruiter',$6,'Llamada')`,
			uuid.New(), participation, stage, f.ownerID, at, uuid.New())
		return
	}
	f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,event_kind,actor_kind) VALUES($1,$2,$3,$4,$5,$6,'recruiter')`,
		uuid.New(), participation, stage, f.ownerID, at, kind)
}

// recover writes a recovery row from the exit stage into stage.
func (f *mxFixture) recover(participation, exit, stage uuid.UUID, at time.Time) {
	f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,event_kind,from_stage_id,actor_kind) VALUES($1,$2,$3,$4,$5,'recovery',$6,'recruiter')`,
		uuid.New(), participation, stage, f.ownerID, at, exit)
	f.exec(`UPDATE process_participations SET stage_id=$2 WHERE id=$1`, participation, stage)
}

// discard moves a participation to the exit stage.
func (f *mxFixture) discard(participation, exit uuid.UUID, at time.Time) {
	f.exec(`UPDATE process_participations SET previous_stage_id=stage_id, stage_id=$2, reason_group='recruiter', reason_code='profile_mismatch', discarded_at=$3 WHERE id=$1`, participation, exit, at)
}

func TestMetricsPipeline_Gate(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXPipeline(t, h)
	for _, route := range mxPipelineRoutes {
		path := "/v2/me/company/metrics/" + route + "?" + mxPipelineRange
		r := h.do(t, "GET", path, "", s.anaActor.token, nil)
		shAssertBody(t, r, 403, map[string]any{"error": "insufficient role", "code": "forbidden"})
		draftFlowAssertNoStore(t, r)
		draftFlowAssertCatalogError(t, h.do(t, "GET", path, "", "", nil), 401, "unauthenticated")
		for _, actor := range []draftFlowActor{s.owner, s.stakeholderActor} {
			if r := h.do(t, "GET", path, "", actor.token, nil); r.status != 200 {
				t.Fatalf("%s: %d %s", route, r.status, r.body)
			}
		}
		before := s.auditCount("")
		r = h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+mxPipelineRange+"&stalled=maybe", "", s.owner.token, nil)
		code := "unknown"
		if strings.HasPrefix(route, "candidates") {
			code = "invalid"
		}
		shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{map[string]any{"field": "stalled", "code": code}}})
		if s.auditCount("") != before {
			t.Fatalf("%s: rejected request audited", route)
		}
	}
	// Another company sees none of this company's pipeline or applications.
	other := newMXFixture(t, h)
	for _, stage := range other.get(other.owner, "pipeline?"+mxPipelineRange)["stages"].([]any) {
		if mxNum(stage.(map[string]any)["candidates"]) != 0 {
			t.Fatalf("other company pipeline: %v", stage)
		}
	}
	for _, route := range []string{"candidates", "applications"} {
		if body := other.get(other.owner, route+"?"+mxPipelineRange); body["total"] != float64(0) || len(body["items"].([]any)) != 0 {
			t.Fatalf("other company %s: %v", route, body)
		}
	}
	// Nor through another company's vacancy id: empty, title null.
	body := other.get(other.owner, "candidates?"+mxPipelineRange+"&vacancy_id="+s.a.String())
	if body["total"] != float64(0) || strings.Contains(string(mustJSON(t, body)), "Analista") {
		t.Fatalf("%v", body)
	}
	editJSONEqual(t, body["applied_filters"], mxJSON(t, map[string]any{"vacancy": map[string]any{"draft_id": s.a.String(), "title": nil}}))
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestMetricsPipeline_Figures(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXPipeline(t, h)
	got := s.get(s.owner, "pipeline?"+mxPipelineRange)
	if got["as_of"] != "2026-03-24T18:00:00Z" || got["stalled_threshold_business_days"] != float64(7) {
		t.Fatalf("%v", got)
	}
	figures := map[string][2]int{}
	var kinds []string
	for _, raw := range got["stages"].([]any) {
		st := raw.(map[string]any)
		kinds = append(kinds, st["kind"].(string))
		figures[st["kind"].(string)] = [2]int{mxNum(st["candidates"]), mxNum(st["stalled"])}
	}
	// Fixed order, retired last (> 0); discarded and closed vacancies not
	// counted; substate and not_applicable never reset the entry, recovery
	// does; placement never stalls.
	if strings.Join(kinds, ",") != "new,screening,screening_ok,in_process,custom,placement,retired" {
		t.Fatal(kinds)
	}
	want := map[string][2]int{"new": {3, 2}, "screening": {1, 0}, "screening_ok": {0, 0}, "in_process": {1, 0}, "custom": {1, 1}, "placement": {1, 0}, "retired": {1, 1}}
	if fmt.Sprint(figures) != fmt.Sprint(want) {
		t.Fatalf("%v, want %v", figures, want)
	}
	// DD2: new is not in process, so A's three new candidates leave its
	// figure (screening only) and B (custom, retired, in_process) leads.
	editJSONEqual(t, got["top_vacancies"], mxJSON(t, []any{
		map[string]any{"vacancy": map[string]any{"draft_id": s.b.String(), "title": "Backend"}, "requester": map[string]any{"kind": "client", "id": s.acme.String(), "name": "Acme"}, "responsible": nil, "in_process": 3},
		map[string]any{"vacancy": map[string]any{"draft_id": s.a.String(), "title": "Analista"}, "requester": nil, "responsible": mxPerson(s.ana, "Ana", false), "in_process": 1},
	}))
	// The period is echoed, never applied.
	if other := s.get(s.owner, "pipeline?from=2020-01-01&to=2020-01-31"); mxNum(other["stages"].([]any)[0].(map[string]any)["candidates"]) != 3 {
		t.Fatalf("%v", other)
	}
	origin := s.get(s.owner, "origin?"+mxPipelineRange)["by_channel"]
	editJSONEqual(t, origin, mxJSON(t, map[string]any{"portal": 3, "careers_site": 1, "manual": 1, "unknown": 1}))
}

// Every §4.4 figure and every §4.6 origin figure equals the total of its
// drill-down, with and without the common filters.
func TestMetricsPipeline_FigureEqualsTotal(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXPipeline(t, h)
	total := func(kind, query string) int {
		t.Helper()
		return mxNum(s.get(s.owner, kind+"?"+query)["total"])
	}
	nonzero := 0
	for _, common := range []string{"", "&recruiter_id=" + s.ana.String(), "&requester_kind=client", "&requester_kind=client&requester_id=" + s.acme.String(), "&requester_id=none"} {
		base := mxPipelineRange + common
		pipeline := s.get(s.owner, "pipeline?"+base)
		for _, raw := range pipeline["stages"].([]any) {
			st := raw.(map[string]any)
			kind := st["kind"].(string)
			if got := total("candidates", base+"&stage_kind="+kind); got != mxNum(st["candidates"]) {
				t.Fatalf("%s %s: figure %v, total %d", common, kind, st["candidates"], got)
			}
			if got := total("candidates", base+"&stage_kind="+kind+"&stalled=true"); got != mxNum(st["stalled"]) {
				t.Fatalf("%s %s stalled: figure %v, total %d", common, kind, st["stalled"], got)
			}
			nonzero += mxNum(st["candidates"]) + mxNum(st["stalled"])
		}
		for _, raw := range pipeline["top_vacancies"].([]any) {
			v := raw.(map[string]any)
			id := mxAt2(v, "vacancy", "draft_id").(string)
			if got := total("candidates", base+"&vacancy_id="+id+"&stage_kind=screening,screening_ok,in_process,custom,retired"); got != mxNum(v["in_process"]) {
				t.Fatalf("%s top %s: figure %v, total %d", common, id, v["in_process"], got)
			}
		}
		origin := s.get(s.owner, "origin?"+base)["by_channel"].(map[string]any)
		sum := 0
		for channel, n := range origin {
			if got := total("applications", base+"&channel="+channel); got != mxNum(n) {
				t.Fatalf("%s %s: origin %v, applications total %d", common, channel, n, got)
			}
			sum += mxNum(n)
		}
		if got := total("applications", base); got != sum {
			t.Fatalf("%s: origin sum %d, applications total %d", common, sum, got)
		}
		nonzero += sum
	}
	if nonzero < 30 {
		t.Fatalf("only %d non-zero figures", nonzero)
	}
}

func TestMetricsPipeline_CandidatesRowsAndAudit(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXPipeline(t, h)
	var candidateID string
	if err := h.pool.QueryRow(context.Background(), `SELECT candidate_id::text FROM process_participations WHERE id=$1`, s.p2).Scan(&candidateID); err != nil {
		t.Fatal(err)
	}
	before := s.auditCount("MetricsDetailViewed")
	body := s.get(s.stakeholderActor, "candidates?"+mxPipelineRange+"&vacancy_id="+s.a.String()+"&sort=candidate&limit=2")
	items := body["items"].([]any)
	if body["total"] != float64(5) || len(items) != 2 || body["next_cursor"] == nil {
		t.Fatalf("%v", body)
	}
	// The company's name view; entered at the intake.
	editJSONEqual(t, items[1], mxJSON(t, map[string]any{"participation_id": s.p2.String(), "candidate": map[string]any{"id": candidateID, "full_name": "Paula Corregida"},
		"vacancy": map[string]any{"draft_id": s.a.String(), "title": "Analista"}, "stage": map[string]any{"kind": "new", "name": "Nuevos"},
		"business_days_in_stage": 1, "stalled": false, "entered_stage_at": "2026-03-23T18:00:00Z"}))
	editJSONEqual(t, body["facets"], mxJSON(t, map[string]any{"stage_kind": map[string]any{"new": 3, "screening": 1, "screening_ok": 0, "in_process": 0, "custom": 0, "placement": 1}, "stalled": 2}))
	// Recovery resets the entry; the retired row names its retired stage.
	rec := s.get(s.owner, "candidates?"+mxPipelineRange+"&stage_kind=screening")["items"].([]any)[0].(map[string]any)
	if rec["entered_stage_at"] != "2026-03-23T18:00:00Z" || rec["stalled"] != false {
		t.Fatalf("%v", rec)
	}
	retired := s.get(s.owner, "candidates?"+mxPipelineRange+"&stage_kind=retired")["items"].([]any)[0].(map[string]any)
	editJSONEqual(t, retired["stage"], mxJSON(t, map[string]any{"kind": "retired", "name": "Vieja"}))
	next := s.get(s.stakeholderActor, "candidates?"+mxPipelineRange+"&vacancy_id="+s.a.String()+"&sort=candidate&limit=2&cursor="+body["next_cursor"].(string))
	if len(next["items"].([]any)) != 2 {
		t.Fatalf("%v", next)
	}
	rows, err := h.pool.Query(context.Background(), `SELECT actor_id, entity_type, entity_id, vacancy_id, metadata->>'report', metadata->>'vacancy_id', metadata->'filters'
 FROM audit_events WHERE company_id=$1 AND event_type='MetricsDetailViewed' AND actor_id=$2 ORDER BY occurred_at, id`, s.company.companyID, s.stakeholder)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for rows.Next() {
		var actor, entity uuid.UUID
		var vacancy *uuid.UUID
		var entityType, report, metaVacancy string
		var filters map[string]any
		if err := rows.Scan(&actor, &entityType, &entity, &vacancy, &report, &metaVacancy, &filters); err != nil {
			t.Fatal(err)
		}
		n++
		if entityType != "vacancy" || entity != s.a || vacancy == nil || *vacancy != s.a || report != "candidates" || metaVacancy != s.a.String() {
			t.Fatalf("audit row %d", n)
		}
		editJSONEqual(t, filters, mxJSON(t, map[string]any{"from": "2026-03-01", "to": "2026-03-31", "vacancy_id": s.a.String(), "sort": "candidate", "order": "asc", "limit": 2}))
	}
	rows.Close()
	if n != 2 || s.auditCount("MetricsDetailViewed") != before+4 {
		t.Fatalf("audit rows %d of the stakeholder, %d total", n, s.auditCount("MetricsDetailViewed")-before)
	}
	// Pipeline and applications are not audited.
	count := s.auditCount("")
	s.get(s.owner, "pipeline?"+mxPipelineRange)
	s.get(s.owner, "applications?"+mxPipelineRange)
	if s.auditCount("") != count {
		t.Fatal("unaudited route wrote audit rows")
	}
}

func TestMetricsPipeline_ApplicationsRows(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXPipeline(t, h)
	body := s.get(s.owner, "applications?"+mxPipelineRange+"&channel=portal,unknown")
	if body["total"] != float64(4) {
		t.Fatalf("%v", body)
	}
	editJSONEqual(t, body["items"], mxJSON(t, []any{
		map[string]any{"vacancy": map[string]any{"draft_id": s.b.String(), "title": "Backend"}, "requester": map[string]any{"kind": "client", "id": s.acme.String(), "name": "Acme"},
			"portal": 2, "careers_site": 0, "manual": 0, "unknown": 1, "total": 3},
		map[string]any{"vacancy": map[string]any{"draft_id": s.closed.String(), "title": "Cerrada"}, "requester": nil, "portal": 1, "careers_site": 0, "manual": 0, "unknown": 0, "total": 1},
	}))
	editJSONEqual(t, body["facets"], mxJSON(t, map[string]any{"channel": map[string]any{"portal": 3, "careers_site": 1, "manual": 1, "unknown": 1}}))
	editJSONEqual(t, body["applied_filters"], mxJSON(t, map[string]any{"channel": []any{"portal", "unknown"}}))
	titles := func(body map[string]any) string {
		var out []string
		for _, item := range body["items"].([]any) {
			out = append(out, mxAt2(item, "vacancy", "title").(string))
		}
		return strings.Join(out, ",")
	}
	if got := titles(s.get(s.owner, "applications?"+mxPipelineRange+"&sort=title")); got != "Analista,Backend,Cerrada" {
		t.Fatal(got)
	}
	page := s.get(s.owner, "applications?"+mxPipelineRange+"&limit=1")
	if page["total"] != float64(6) || titles(page) != "Backend" || page["next_cursor"] == nil {
		t.Fatalf("%v", page)
	}
}

func TestMetricsPipeline_Exports(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXPipeline(t, h)
	export := func(kind, query string) draftFlowResponse {
		t.Helper()
		return h.do(t, "GET", "/v2/me/company/metrics/"+kind+"/export?"+mxPipelineRange+query, "", s.owner.token, nil)
	}
	before := s.auditCount("MetricsDetailExported")
	r := export("candidates", "&stalled=true")
	if r.status != 200 || r.header.Get("Content-Disposition") != `attachment; filename="metricas-candidates-2026-03-01-2026-03-31.csv"` {
		t.Fatalf("%d %v", r.status, r.header)
	}
	draftFlowAssertNoStore(t, r)
	rows := parseCSV(t, r.body)
	if strings.Join(rows[0], "|") != "ID participación|ID candidato|Candidato|ID vacante|Vacante|Etapa|Nombre de etapa|Días hábiles en etapa|Detenido|Entró a la etapa" || len(rows) != 5 {
		t.Fatalf("%q", rows)
	}
	var report string
	var count int
	var filters map[string]any
	if err := h.pool.QueryRow(context.Background(), `SELECT metadata->>'report', (metadata->>'row_count')::int, metadata->'filters' FROM audit_events WHERE company_id=$1 AND event_type='MetricsDetailExported' ORDER BY occurred_at DESC LIMIT 1`, s.company.companyID).Scan(&report, &count, &filters); err != nil {
		t.Fatal(err)
	}
	if s.auditCount("MetricsDetailExported") != before+1 || report != "candidates" || count != 4 {
		t.Fatalf("export audit %s %d", report, count)
	}
	editJSONEqual(t, filters, mxJSON(t, map[string]any{"from": "2026-03-01", "to": "2026-03-31", "stalled": true, "sort": "business_days_in_stage", "order": "desc"}))
	r = export("applications", "&channel=portal&sort=title")
	rows = parseCSV(t, r.body)
	if r.status != 200 || strings.Join(rows[0], "|") != "ID vacante|Vacante|Solicitante|Portal|Sitio de carreras|Manual|Desconocido|Total" || len(rows) != 3 ||
		rows[1][1] != "Backend" || rows[1][2] != "Acme" || rows[1][7] != "2" || rows[2][2] != "Sin solicitante" {
		t.Fatalf("%d %q", r.status, rows)
	}
	if s.auditCount("MetricsDetailExported") != before+1 {
		t.Fatal("applications export audited")
	}
	h.metrics.WithExportLimit(1)
	t.Cleanup(func() { h.metrics.WithExportLimit(50_000) })
	if r := export("candidates", ""); r.status != 422 || !strings.Contains(string(r.body), `"metrics_export_too_large","row_count":8,"limit":1`) || s.auditCount("MetricsDetailExported") != before+1 {
		t.Fatalf("too large: %d %s", r.status, r.body)
	}
}

// A failed audit insert fails the candidates page and export: 500, nothing
// served.
func TestMetricsPipeline_AuditFailureServesNothing(t *testing.T) {
	for _, event := range []string{"MetricsDetailViewed", "MetricsDetailExported"} {
		fault := &teamFailAudit{event: event}
		h := newDraftFlowHarnessWithAudit(t, fault)
		s := newMXPipeline(t, h)
		fault.enabled.Store(true)
		route := "candidates"
		if event == "MetricsDetailExported" {
			route = "candidates/export"
		}
		r := h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+mxPipelineRange, "", s.owner.token, nil)
		draftFlowAssertCatalogError(t, r, 500, "internal_error")
		if strings.Contains(string(r.body), "Paula") || s.auditCount(event) != 0 {
			t.Fatalf("%s: served %s", event, r.body)
		}
		fault.enabled.Store(false)
		if r := h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+mxPipelineRange, "", s.owner.token, nil); r.status != 200 || s.auditCount(event) != 1 {
			t.Fatalf("%s after recovery: %d", event, r.status)
		}
	}
}

// The pipeline snapshot is shared for 60 s: a write shows only after it
// expires, and the new as_of comes with it.
func TestMetricsPipeline_SnapshotExpires(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXPipeline(t, h)
	newCount := func(body map[string]any) int { return mxNum(body["stages"].([]any)[0].(map[string]any)["candidates"]) }
	if got := newCount(s.get(s.owner, "pipeline?"+mxPipelineRange)); got != 3 {
		t.Fatal(got)
	}
	s.apply(s.a, s.aStage["new"], "Nueva", "portal", mxAt("2026-03-24T15:00:00Z"))
	if got := newCount(s.get(s.owner, "pipeline?from=2026-01-01&to=2026-01-31")); got != 3 {
		t.Fatalf("within the TTL (any period): %d", got)
	}
	h.metrics.WithClock(func() time.Time { return mxAt("2026-03-24T18:01:00Z") })
	got := s.get(s.owner, "pipeline?"+mxPipelineRange)
	if newCount(got) != 4 || got["as_of"] != "2026-03-24T18:01:00Z" {
		t.Fatalf("after the TTL: %v", got)
	}
}
