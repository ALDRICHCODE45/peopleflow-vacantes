//go:build integration

package main

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// mxScenario is one company with every §2 edge case, read over the period
// 2025-01-01..2025-03-31 at "now" = Saturday 2025-03-15 (Mexico City, UTC-6).
// 2025 holidays in range: Jan 1, Feb 3, Mar 17.
type mxScenario struct {
	*mxFixture
	ana, beto, carla, stakeholder uuid.UUID
	anaActor, stakeholderActor    draftFlowActor
	acme                          uuid.UUID
	v1, v2, v3, v4, v5, v6        uuid.UUID
	p1, p2, p3                    uuid.UUID
}

const mxRange = "from=2025-01-01&to=2025-03-31"

func newMXScenario(t *testing.T, h *draftFlowHarness) *mxScenario {
	t.Helper()
	h.metrics.WithClock(func() time.Time { return mxAt("2025-03-15T18:00:00Z") })
	t.Cleanup(func() { h.metrics.WithClock(time.Now) })
	s := &mxScenario{mxFixture: newMXFixture(t, h)}
	s.ana, s.anaActor = s.member("recruiter", "Ana")
	s.beto, _ = s.member("recruiter", "Beto")
	s.carla = s.formerMember("Carla")
	s.stakeholder, s.stakeholderActor = s.member("stakeholder", "Sofía")
	s.acme = s.requester("client", "Acme")
	finanzas := s.requester("internal_area", "Finanzas")
	client, internal := mxPtr("client"), mxPtr("internal_area")
	newStage, cutoff := uuid.New(), uuid.New()

	// V1: reassigned A → B (A stays as collaborator); on time judged by the
	// N-th reached_at although fulfilled_at is late; organic apply into the
	// cutoff credits no recruiter; close → reopen → close; closing target
	// renegotiated between the two closes; a voided credit is ignored.
	s.v1 = s.draft("Uno", mxPtr(mxAt("2025-01-06T16:00:00Z")), client, &s.acme, "with_responsible")
	a1 := s.tramo(s.v1, s.ana, mxAt("2025-01-06T16:00:00Z"), nil)
	s.function(a1, s.v1, "responsible", mxAt("2025-01-06T16:00:00Z"), mxPtr(mxAt("2025-02-10T18:00:00Z")))
	s.function(a1, s.v1, "collaborator", mxAt("2025-02-10T18:00:00Z"), nil)
	b1 := s.stay(s.v1, s.beto, "responsible", mxAt("2025-02-10T18:00:00Z"), nil)
	s.reassign(s.v1, a1, b1, "workload", nil, mxAt("2025-02-10T18:00:00Z"))
	s.delivery(s.v1, cutoff, 2, "2025-01-20")
	s.fulfill(s.v1, cutoff, "2025-01-20", mxAt("2025-02-20T18:00:00Z"), mxAt("2025-01-10T18:00:00Z"), mxAt("2025-01-15T18:00:00Z"))
	s.p1 = s.apply(s.v1, cutoff, "Candidata Uno", "portal", mxAt("2025-01-10T18:00:00Z"))
	s.p2 = s.apply(s.v1, newStage, "Candidato Dos", "careers_site", mxAt("2025-01-12T18:00:00Z"))
	s.correct(s.p2, "Candidato Corregido")
	s.move(s.p2, newStage, cutoff, s.ana, mxAt("2025-01-15T18:00:00Z"))
	s.p3 = s.apply(s.v1, newStage, "Candidata Tres", "unknown", mxAt("2025-02-11T18:00:00Z"))
	s.move(s.p3, newStage, cutoff, s.beto, mxAt("2025-02-12T18:00:00Z"))
	s.management(s.v1, mxPtr(2), mxPtr("2025-03-03"))
	s.closeTarget(s.v1, nil, mxPtr("2025-02-28"), mxAt("2025-01-07T18:00:00Z"))
	s.closeTarget(s.v1, mxPtr("2025-02-28"), mxPtr("2025-03-03"), mxAt("2025-03-01T18:00:00Z"))
	s.lifecycle(s.v1, "close", mxAt("2025-02-14T18:00:00Z"), mxPtr("filled"))
	s.lifecycle(s.v1, "reopen", mxAt("2025-02-17T18:00:00Z"), nil)
	s.lifecycle(s.v1, "close", mxAt("2025-03-05T18:00:00Z"), mxPtr("filled"))
	s.credit(s.v1, s.p2, mxAt("2025-02-14T17:00:00Z"), "active", mxRecipient{s.beto, b1, "direct"}, mxRecipient{s.ana, a1, "participant"})
	s.credit(s.v1, s.p3, mxAt("2025-03-04T18:00:00Z"), "did_not_hold", mxRecipient{s.beto, b1, "direct"})
	s.credit(s.v1, s.p1, mxAt("2025-02-20T18:00:00Z"), "voided", mxRecipient{s.beto, b1, "direct"})

	// V2: «cliente sin especificar»; former member Carla leaves
	// (recruiter_departure) and Ana rejoins: two tramos, counted once; the
	// commitment passed unfulfilled (overdue); legacy close without reason.
	s.v2 = s.draft("Dos", mxPtr(mxAt("2025-01-08T16:00:00Z")), client, nil, "with_responsible")
	c2 := s.stay(s.v2, s.carla, "responsible", mxAt("2025-01-08T16:00:00Z"), mxPtr(mxAt("2025-02-03T18:00:00Z")))
	s.stay(s.v2, s.ana, "collaborator", mxAt("2025-01-20T18:00:00Z"), mxPtr(mxAt("2025-01-25T18:00:00Z")))
	a2 := s.stay(s.v2, s.ana, "responsible", mxAt("2025-02-03T18:00:00Z"), nil)
	s.reassign(s.v2, c2, a2, "recruiter_departure", nil, mxAt("2025-02-03T18:00:00Z"))
	s.delivery(s.v2, cutoff, 3, "2025-02-28")
	s.lifecycle(s.v2, "close", mxAt("2025-03-10T18:00:00Z"), nil)

	// V3: «sin solicitante», assigned since December, no delivery
	// configuration (enters by assignment, P1), cancelled.
	s.v3 = s.draft("Tres", mxPtr(mxAt("2024-12-02T16:00:00Z")), nil, nil, "with_responsible")
	s.stay(s.v3, s.beto, "responsible", mxAt("2024-12-02T16:00:00Z"), nil)
	s.lifecycle(s.v3, "close", mxAt("2025-01-31T18:00:00Z"), mxPtr("cancelled"))

	// V4: shared team, renegotiated twice, still pending at "now".
	s.v4 = s.draft("Cuatro", mxPtr(mxAt("2025-01-02T16:00:00Z")), internal, &finanzas, "shared")
	s.stay(s.v4, s.ana, "member", mxAt("2025-01-02T16:00:00Z"), nil)
	s.stay(s.v4, s.beto, "member", mxAt("2025-01-02T16:00:00Z"), nil)
	s.delivery(s.v4, cutoff, 1, "2025-03-20")
	s.renegotiate(s.v4, mxPtr("2025-02-15"), "2025-03-01", mxAt("2025-02-10T18:00:00Z"))
	s.renegotiate(s.v4, mxPtr("2025-03-01"), "2025-03-20", mxAt("2025-02-25T18:00:00Z"))

	// V5: late delivery (Feb 3 is a holiday: 2 business days late).
	s.v5 = s.draft("Cinco", mxPtr(mxAt("2025-01-06T16:00:00Z")), client, &s.acme, "with_responsible")
	s.stay(s.v5, s.beto, "responsible", mxAt("2025-01-06T16:00:00Z"), nil)
	s.delivery(s.v5, cutoff, 1, "2025-01-31")
	s.fulfill(s.v5, cutoff, "2025-01-31", mxAt("2025-02-05T18:00:00Z"), mxAt("2025-02-05T18:00:00Z"))
	p5 := s.apply(s.v5, newStage, "Candidato Cinco", "manual", mxAt("2025-02-01T18:00:00Z"))
	s.move(p5, newStage, cutoff, s.beto, mxAt("2025-02-05T18:00:00Z"))

	// V6: never published: outside the universe (D6).
	s.v6 = s.draft("Seis", nil, nil, nil, "with_responsible")
	s.stay(s.v6, s.ana, "responsible", mxAt("2025-01-06T16:00:00Z"), nil)

	// V8: published, no activity in the period: not listed.
	v8 := s.draft("Ocho", mxPtr(mxAt("2024-06-03T16:00:00Z")), client, &s.acme, "with_responsible")
	s.stay(v8, s.ana, "responsible", mxAt("2024-06-03T16:00:00Z"), mxPtr(mxAt("2024-11-01T18:00:00Z")))
	s.delivery(v8, cutoff, 1, "2025-06-15")
	return s
}

