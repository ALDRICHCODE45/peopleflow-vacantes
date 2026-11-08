//go:build integration

package main

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// Board sections (stakeholder-metrics-v2 §4) through the production router.

var mxSections = []string{"closures", "compliance", "delays", "origin"}

func TestMetricsSections_Gate(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	for _, route := range mxSections {
		path := "/v2/me/company/metrics/" + route + "?" + mxRange
		r := h.do(t, "GET", path, "", s.anaActor.token, nil)
		shAssertBody(t, r, 403, map[string]any{"error": "insufficient role", "code": "forbidden"})
		draftFlowAssertNoStore(t, r)
		draftFlowAssertCatalogError(t, h.do(t, "GET", path, "", "", nil), 401, "unauthenticated")
		for _, actor := range []draftFlowActor{s.owner, s.stakeholderActor} {
			body := s.get(actor, route+"?"+mxRange)
			if body["definitions_version"] != "v2" || body["as_of"] != "2025-03-15T18:00:00Z" {
				t.Fatalf("%s header %v", route, body)
			}
		}
		// Same strict parser; sections take no list parameters.
		for query, fields := range map[string][]any{
			"":                                 {map[string]any{"field": "from", "code": "required"}, map[string]any{"field": "to", "code": "required"}},
			mxRange + "&limit=10&cursor=x":     {map[string]any{"field": "cursor", "code": "unknown"}, map[string]any{"field": "limit", "code": "unknown"}},
			mxRange + "&requester_kind=vendor": {map[string]any{"field": "requester_kind", "code": "invalid"}},
		} {
			r := h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+query, "", s.owner.token, nil)
			shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": fields})
		}
	}
	// Another company's sections see none of this company's facts.
	other := newMXFixture(t, h)
	origin := other.get(other.owner, "origin?"+mxRange)["by_channel"]
	editJSONEqual(t, origin, mxJSON(t, map[string]any{"portal": 0, "careers_site": 0, "manual": 0, "unknown": 0}))
}

func TestMetricsSections_Figures(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	header := func(body map[string]any) map[string]any {
		body["definitions_version"], body["period"], body["as_of"] = "v2", mxPeriod("2025-01-01", "2025-03-31"), "2025-03-15T18:00:00Z"
		return body
	}
	month := func(m string, closed, filled, cancelled, other, noReason int) map[string]any {
		return map[string]any{"month": m, "closed": closed, "filled": filled, "cancelled": cancelled, "other": other, "no_reason": noReason}
	}
	onTimeByMonth := []any{
		map[string]any{"month": "2025-01", "rate": mxRate(0.5, 1, 2)},
		map[string]any{"month": "2025-02", "rate": mxRate(0, 0, 1)},
		map[string]any{"month": "2025-03", "rate": mxRate(nil, 0, 0)},
	}
	// §4.2: V3 cancelled in Jan; V1 filled in Feb and again in Mar (once per
	// month); V2's legacy close in Mar.
	editJSONEqual(t, s.get(s.owner, "closures?"+mxRange), mxJSON(t, header(map[string]any{
		"closed_by_month": []any{month("2025-01", 1, 0, 1, 0, 0), month("2025-02", 1, 1, 0, 0, 0), month("2025-03", 2, 1, 0, 0, 1)},
		"delivery_status": map[string]any{"on_time": 1, "late": 1, "overdue": 1, "pending": 1, "not_configured": 1},
	})))
	// §4.3: V5 is late by 2 business days (Feb 3 is a holiday).
	editJSONEqual(t, s.get(s.owner, "compliance?"+mxRange), mxJSON(t, header(map[string]any{
		"late_buckets":     map[string]any{"up_to_2": 1, "from_3_to_5": 0, "over_5": 0},
		"on_time_by_month": onTimeByMonth,
	})))
	// §4.5: V2 overdue since Feb 28: Mar 3–7 and 10–14 = 10 business days to
	// as_of (Saturday Mar 15).
	editJSONEqual(t, s.get(s.owner, "delays?"+mxRange), mxJSON(t, header(map[string]any{
		"closing_target": map[string]any{"on_time": 1, "late": 0, "no_target": 0},
		"overdue": map[string]any{"total": 1, "top": []any{map[string]any{
			"vacancy": map[string]any{"draft_id": s.v2.String(), "title": "Dos"}, "commitment_date": "2025-02-28",
			// «Cliente sin especificar»; Ana is responsible at the end of Feb 28.
			"requester": map[string]any{"kind": "client", "id": nil, "name": nil}, "attributed_to": []any{mxPerson(s.ana, "Ana", false)},
			"business_days_overdue": 10, "delivered": 0, "target": 3}}},
		"reassignments_by_reason": map[string]any{"workload": 1, "recruiter_departure": 1, "performance": 0, "client_request": 0, "other": 0},
	})))
	// §4.6.
	editJSONEqual(t, s.get(s.owner, "origin?"+mxRange), mxJSON(t, header(map[string]any{
		"by_channel": map[string]any{"portal": 1, "careers_site": 1, "manual": 1, "unknown": 1},
	})))
	// The common filters apply over the same snapshot: Carla only had V2.
	carla := s.get(s.owner, "closures?"+mxRange+"&recruiter_id="+s.carla.String())
	editJSONEqual(t, carla["closed_by_month"], mxJSON(t, []any{month("2025-01", 0, 0, 0, 0, 0), month("2025-02", 0, 0, 0, 0, 0), month("2025-03", 1, 0, 0, 0, 1)}))
	editJSONEqual(t, carla["delivery_status"], mxJSON(t, map[string]any{"on_time": 0, "late": 0, "overdue": 1, "pending": 0, "not_configured": 0}))
	if got := s.get(s.owner, "origin?"+mxRange+"&requester_id=none")["by_channel"]; got.(map[string]any)["portal"] != float64(0) {
		t.Fatalf("requester filter on origin %v", got)
	}
}

