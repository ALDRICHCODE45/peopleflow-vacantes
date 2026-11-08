//go:build integration

package main

import (
	"context"
	"sort"
	"testing"

	"github.com/google/uuid"
)

var mxRoutes = []string{"summary", "recruiters", "vacancies", "reassignments"}

func mxAllRoutes(s *mxScenario) []string {
	return append(append([]string{}, mxRoutes...),
		"recruiters/"+s.ana.String(),
		"vacancies/"+s.v1.String()+"/deliveries",
		"vacancies/"+s.v1.String()+"/placements")
}

func TestMetricsGate_RolesAndCompanies(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	for _, route := range mxAllRoutes(s) {
		path := "/v2/me/company/metrics/" + route + "?" + mxRange
		// A recruiter never reaches the company view (D2).
		r := h.do(t, "GET", path, "", s.anaActor.token, nil)
		shAssertBody(t, r, 403, map[string]any{"error": "insufficient role", "code": "forbidden"})
		draftFlowAssertNoStore(t, r)
		for _, actor := range []draftFlowActor{s.owner, s.stakeholderActor} {
			if r := h.do(t, "GET", path, "", actor.token, nil); r.status != 200 {
				t.Fatalf("%s: %d %s", route, r.status, r.body)
			}
		}
		draftFlowAssertCatalogError(t, h.do(t, "GET", path, "", "", nil), 401, "unauthenticated")
	}
	// Another company sees none of it: its lists are empty and this company's
	// ids answer 404, writing nothing.
	other := newMXFixture(t, h)
	otherVacancy := other.draft("Ajena", mxPtr(mxAt("2025-01-06T16:00:00Z")), nil, nil, "with_responsible")
	other.stay(otherVacancy, other.ownerID, "responsible", mxAt("2025-01-06T16:00:00Z"), nil)
	if got := other.get(other.owner, "summary?"+mxRange)["vacancies"].(map[string]any)["assigned"]; got != float64(1) {
		t.Fatalf("other company assigned %v", got)
	}
	for _, route := range []string{"vacancies", "recruiters"} {
		items := other.get(other.owner, route+"?"+mxRange)["items"].([]any)
		if len(items) != 1 {
			t.Fatalf("other company %s: %v", route, items)
		}
	}
	before := s.auditCount("") + other.auditCount("")
	for _, route := range []string{"recruiters/" + s.ana.String(), "vacancies/" + s.v1.String() + "/deliveries", "vacancies/" + s.v1.String() + "/placements"} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+mxRange, "", other.owner.token, nil), 404, "not_found")
	}
	if after := s.auditCount("") + other.auditCount(""); after != before {
		t.Fatalf("cross-company reads wrote %d audit rows", after-before)
	}
	// This company's vacancy list never shows the other company's vacancy.
	for _, item := range s.get(s.owner, "vacancies?"+mxRange)["items"].([]any) {
		if item.(map[string]any)["draft_id"] == otherVacancy.String() {
			t.Fatal("foreign vacancy listed")
		}
	}
}

func TestMetricsFilters_RejectedWriteNothing(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	before := s.auditCount("")
	for _, route := range mxAllRoutes(s) {
		for query, fields := range map[string][]any{
			"":                                 {map[string]any{"field": "from", "code": "required"}, map[string]any{"field": "to", "code": "required"}},
			"from=2025-01-01&to=2026-01-02":    {map[string]any{"field": "to", "code": "range"}},
			mxRange + "&requester_kind=vendor": {map[string]any{"field": "requester_kind", "code": "invalid"}},
			mxRange + "&requester_id=" + uuid.NewString(): {map[string]any{"field": "requester_kind", "code": "required"}},
			mxRange + "&recruiter_id=x&nope=1":            {map[string]any{"field": "nope", "code": "unknown"}, map[string]any{"field": "recruiter_id", "code": "invalid"}},
		} {
			r := h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+query, "", s.owner.token, nil)
			shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": fields})
		}
	}
	if s.auditCount("") != before {
		t.Fatal("rejected filters wrote audit rows")
	}
	// List-only parameters.
	r := h.do(t, "GET", "/v2/me/company/metrics/summary?"+mxRange+"&limit=10", "", s.owner.token, nil)
	shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{map[string]any{"field": "limit", "code": "unknown"}}})
	r = h.do(t, "GET", "/v2/me/company/metrics/vacancies?"+mxRange+"&limit=101", "", s.owner.token, nil)
	shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{map[string]any{"field": "limit", "code": "invalid"}}})
	draftFlowAssertCatalogError(t, h.do(t, "GET", "/v2/me/company/metrics/vacancies?"+mxRange+"&cursor=bogus", "", s.owner.token, nil), 400, "invalid_cursor")
}