func TestMetricsSummary_Formulas(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	got := s.get(s.owner, "summary?"+mxRange)
	want := map[string]any{
		"definitions_version": "v1",
		"period":              mxPeriod("2025-01-01", "2025-03-31"),
		"vacancies": map[string]any{
			"assigned": 5,
			"closed":   map[string]any{"filled": 2, "cancelled": 1, "other": 0, "no_reason": 1},
			// Jan 6 → Feb 14 = 28 and Jan 6 → Mar 5 = 41 business days.
			"median_business_days_to_close": 34.5,
			// Target in effect: Feb 28 at the first close, Mar 3 at the second.
			"closing_target": map[string]any{"on_time": 1, "late": 1, "no_target": 0},
		},
		"delivery": map[string]any{
			"on_time": 1, "late": 1, "overdue": 1, "pending": 1, "not_configured": 1, "configured": 4, "total": 5,
			"on_time_rate":    mxRate(0.3333, 1, 3),
			"configured_rate": mxRate(0.8, 4, 5),
			// V1: Jan 6 → Jan 15 = 7; V5: Jan 6 → Feb 5 = 21.
			"median_business_days_to_target": 14,
			"delivered":                      4,
		},
		"placements": map[string]any{"credits": 2, "did_not_hold": 1, "positions_covered": 1, "positions_required": 2},
		"origin":     map[string]any{"portal": 1, "careers_site": 1, "manual": 1, "unknown": 1},
		"closed_by_month": []any{
			map[string]any{"month": "2025-01", "filled": 0, "cancelled": 1, "other": 0, "no_reason": 0},
			map[string]any{"month": "2025-02", "filled": 1, "cancelled": 0, "other": 0, "no_reason": 0},
			map[string]any{"month": "2025-03", "filled": 1, "cancelled": 0, "other": 0, "no_reason": 1},
		},
		"reassignments": map[string]any{"total": 2, "by_reason": map[string]any{"workload": 1, "recruiter_departure": 1, "performance": 0, "client_request": 0, "other": 0}},
		"by_requester": []any{
			map[string]any{"requester": map[string]any{"kind": "client", "id": s.acme.String(), "name": "Acme"}, "vacancies": 2, "filled": 2},
			map[string]any{"requester": map[string]any{"kind": "internal_area", "id": s.mustRequester(s.v4), "name": "Finanzas"}, "vacancies": 1, "filled": 0},
			map[string]any{"requester": map[string]any{"kind": "client", "id": nil, "name": nil}, "vacancies": 1, "filled": 0},
			map[string]any{"requester": nil, "vacancies": 1, "filled": 0},
		},
	}
	editJSONEqual(t, got, mxJSON(t, want))
	// The stakeholder reads the same numbers; aggregates write no audit row.
	before := s.auditCount("")
	editJSONEqual(t, s.get(s.stakeholderActor, "summary?"+mxRange), mxJSON(t, want))
	if s.auditCount("") != before {
		t.Fatal("aggregate read wrote an audit row")
	}
}