// Edge cases in April 2025 (no holidays) read at Wednesday Apr 30: distinct
// closes after a reopen, every late bucket, and overdue.top bounded and
// ordered with a title tie.
func TestMetricsSections_EdgeCases(t *testing.T) {
	h := newDraftFlowHarness(t)
	h.metrics.WithClock(func() time.Time { return mxAt("2025-04-30T18:00:00Z") })
	t.Cleanup(func() { h.metrics.WithClock(time.Now) })
	f := newMXFixture(t, h)
	const april = "from=2025-04-01&to=2025-04-30"
	ana, _ := f.member("recruiter", "Ana")
	published := mxPtr(mxAt("2025-03-03T16:00:00Z"))

	// cancelled → reopen → filled: one vacancy, filled.
	d1 := f.draft("Reabierta", published, nil, nil, "with_responsible")
	f.stay(d1, ana, "responsible", mxAt("2025-03-03T16:00:00Z"), nil)
	f.lifecycle(d1, "close", mxAt("2025-04-07T18:00:00Z"), mxPtr("cancelled"))
	f.lifecycle(d1, "reopen", mxAt("2025-04-08T18:00:00Z"), nil)
	f.lifecycle(d1, "close", mxAt("2025-04-14T18:00:00Z"), mxPtr("filled"))
	// filled → reopen → other: one vacancy, other.
	d2 := f.draft("Deshecha", published, nil, nil, "with_responsible")
	f.stay(d2, ana, "responsible", mxAt("2025-03-03T16:00:00Z"), nil)
	f.lifecycle(d2, "close", mxAt("2025-04-09T18:00:00Z"), mxPtr("filled"))
	f.lifecycle(d2, "reopen", mxAt("2025-04-10T18:00:00Z"), nil)
	f.lifecycle(d2, "close", mxAt("2025-04-22T18:00:00Z"), mxPtr("other"))

	// Late by 1, 3 and 6 business days after Friday Apr 4.
	cutoff := uuid.New()
	for i, reached := range []string{"2025-04-07T18:00:00Z", "2025-04-09T18:00:00Z", "2025-04-14T18:00:00Z"} {
		d := f.draft("Tarde "+string(rune('A'+i)), published, nil, nil, "with_responsible")
		f.delivery(d, cutoff, 1, "2025-04-04")
		f.fulfill(d, cutoff, "2025-04-04", mxAt(reached), mxAt(reached))
	}
	// Five overdue deliveries; business days from the commitment to Apr 30.
	overdue := map[string]uuid.UUID{}
	for _, o := range []struct{ title, commitment string }{{"Zeta", "2025-04-10"}, {"Eme", "2025-04-25"}, {"Alfa", "2025-04-10"}, {"Beta", "2025-04-01"}, {"Ce", "2025-04-21"}} {
		d := f.draft(o.title, published, nil, nil, "with_responsible")
		f.delivery(d, cutoff, 2, o.commitment)
		overdue[o.title] = d
	}

	month := []any{map[string]any{"month": "2025-04", "closed": 2, "filled": 1, "cancelled": 0, "other": 1, "no_reason": 0}}
	closures := f.get(f.owner, "closures?"+april)
	editJSONEqual(t, closures["closed_by_month"], mxJSON(t, month))
	editJSONEqual(t, closures["delivery_status"], mxJSON(t, map[string]any{"on_time": 0, "late": 3, "overdue": 5, "pending": 0, "not_configured": 2}))
	summary := f.get(f.owner, "summary?"+april)
	editJSONEqual(t, summary["vacancies"].(map[string]any)["closed"], mxJSON(t, map[string]any{"filled": 1, "cancelled": 0, "other": 1, "no_reason": 0}))
	// Mar 3 → Apr 14 (first filled close of the vacancy last closed filled):
	// 30 weekdays less the Mar 17 holiday.
	if got := summary["vacancies"].(map[string]any)["median_business_days_to_close"]; got != float64(29) {
		t.Fatalf("median to close %v", got)
	}

	compliance := f.get(f.owner, "compliance?"+april)
	editJSONEqual(t, compliance["late_buckets"], mxJSON(t, map[string]any{"up_to_2": 1, "from_3_to_5": 1, "over_5": 1}))
	editJSONEqual(t, compliance["on_time_by_month"], mxJSON(t, []any{map[string]any{"month": "2025-04", "rate": mxRate(0, 0, 8)}}))

	row := func(title, commitment string, days int) map[string]any {
		return map[string]any{"vacancy": map[string]any{"draft_id": overdue[title].String(), "title": title},
			"requester": nil, "attributed_to": []any{},
			"commitment_date": commitment, "business_days_overdue": days, "delivered": 0, "target": 2}
	}
	delays := f.get(f.owner, "delays?"+april)
	editJSONEqual(t, delays["overdue"], mxJSON(t, map[string]any{"total": 5, "top": []any{
		row("Beta", "2025-04-01", 21), row("Alfa", "2025-04-10", 14), row("Zeta", "2025-04-10", 14), row("Ce", "2025-04-21", 7)}}))
	editJSONEqual(t, delays["closing_target"], mxJSON(t, map[string]any{"on_time": 0, "late": 0, "no_target": 1}))
}