func TestMetricsVacancies_List(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	acme := map[string]any{"kind": "client", "id": s.acme.String(), "name": "Acme"}
	v1 := map[string]any{
		"draft_id": s.v1.String(), "title": "Uno", "requester": acme, "responsible": mxPerson(s.beto, "Beto", false),
		"first_published_at": "2025-01-06T16:00:00Z",
		"closes":             []any{map[string]any{"date": "2025-02-14", "reason": "filled"}, map[string]any{"date": "2025-03-05", "reason": "filled"}},
		"delivery": map[string]any{"result": "on_time", "target": 2, "delivered": 3, "target_reached_at": "2025-01-15T18:00:00Z",
			"commitment_date": "2025-01-20", "original_commitment_date": "2025-01-20", "renegotiations": 0, "business_days_late": nil},
		"placements": map[string]any{"covered": 1, "required": 2}, "reassignments": 1,
	}
	v2 := map[string]any{
		"draft_id": s.v2.String(), "title": "Dos", "requester": map[string]any{"kind": "client", "id": nil, "name": nil},
		"responsible": mxPerson(s.ana, "Ana", false), "first_published_at": "2025-01-08T16:00:00Z",
		"closes": []any{map[string]any{"date": "2025-03-10", "reason": nil}},
		"delivery": map[string]any{"result": "overdue", "target": 3, "delivered": 0, "target_reached_at": nil,
			"commitment_date": "2025-02-28", "original_commitment_date": "2025-02-28", "renegotiations": 0, "business_days_late": nil},
		"placements": map[string]any{"covered": 0, "required": nil}, "reassignments": 1,
	}
	v3 := map[string]any{
		"draft_id": s.v3.String(), "title": "Tres", "requester": nil, "responsible": mxPerson(s.beto, "Beto", false),
		"first_published_at": "2024-12-02T16:00:00Z", "closes": []any{map[string]any{"date": "2025-01-31", "reason": "cancelled"}},
		"delivery": map[string]any{"result": "not_configured", "target": nil, "delivered": 0, "target_reached_at": nil,
			"commitment_date": nil, "original_commitment_date": nil, "renegotiations": 0, "business_days_late": nil},
		"placements": map[string]any{"covered": 0, "required": nil}, "reassignments": 0,
	}
	v4 := map[string]any{
		"draft_id": s.v4.String(), "title": "Cuatro", "requester": map[string]any{"kind": "internal_area", "id": s.mustRequester(s.v4), "name": "Finanzas"},
		"responsible": nil, "first_published_at": "2025-01-02T16:00:00Z", "closes": []any{},
		"delivery": map[string]any{"result": "pending", "target": 1, "delivered": 0, "target_reached_at": nil,
			"commitment_date": "2025-03-20", "original_commitment_date": "2025-02-15", "renegotiations": 2, "business_days_late": nil},
		"placements": map[string]any{"covered": 0, "required": nil}, "reassignments": 0,
	}
	v5 := map[string]any{
		"draft_id": s.v5.String(), "title": "Cinco", "requester": acme, "responsible": mxPerson(s.beto, "Beto", false),
		"first_published_at": "2025-01-06T16:00:00Z", "closes": []any{},
		"delivery": map[string]any{"result": "late", "target": 1, "delivered": 1, "target_reached_at": "2025-02-05T18:00:00Z",
			"commitment_date": "2025-01-31", "original_commitment_date": "2025-01-31", "renegotiations": 0, "business_days_late": 2},
		"placements": map[string]any{"covered": 0, "required": nil}, "reassignments": 0,
	}
	// Newest first publication first; V1 and V5 tie, then by id.
	tied := []map[string]any{v1, v5}
	sort.Slice(tied, func(i, j int) bool { return tied[i]["draft_id"].(string) < tied[j]["draft_id"].(string) })
	all := []any{v2, tied[0], tied[1], v4, v3}
	editJSONEqual(t, s.get(s.owner, "vacancies?"+mxRange)["items"], mxJSON(t, all))

	// Pages of two walk the same order; the last cursor is null.
	var walked []any
	path := "vacancies?" + mxRange + "&limit=2"
	for pages := 0; ; pages++ {
		body := s.get(s.owner, path)
		walked = append(walked, body["items"].([]any)...)
		if body["next_cursor"] == nil {
			if pages != 2 {
				t.Fatalf("pages %d", pages+1)
			}
			break
		}
		path = "vacancies?" + mxRange + "&limit=2&cursor=" + body["next_cursor"].(string)
	}
	editJSONEqual(t, walked, mxJSON(t, all))

	for query, want := range map[string][]any{
		"&outcome=filled":                   {v1},
		"&outcome=cancelled":                {v3},
		"&outcome=other":                    {},
		"&outcome=open":                     {v5, v4}, // no close in the period
		"&delivery_result=overdue":          {v2},
		"&delivery_result=late":             {v5},
		"&recruiter_id=" + s.carla.String(): {v2},
		"&requester_id=none":                {v3},
	} {
		editJSONEqual(t, s.get(s.owner, "vacancies?"+mxRange+query)["items"], mxJSON(t, want))
	}
}