func (s *mxScenario) mustRequester(draft uuid.UUID) string {
	var id string
	if err := s.h.pool.QueryRow(s.t.Context(), `SELECT requester_id::text FROM job_drafts WHERE id=$1`, draft).Scan(&id); err != nil {
		s.t.Fatal(err)
	}
	return id
}

func TestMetricsSummary_Filters(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	assigned := func(query string) any {
		t.Helper()
		return s.get(s.owner, "summary?"+mxRange+query)["vacancies"].(map[string]any)["assigned"]
	}
	for query, want := range map[string]float64{
		"":                                  5,
		"&recruiter_id=" + s.ana.String():   3, // V1, V2, V4
		"&recruiter_id=" + s.carla.String(): 1, // former member keeps history
		"&requester_id=none":                1, // V3 «sin solicitante»
		"&requester_kind=client":            3, // V1, V2, V5
		"&requester_kind=client&requester_id=none":               1, // V2 «cliente sin especificar»
		"&requester_kind=client&requester_id=" + s.acme.String(): 2,
		"&requester_kind=internal_area":                          1,
		"&recruiter_id=" + uuid.NewString():                      0,
	} {
		if got := assigned(query); got != want {
			t.Errorf("%q: assigned %v, want %v", query, got, want)
		}
	}
	// A period outside every activity: zeros, dense month, null medians.
	empty := s.get(s.owner, "summary?from=2023-02-01&to=2023-02-28")
	editJSONEqual(t, empty["closed_by_month"], mxJSON(t, []any{map[string]any{"month": "2023-02", "filled": 0, "cancelled": 0, "other": 0, "no_reason": 0}}))
}

// An empty company: every count 0, medians null, rates objects with null
// value, the monthly series dense with zeros.
func TestMetricsSummary_EmptyCompany(t *testing.T) {
	h := newDraftFlowHarness(t)
	f := newMXFixture(t, h)
	got := f.get(f.owner, "summary?from=2025-11-15&to=2026-01-10")
	zeroMonth := func(m string) map[string]any {
		return map[string]any{"month": m, "filled": 0, "cancelled": 0, "other": 0, "no_reason": 0}
	}
	want := map[string]any{
		"definitions_version": "v1",
		"period":              mxPeriod("2025-11-15", "2026-01-10"),
		"vacancies": map[string]any{"assigned": 0, "closed": map[string]any{"filled": 0, "cancelled": 0, "other": 0, "no_reason": 0},
			"median_business_days_to_close": nil, "closing_target": map[string]any{"on_time": 0, "late": 0, "no_target": 0}},
		"delivery": map[string]any{"on_time": 0, "late": 0, "overdue": 0, "pending": 0, "not_configured": 0, "configured": 0, "total": 0,
			"on_time_rate": mxRate(nil, 0, 0), "configured_rate": mxRate(nil, 0, 0), "median_business_days_to_target": nil, "delivered": 0},
		"placements":      map[string]any{"credits": 0, "did_not_hold": 0, "positions_covered": 0, "positions_required": 0},
		"origin":          map[string]any{"portal": 0, "careers_site": 0, "manual": 0, "unknown": 0},
		"closed_by_month": []any{zeroMonth("2025-11"), zeroMonth("2025-12"), zeroMonth("2026-01")},
		"reassignments":   map[string]any{"total": 0, "by_reason": map[string]any{"workload": 0, "recruiter_departure": 0, "performance": 0, "client_request": 0, "other": 0}},
		"by_requester":    []any{},
	}
	editJSONEqual(t, got, mxJSON(t, want))
	editJSONEqual(t, f.get(f.owner, "recruiters?from=2025-11-15&to=2026-01-10"), mxJSON(t, map[string]any{
		"definitions_version": "v1", "period": mxPeriod("2025-11-15", "2026-01-10"), "items": []any{}, "next_cursor": nil}))
}