func TestMetricsReassignments_List(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	snapshot := map[string]any{
		"lifecycle":  map[string]any{"publication": "published", "process": "active"},
		"delivery":   map[string]any{"target": 2, "delivered": 2, "fulfilled_at": nil, "result": nil, "commitment_date": "2025-01-20"},
		"placements": map[string]any{"current": 0, "credited": 0},
	}
	row := func(id string, at string, vacancy uuid.UUID, title string, from, to map[string]any, reason string, days int) map[string]any {
		return map[string]any{"id": id, "performed_at": at, "vacancy": map[string]any{"draft_id": vacancy.String(), "title": title},
			"from": from, "to": to, "reason": reason, "note": nil, "performed_by": mxPerson(s.ownerID, "Olga Owner", false),
			"outgoing_tramo_business_days": days, "snapshot": snapshot}
	}
	got := s.get(s.owner, "reassignments?"+mxRange)
	items := got["items"].([]any)
	if len(items) != 2 || got["next_cursor"] != nil {
		t.Fatalf("%v", got)
	}
	ids := []string{items[0].(map[string]any)["id"].(string), items[1].(map[string]any)["id"].(string)}
	// Newest first; the outgoing tramo lasted Jan 6 → Feb 10 = 24 and
	// Jan 8 → Feb 3 (a holiday) = 17 business days.
	editJSONEqual(t, items, mxJSON(t, []any{
		row(ids[0], "2025-02-10T18:00:00Z", s.v1, "Uno", mxPerson(s.ana, "Ana", false), mxPerson(s.beto, "Beto", false), "workload", 24),
		row(ids[1], "2025-02-03T18:00:00Z", s.v2, "Dos", mxPerson(s.carla, "Carla", true), mxPerson(s.ana, "Ana", false), "recruiter_departure", 17),
	}))
	one := s.get(s.owner, "reassignments?"+mxRange+"&recruiter_id="+s.carla.String())["items"].([]any)
	if len(one) != 1 || one[0].(map[string]any)["id"] != ids[1] {
		t.Fatalf("recruiter filter %v", one)
	}
	page := s.get(s.owner, "reassignments?"+mxRange+"&limit=1")
	next := s.get(s.owner, "reassignments?"+mxRange+"&limit=1&cursor="+page["next_cursor"].(string))
	if next["items"].([]any)[0].(map[string]any)["id"] != ids[1] || next["next_cursor"] != nil {
		t.Fatalf("page 2 %v", next)
	}
	// The note appears in detail only for `other`.
	extra := s.draft("Nota", mxPtr(mxAt("2025-01-06T16:00:00Z")), nil, nil, "with_responsible")
	from := s.stay(extra, s.ana, "responsible", mxAt("2025-01-06T16:00:00Z"), mxPtr(mxAt("2025-03-03T18:00:00Z")))
	to := s.stay(extra, s.beto, "responsible", mxAt("2025-03-03T18:00:00Z"), nil)
	s.reassign(extra, from, to, "other", mxPtr("cambio de cliente"), mxAt("2025-03-03T18:00:00Z"))
	first := s.get(s.owner, "reassignments?"+mxRange)["items"].([]any)[0].(map[string]any)
	if first["reason"] != "other" || first["note"] != "cambio de cliente" {
		t.Fatalf("note %v", first)
	}
}