func TestMetricsRecruiters_Cards(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	card := func(p map[string]any, assigned, resp, collab, member, started int, onTime, late, overdue int, median any, inTramo int,
		direct, participant, shared, dnh, closed int, conversion map[string]any, received, lost, days int) map[string]any {
		out := map[string]any{
			"vacancies":               map[string]any{"assigned": assigned, "as_responsible": resp, "as_collaborator": collab, "as_member": member, "started_in_period": started},
			"delivery":                map[string]any{"on_time": onTime, "late": late, "overdue": overdue, "median_business_days_to_target": median, "delivered_in_tramo": inTramo},
			"placements":              map[string]any{"direct": direct, "participant": participant, "shared": shared, "did_not_hold": dnh, "closed_assigned": closed, "conversion": conversion},
			"reassignments":           map[string]any{"received": received, "lost": lost},
			"business_days_in_tramos": days,
		}
		for k, v := range p {
			out[k] = v
		}
		return out
	}
	// Ana: V1 (responsible then collaborator), V2 (two tramos, once), V4
	// (member). V1 on time at its target moment, V2 overdue at the end of its
	// commitment day; one move into the cutoff; participant credit.
	ana := card(mxPerson(s.ana, "Ana", false), 3, 2, 2, 1, 3, 1, 0, 1, 7, 1, 0, 1, 0, 0, 2, mxRate(0.5, 1, 2), 1, 1, 48+4+29+50)
	// Beto: V1 (from Feb 10), V3 (since December), V4, V5. Late V5; the
	// did_not_hold credit counts inside direct (P3).
	beto := card(mxPerson(s.beto, "Beto", false), 4, 3, 0, 1, 3, 0, 1, 0, 21, 2, 2, 0, 0, 1, 2, mxRate(0.5, 1, 2), 1, 0, 24+51+50+48)
	// Carla: former member, keeps her V2 history.
	carla := card(mxPerson(s.carla, "Carla", true), 1, 1, 0, 0, 1, 0, 0, 0, nil, 0, 0, 0, 0, 0, 1, mxRate(0, 0, 1), 0, 1, 17)
	editJSONEqual(t, s.get(s.owner, "recruiters?"+mxRange), mxJSON(t, map[string]any{
		"definitions_version": "v1", "period": mxPeriod("2025-01-01", "2025-03-31"),
		"items": []any{ana, beto, carla}, "next_cursor": nil}))

	// Pagination: alphabetical, opaque cursor, null at the end.
	first := s.get(s.owner, "recruiters?"+mxRange+"&limit=2")
	items := first["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["name"] != "Ana" || items[1].(map[string]any)["name"] != "Beto" || first["next_cursor"] == nil {
		t.Fatalf("page 1: %v", first)
	}
	second := s.get(s.owner, "recruiters?"+mxRange+"&limit=2&cursor="+first["next_cursor"].(string))
	editJSONEqual(t, second["items"], mxJSON(t, []any{carla}))
	if second["next_cursor"] != nil {
		t.Fatal("last page has a cursor")
	}
	// The cursor is bound to its filters.
	draftFlowAssertCatalogError(t, h.do(t, "GET", "/v2/me/company/metrics/recruiters?from=2025-01-01&to=2025-03-30&limit=2&cursor="+first["next_cursor"].(string), "", s.owner.token, nil), 400, "invalid_cursor")
	// recruiter_id picks one card.
	editJSONEqual(t, s.get(s.owner, "recruiters?"+mxRange+"&recruiter_id="+s.carla.String())["items"], mxJSON(t, []any{carla}))

	// One recruiter: the card at the root plus a dense by_month (P4).
	one := s.get(s.owner, "recruiters/"+s.ana.String()+"?"+mxRange)
	byMonth := one["by_month"]
	delete(one, "by_month")
	wantOne := map[string]any{"definitions_version": "v1", "period": mxPeriod("2025-01-01", "2025-03-31")}
	for k, v := range ana {
		wantOne[k] = v
	}
	editJSONEqual(t, one, mxJSON(t, wantOne))
	month := func(m string, assigned, onTime, late, overdue, placements int) map[string]any {
		return map[string]any{"month": m, "assigned": assigned, "delivery": map[string]any{"on_time": onTime, "late": late, "overdue": overdue}, "placements": placements}
	}
	editJSONEqual(t, byMonth, mxJSON(t, []any{month("2025-01", 3, 1, 0, 0, 0), month("2025-02", 3, 0, 0, 1, 1), month("2025-03", 3, 0, 0, 0, 0)}))

	// A tramo-less user (the stakeholder) and an unknown id are 404.
	for _, id := range []uuid.UUID{s.stakeholder, uuid.New()} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", "/v2/me/company/metrics/recruiters/"+id.String()+"?"+mxRange, "", s.owner.token, nil), 404, "not_found")
	}
	draftFlowAssertCatalogError(t, h.do(t, "GET", "/v2/me/company/metrics/recruiters/not-a-uuid?"+mxRange, "", s.owner.token, nil), 404, "not_found")
	// A recruiter with history but nothing in the period: zero card, named.
	quiet := s.get(s.owner, "recruiters/"+s.carla.String()+"?from=2024-01-01&to=2024-01-31")
	if quiet["name"] != "Carla" || quiet["former_member"] != true || quiet["vacancies"].(map[string]any)["assigned"] != float64(0) {
		t.Fatalf("quiet card %v", quiet)
	}
}