func TestMetricsDetail_DeliveriesAndPlacementsAudited(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	candidate := func(pid uuid.UUID, name string) map[string]any {
		var id string
		if err := h.pool.QueryRow(context.Background(), `SELECT candidate_id::text FROM process_participations WHERE id=$1`, pid).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return map[string]any{"id": id, "full_name": name}
	}
	header := map[string]any{"definitions_version": "v1", "period": mxPeriod("2025-01-01", "2025-03-31"), "draft_id": s.v1.String()}
	with := func(items []any) map[string]any {
		out := map[string]any{"items": items}
		for k, v := range header {
			out[k] = v
		}
		return out
	}
	before := s.auditCount("MetricsDetailViewed")
	// In order; the organic apply straight into the cutoff has no recruiter
	// (M3); the company's name correction is what the company sees.
	editJSONEqual(t, s.get(s.stakeholderActor, "vacancies/"+s.v1.String()+"/deliveries?"+mxRange), mxJSON(t, with([]any{
		map[string]any{"candidate": candidate(s.p1, "Candidata Uno"), "reached_at": "2025-01-10T18:00:00Z", "delivered_by": nil},
		map[string]any{"candidate": candidate(s.p2, "Candidato Corregido"), "reached_at": "2025-01-15T18:00:00Z", "delivered_by": mxPerson(s.ana, "Ana", false)},
		map[string]any{"candidate": candidate(s.p3, "Candidata Tres"), "reached_at": "2025-02-12T18:00:00Z", "delivered_by": mxPerson(s.beto, "Beto", false)},
	})))
	// Voided credits are not listed (M3).
	editJSONEqual(t, s.get(s.owner, "vacancies/"+s.v1.String()+"/placements?"+mxRange), mxJSON(t, with([]any{
		map[string]any{"candidate": candidate(s.p2, "Candidato Corregido"), "hired_at": "2025-02-14T17:00:00Z", "status": "active",
			"recipients": []any{map[string]any{"person": mxPerson(s.beto, "Beto", false), "kind": "direct"}, map[string]any{"person": mxPerson(s.ana, "Ana", false), "kind": "participant"}}},
		map[string]any{"candidate": candidate(s.p3, "Candidata Tres"), "hired_at": "2025-03-04T18:00:00Z", "status": "did_not_hold",
			"recipients": []any{map[string]any{"person": mxPerson(s.beto, "Beto", false), "kind": "direct"}}},
	})))
	// Exactly one row per read, with its actor, vacancy and report.
	rows, err := h.pool.Query(context.Background(), `SELECT actor_id, entity_type, entity_id, vacancy_id, metadata->>'report', metadata->>'vacancy_id', metadata - 'report' - 'vacancy_id' = '{}'::jsonb
 FROM audit_events WHERE company_id=$1 AND event_type='MetricsDetailViewed' ORDER BY occurred_at, id`, s.company.companyID)
	if err != nil {
		t.Fatal(err)
	}
	type audited struct {
		actor, entity, vacancy uuid.UUID
		entityType, report     string
		metaVacancy            string
		closed                 bool
	}
	var got []audited
	for rows.Next() {
		var a audited
		if err := rows.Scan(&a.actor, &a.entityType, &a.entity, &a.vacancy, &a.report, &a.metaVacancy, &a.closed); err != nil {
			t.Fatal(err)
		}
		got = append(got, a)
	}
	rows.Close()
	if len(got) != before+2 {
		t.Fatalf("audit rows %d, want %d", len(got), before+2)
	}
	for i, want := range []struct {
		actor  uuid.UUID
		report string
	}{{s.stakeholder, "deliveries"}, {s.ownerID, "placements"}} {
		a := got[before+i]
		if a.actor != want.actor || a.report != want.report || a.entityType != "vacancy" || a.entity != s.v1 || a.vacancy != s.v1 || a.metaVacancy != s.v1.String() || !a.closed {
			t.Fatalf("audit row %d: %+v", i, a)
		}
	}
	// A vacancy never published, an unknown id or a malformed id is 404 and
	// audits nothing; a vacancy without delivery configuration lists nothing.
	count := s.auditCount("MetricsDetailViewed")
	for _, id := range []string{s.v6.String(), uuid.NewString(), "nope"} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", "/v2/me/company/metrics/vacancies/"+id+"/deliveries?"+mxRange, "", s.owner.token, nil), 404, "not_found")
	}
	if s.auditCount("MetricsDetailViewed") != count {
		t.Fatal("404 detail read was audited")
	}
	if items := s.get(s.owner, "vacancies/"+s.v3.String()+"/deliveries?"+mxRange)["items"].([]any); len(items) != 0 {
		t.Fatalf("not configured deliveries %v", items)
	}
}

// A failed audit insert fails the read: 500, no body, no row (fail-closed).
func TestMetricsDetail_AuditFailureFailsTheRead(t *testing.T) {
	fault := &teamFailAudit{event: "MetricsDetailViewed"}
	h := newDraftFlowHarnessWithAudit(t, fault)
	s := newMXScenario(t, h)
	fault.enabled.Store(true)
	for _, report := range []string{"deliveries", "placements"} {
		r := h.do(t, "GET", "/v2/me/company/metrics/vacancies/"+s.v1.String()+"/"+report+"?"+mxRange, "", s.owner.token, nil)
		draftFlowAssertCatalogError(t, r, 500, "internal_error")
	}
	if n := s.auditCount("MetricsDetailViewed"); n != 0 {
		t.Fatalf("audit rows %d", n)
	}
	fault.enabled.Store(false)
	s.get(s.owner, "vacancies/"+s.v1.String()+"/deliveries?"+mxRange)
	if n := s.auditCount("MetricsDetailViewed"); n != 1 {
		t.Fatalf("audit rows after recovery %d", n)
	}
}
