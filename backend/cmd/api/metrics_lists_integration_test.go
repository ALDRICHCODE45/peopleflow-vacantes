//go:build integration

package main

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Detail lists and CSV exports (stakeholder-metrics-v2 §5, §6, §8) through the
// production router, over the mxScenario company.

var mxListRoutes = []string{"deliveries", "placements", "deliveries/export", "vacancies/export", "placements/export", "reassignments/export"}

func TestMetricsLists_Gate(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	for _, route := range mxListRoutes {
		path := "/v2/me/company/metrics/" + route + "?" + mxRange
		r := h.do(t, "GET", path, "", s.anaActor.token, nil)
		shAssertBody(t, r, 403, map[string]any{"error": "insufficient role", "code": "forbidden"})
		draftFlowAssertNoStore(t, r)
		draftFlowAssertCatalogError(t, h.do(t, "GET", path, "", "", nil), 401, "unauthenticated")
		for _, actor := range []draftFlowActor{s.owner, s.stakeholderActor} {
			r := h.do(t, "GET", path, "", actor.token, nil)
			if r.status != 200 {
				t.Fatalf("%s: %d %s", route, r.status, r.body)
			}
			draftFlowAssertNoStore(t, r)
		}
		// Same strict parser; a rejected request writes nothing.
		before := s.auditCount("")
		r = h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+mxRange+"&sort=nope", "", s.owner.token, nil)
		shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{map[string]any{"field": "sort", "code": "invalid"}}})
		if s.auditCount("") != before {
			t.Fatalf("%s: rejected request audited", route)
		}
	}
	// Another company's lists see none of this company's rows.
	other := newMXFixture(t, h)
	for _, route := range []string{"deliveries", "vacancies", "placements", "reassignments"} {
		if body := other.get(other.owner, route+"?"+mxRange); body["total"] != float64(0) || len(body["items"].([]any)) != 0 {
			t.Fatalf("other company %s: %v", route, body)
		}
	}
}

// mxTotal reads a list's total for a drill-down query.
func (s *mxScenario) total(kind, query string) int {
	s.t.Helper()
	return int(s.get(s.owner, kind+"?"+query)["total"].(float64))
}

func mxNum(v any) int { return int(v.(float64)) }

func mxAt2(v any, keys ...string) any {
	for _, k := range keys {
		v = v.(map[string]any)[k]
	}
	return v
}

// Every §4 figure that opens deliveries, vacancies, placements or
// reassignments equals the total of its list for the same query, with and
// without the common filters, for the period and its previous period.
func TestMetricsLists_FigureEqualsTotal(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	type check struct {
		name   string
		figure int
		kind   string
		query  string
	}
	for _, common := range []string{"", "&requester_kind=client", "&recruiter_id=" + s.ana.String(), "&requester_id=none"} {
		for _, period := range []string{mxRange, "from=2024-10-03&to=2024-12-31"} {
			base := period + common
			summary := s.get(s.owner, "summary?"+base)
			closures := s.get(s.owner, "closures?"+base)
			compliance := s.get(s.owner, "compliance?"+base)
			delays := s.get(s.owner, "delays?"+base)
			checks := []check{
				// §4.1
				{"on-time rate", mxNum(mxAt2(summary, "headline", "on_time_rate", "current", "denominator")), "deliveries", "result=on_time,late,overdue"},
				{"on-time numerator", mxNum(mxAt2(summary, "headline", "on_time_rate", "current", "numerator")), "deliveries", "result=on_time"},
				{"assigned", mxNum(mxAt2(summary, "headline", "assigned", "current")), "vacancies", "scope=assigned"},
				{"median to close sample", mxNum(mxAt2(summary, "vacancies", "closed", "filled")), "vacancies", "scope=closed&close_reason=filled&sort=business_days_to_close"},
				{"placements", mxNum(mxAt2(summary, "headline", "placements", "current")), "placements", ""},
				{"reassignments", mxNum(mxAt2(summary, "headline", "reassignments", "current")), "reassignments", ""},
			}
			for _, raw := range summary["on_time_by_month"].([]any) {
				m := raw.(map[string]any)
				checks = append(checks, check{"on-time month " + m["month"].(string), mxNum(mxAt2(m, "rate", "denominator")), "deliveries", "result=on_time,late,overdue&commitment_month=" + m["month"].(string)})
			}
			// §4.2
			for _, raw := range closures["closed_by_month"].([]any) {
				m := raw.(map[string]any)
				month := m["month"].(string)
				checks = append(checks,
					check{"closed " + month, mxNum(m["closed"]), "vacancies", "scope=closed&closed_month=" + month},
					check{"filled " + month, mxNum(m["filled"]), "vacancies", "scope=closed&closed_month=" + month + "&close_reason=filled"})
			}
			for status, n := range closures["delivery_status"].(map[string]any) {
				checks = append(checks, check{"status " + status, mxNum(n), "deliveries", "result=" + status})
			}
			// §4.3
			for bucket, n := range compliance["late_buckets"].(map[string]any) {
				checks = append(checks, check{"bucket " + bucket, mxNum(n), "deliveries", "result=late&late_bucket=" + bucket})
			}
			// §4.5
			for target, n := range delays["closing_target"].(map[string]any) {
				checks = append(checks, check{"closing target " + target, mxNum(n), "vacancies", "scope=closed&close_reason=filled&closing_target=" + target})
			}
			checks = append(checks, check{"overdue", mxNum(mxAt2(delays, "overdue", "total")), "deliveries", "result=overdue&sort=business_days_overdue&order=desc"})
			for reason, n := range delays["reassignments_by_reason"].(map[string]any) {
				checks = append(checks, check{"reason " + reason, mxNum(n), "reassignments", "reason=" + reason})
			}
			// §4.6 recruiter cards (the cards attribute across the requester
			// scope; the card's own recruiter is the drill-down's filter).
			if !strings.Contains(common, "recruiter_id") {
				for _, u := range []uuid.UUID{s.ana, s.beto, s.carla} {
					card := s.get(s.owner, "recruiters/"+u.String()+"?"+base)
					id := u.String()
					d, p, r := card["delivery"].(map[string]any), card["placements"].(map[string]any), card["reassignments"].(map[string]any)
					checks = append(checks,
						check{"card on-time M " + id, mxNum(d["on_time"]) + mxNum(d["late"]) + mxNum(d["overdue"]), "deliveries", "attributed_to=" + id + "&result=on_time,late,overdue"},
						check{"card on-time N " + id, mxNum(d["on_time"]), "deliveries", "attributed_to=" + id + "&result=on_time"},
						check{"card assigned " + id, mxNum(mxAt2(card, "vacancies", "assigned")), "vacancies", "scope=assigned&recruiter_id=" + id},
						check{"card placements " + id, mxNum(p["direct"]) + mxNum(p["participant"]) + mxNum(p["shared"]), "placements", "recipient=" + id},
						check{"card conversion M " + id, mxNum(mxAt2(p, "conversion", "denominator")), "vacancies", "scope=closed_assigned&recruiter_id=" + id},
						check{"card conversion N " + id, mxNum(mxAt2(p, "conversion", "numerator")), "vacancies", "scope=closed_assigned&recruiter_id=" + id + "&credited_to=" + id},
						check{"card received " + id, mxNum(r["received"]), "reassignments", "recruiter_id=" + id + "&direction=received"},
						check{"card lost " + id, mxNum(r["lost"]), "reassignments", "recruiter_id=" + id + "&direction=lost"},
					)
				}
			}
			nonzero := 0
			for _, c := range checks {
				query := base + "&" + c.query
				if c.query == "" {
					query = base
				}
				if strings.Contains(c.query, "recruiter_id=") && strings.Contains(common, "recruiter_id=") {
					continue
				}
				if got := s.total(c.kind, query); got != c.figure {
					t.Fatalf("%s %s (%s): figure %d, list total %d", period, common, c.name, c.figure, got)
				}
				if c.figure > 0 {
					nonzero++
				}
			}
			if period == mxRange && common == "" && nonzero < 30 {
				t.Fatalf("only %d non-zero figures checked", nonzero)
			}
		}
	}
}

// Facets ignore only their own filter and add up to the total without it.
func TestMetricsLists_FacetsAndAppliedFilters(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	body := s.get(s.owner, "deliveries?"+mxRange+"&result=late&requester_kind=client")
	editJSONEqual(t, body["facets"], mxJSON(t, map[string]any{"result": map[string]any{"on_time": 1, "late": 1, "overdue": 1, "pending": 0, "not_configured": 0}, "process_kind": map[string]any{"original": 1, "replacement": 0}}))
	if body["total"] != float64(1) {
		t.Fatalf("total %v", body["total"])
	}
	editJSONEqual(t, s.get(s.owner, "vacancies?"+mxRange)["facets"], mxJSON(t, map[string]any{"close_reason": map[string]any{"filled": 1, "cancelled": 1, "other": 0, "no_reason": 1}}))
	editJSONEqual(t, s.get(s.owner, "placements?"+mxRange+"&held=false")["facets"], mxJSON(t, map[string]any{"held": map[string]any{"true": 1, "false": 1}, "process_kind": map[string]any{"original": 1, "replacement": 0}}))
	editJSONEqual(t, s.get(s.owner, "reassignments?"+mxRange+"&reason=other")["facets"], mxJSON(t, map[string]any{"reason": map[string]any{"workload": 1, "recruiter_departure": 1, "performance": 0, "client_request": 0, "other": 0}, "process_kind": map[string]any{"original": 0, "replacement": 0}}))

	// Applied filters: names resolved, a former member flagged, plain filters
	// as sent, absent keys absent.
	got := s.get(s.owner, "deliveries?"+mxRange+"&recruiter_id="+s.carla.String()+"&attributed_to="+s.ana.String()+"&result=overdue,late&requester_kind=client&requester_id="+s.acme.String()+"&vacancy_id="+s.v2.String())
	editJSONEqual(t, got["applied_filters"], mxJSON(t, map[string]any{
		"recruiter":     mxPerson(s.carla, "Carla", true),
		"attributed_to": mxPerson(s.ana, "Ana", false),
		"requester":     map[string]any{"kind": "client", "id": s.acme.String(), "name": "Acme"},
		"vacancy":       map[string]any{"draft_id": s.v2.String(), "title": "Dos"},
		"result":        []any{"overdue", "late"},
	}))
	// Nothing leaks across companies: another company's member, requester and
	// vacancy resolve with null names; the list is simply empty.
	other := newMXFixture(t, h)
	stranger, _ := other.member("recruiter", "Ajeno Secreto")
	foreignRequester := other.requester("client", "Cliente Ajeno")
	foreignVacancy := other.draft("Vacante Ajena", mxPtr(mxAt("2025-01-06T16:00:00Z")), nil, nil, "with_responsible")
	got = s.get(s.owner, "placements?"+mxRange+"&recipient="+stranger.String()+"&requester_kind=client&requester_id="+foreignRequester.String()+"&vacancy_id="+foreignVacancy.String())
	if got["total"] != float64(0) || len(got["items"].([]any)) != 0 {
		t.Fatalf("foreign filters: %v", got)
	}
	editJSONEqual(t, got["applied_filters"], mxJSON(t, map[string]any{
		"recipient": mxPerson(stranger, nil, true),
		"requester": map[string]any{"kind": "client", "id": foreignRequester.String(), "name": nil},
		"vacancy":   map[string]any{"draft_id": foreignVacancy.String(), "title": nil},
	}))
	if strings.Contains(fmt.Sprint(got), "Ajen") {
		t.Fatal("foreign name leaked")
	}
	// The audit row of that page does not set the foreign vacancy column.
	var vacancyColumn *uuid.UUID
	var metaVacancy string
	if err := h.pool.QueryRow(context.Background(), `SELECT vacancy_id, metadata->>'vacancy_id' FROM audit_events WHERE company_id=$1 AND event_type='MetricsDetailViewed' ORDER BY occurred_at DESC, id DESC LIMIT 1`, s.company.companyID).Scan(&vacancyColumn, &metaVacancy); err != nil {
		t.Fatal(err)
	}
	if vacancyColumn != nil || metaVacancy != foreignVacancy.String() {
		t.Fatalf("audit vacancy %v %s", vacancyColumn, metaVacancy)
	}
}

func TestMetricsLists_DeliveriesRowsSortAndPages(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	acme := map[string]any{"kind": "client", "id": s.acme.String(), "name": "Acme"}
	body := s.get(s.owner, "deliveries?"+mxRange+"&result=late")
	editJSONEqual(t, body["items"], mxJSON(t, []any{map[string]any{
		"vacancy": map[string]any{"draft_id": s.v5.String(), "title": "Cinco"}, "requester": acme,
		"attributed_to": []any{mxPerson(s.beto, "Beto", false)}, "commitment_date": "2025-01-31", "original_commitment_date": "2025-01-31",
		"renegotiations": 0, "target_reached_at": "2025-02-05T18:00:00Z", "result": "late", "business_days_late": 2,
		"business_days_overdue": nil, "delivered": 1, "target": 1,
	}}))
	for _, k := range []string{"definitions_version", "period", "as_of", "total", "facets", "applied_filters", "items", "next_cursor"} {
		if _, ok := body[k]; !ok {
			t.Fatalf("missing %s", k)
		}
	}
	title := func(item any) string { return item.(map[string]any)["vacancy"].(map[string]any)["title"].(string) }
	for sort, want := range map[string][]string{
		"":                                  {"Cuatro", "Dos", "Cinco", "Uno", "Tres"}, // commitment desc, not configured last
		"&order=asc":                        {"Uno", "Cinco", "Dos", "Cuatro", "Tres"},
		"&sort=title":                       {"Cinco", "Cuatro", "Dos", "Tres", "Uno"},
		"&sort=title&order=desc":            {"Uno", "Tres", "Dos", "Cuatro", "Cinco"},
		"&sort=business_days_overdue":       {"Dos"},
		"&sort=delivered&order=desc":        {"Uno", "Cinco"},
		"&sort=target_reached_at&order=asc": {"Uno", "Cinco"},
	} {
		var walked []string
		path := "deliveries?" + mxRange + sort + "&limit=2"
		for pages := 0; ; pages++ {
			page := s.get(s.owner, path)
			if page["total"] != float64(5) {
				t.Fatalf("%q total %v", sort, page["total"])
			}
			for _, item := range page["items"].([]any) {
				walked = append(walked, title(item))
			}
			if page["next_cursor"] == nil {
				break
			}
			path = "deliveries?" + mxRange + sort + "&limit=2&cursor=" + page["next_cursor"].(string)
		}
		if len(walked) != 5 || strings.Join(walked[:len(want)], ",") != strings.Join(want, ",") {
			t.Fatalf("%q: %v, want prefix %v", sort, walked, want)
		}
	}
	// The cursor binds the sort and the order.
	page := s.get(s.owner, "deliveries?"+mxRange+"&sort=title&limit=2")
	cursor := "&cursor=" + page["next_cursor"].(string)
	for _, q := range []string{"&sort=delivered&limit=2", "&sort=title&order=desc&limit=2", "&limit=2"} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", "/v2/me/company/metrics/deliveries?"+mxRange+q+cursor, "", s.owner.token, nil), 400, "invalid_cursor")
	}
	// A repeated multi-value parameter stays duplicate.
	r := h.do(t, "GET", "/v2/me/company/metrics/deliveries?"+mxRange+"&result=late&result=on_time", "", s.owner.token, nil)
	shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{map[string]any{"field": "result", "code": "duplicate"}}})
	r = h.do(t, "GET", "/v2/me/company/metrics/reassignments?"+mxRange+"&direction=lost", "", s.owner.token, nil)
	shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{map[string]any{"field": "recruiter_id", "code": "required"}}})
}

func TestMetricsLists_PlacementsAuditedPerPage(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	candidate := func(pid uuid.UUID, name string) map[string]any {
		var id string
		if err := h.pool.QueryRow(context.Background(), `SELECT candidate_id::text FROM process_participations WHERE id=$1`, pid).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return map[string]any{"id": id, "full_name": name}
	}
	before := s.auditCount("MetricsDetailViewed")
	first := s.get(s.stakeholderActor, "placements?"+mxRange+"&limit=1&vacancy_id="+s.v1.String())
	items := first["items"].([]any)
	if first["total"] != float64(2) || len(items) != 1 || first["next_cursor"] == nil {
		t.Fatalf("%v", first)
	}
	row := items[0].(map[string]any)
	credit := row["credit_id"]
	delete(row, "credit_id")
	acme := map[string]any{"kind": "client", "id": s.acme.String(), "name": "Acme"}
	// Newest hire first; voided credits are not listed; the company's name.
	editJSONEqual(t, row, mxJSON(t, map[string]any{"candidate": candidate(s.p3, "Candidata Tres"), "vacancy": map[string]any{"draft_id": s.v1.String(), "title": "Uno"},
		"requester": acme, "recipients": []any{map[string]any{"person": mxPerson(s.beto, "Beto", false), "kind": "direct"}}, "status": "did_not_hold", "hired_at": "2025-03-04T18:00:00Z"}))
	if _, err := uuid.Parse(credit.(string)); err != nil {
		t.Fatal(credit)
	}
	second := s.get(s.stakeholderActor, "placements?"+mxRange+"&limit=1&vacancy_id="+s.v1.String()+"&cursor="+first["next_cursor"].(string))
	if second["next_cursor"] != nil || second["items"].([]any)[0].(map[string]any)["candidate"].(map[string]any)["full_name"] != "Candidato Corregido" {
		t.Fatalf("%v", second)
	}
	rows, err := h.pool.Query(context.Background(), `SELECT actor_id, entity_type, entity_id, vacancy_id, metadata->>'report', metadata->>'vacancy_id', metadata->'filters', metadata ? 'cursor' OR metadata->'filters' ? 'cursor'
 FROM audit_events WHERE company_id=$1 AND event_type='MetricsDetailViewed' ORDER BY occurred_at, id`, s.company.companyID)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for rows.Next() {
		var actor, entity uuid.UUID
		var vacancy *uuid.UUID
		var entityType, report, metaVacancy string
		var filters map[string]any
		var cursor bool
		if err := rows.Scan(&actor, &entityType, &entity, &vacancy, &report, &metaVacancy, &filters, &cursor); err != nil {
			t.Fatal(err)
		}
		n++
		if actor != s.stakeholder || entityType != "vacancy" || entity != s.v1 || vacancy == nil || *vacancy != s.v1 || report != "placements" || metaVacancy != s.v1.String() || cursor {
			t.Fatalf("audit row %d", n)
		}
		editJSONEqual(t, filters, mxJSON(t, map[string]any{"from": "2025-01-01", "to": "2025-03-31", "vacancy_id": s.v1.String(), "sort": "hired_at", "order": "desc", "limit": 1}))
	}
	rows.Close()
	if n != before+2 {
		t.Fatalf("audit rows %d", n)
	}
	// Not audited lists write nothing.
	count := s.auditCount("")
	for _, route := range []string{"deliveries", "vacancies", "reassignments"} {
		s.get(s.owner, route+"?"+mxRange)
	}
	if s.auditCount("") != count {
		t.Fatal("unaudited list wrote audit rows")
	}
}

// A failed audit insert fails the page and the export: 500, nothing served.
func TestMetricsLists_AuditFailureServesNothing(t *testing.T) {
	for _, event := range []string{"MetricsDetailViewed", "MetricsDetailExported"} {
		fault := &teamFailAudit{event: event}
		h := newDraftFlowHarnessWithAudit(t, fault)
		s := newMXScenario(t, h)
		fault.enabled.Store(true)
		route := "placements"
		if event == "MetricsDetailExported" {
			route = "placements/export"
		}
		r := h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+mxRange, "", s.owner.token, nil)
		draftFlowAssertCatalogError(t, r, 500, "internal_error")
		if strings.Contains(string(r.body), "Candidat") || s.auditCount(event) != 0 {
			t.Fatalf("%s: served %s", event, r.body)
		}
		fault.enabled.Store(false)
		if r := h.do(t, "GET", "/v2/me/company/metrics/"+route+"?"+mxRange, "", s.owner.token, nil); r.status != 200 || s.auditCount(event) != 1 {
			t.Fatalf("%s after recovery: %d", event, r.status)
		}
	}
}

func TestMetricsLists_ExportCSV(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	export := func(kind, query string) draftFlowResponse {
		t.Helper()
		return h.do(t, "GET", "/v2/me/company/metrics/"+kind+"/export?"+mxRange+query, "", s.owner.token, nil)
	}
	for kind, header := range map[string][]string{
		"deliveries":    {"ID vacante", "Vacante", "Solicitante", "Atribuida a", "Fecha compromiso", "Fecha compromiso original", "Renegociaciones", "Meta alcanzada", "Resultado", "Días hábiles de retraso", "Días hábiles vencida", "Entregados", "Meta"},
		"vacancies":     {"ID vacante", "Vacante", "Solicitante", "Responsable", "Publicada", "Último cierre", "Motivo del último cierre", "Días hábiles para cerrar", "Objetivo de cierre", "Resultado de entrega", "Cubiertas", "Requeridas", "Reasignaciones"},
		"placements":    {"ID crédito", "ID candidato", "Candidato", "ID vacante", "Vacante", "Solicitante", "Reconocidos", "Estado", "Contratado"},
		"reassignments": {"ID reasignación", "Fecha", "ID vacante", "Vacante", "De", "A", "Motivo", "Nota", "Realizada por", "Días hábiles del tramo saliente"},
	} {
		r := export(kind, "")
		if r.status != 200 || r.header.Get("Content-Type") != "text/csv; charset=utf-8" ||
			r.header.Get("Content-Disposition") != `attachment; filename="metricas-`+kind+`-2025-01-01-2025-03-31.csv"` {
			t.Fatalf("%s: %d %v", kind, r.status, r.header)
		}
		draftFlowAssertNoStore(t, r)
		rows := parseCSV(t, r.body)
		if strings.Join(rows[0], "|") != strings.Join(header, "|") {
			t.Fatalf("%s header %v", kind, rows[0])
		}
		// Same rows as the list's total.
		if len(rows)-1 != s.total(kind, mxRange) {
			t.Fatalf("%s: %d rows", kind, len(rows)-1)
		}
	}
	// Same filters and order as the list; ISO dates.
	rows := parseCSV(t, export("deliveries", "&sort=title&order=desc&result=on_time,late").body)
	if len(rows) != 3 || rows[1][1] != "Uno" || rows[2][1] != "Cinco" || rows[2][4] != "2025-01-31" || rows[2][7] != "2025-02-05T18:00:00Z" ||
		rows[2][2] != "Acme" || rows[2][3] != "Beto" || rows[2][9] != "2" {
		t.Fatalf("%q", rows)
	}
	vac := parseCSV(t, export("vacancies", "&requester_id=none").body)
	if len(vac) != 2 || vac[1][2] != "Sin solicitante" || vac[1][5] != "2025-01-31" || vac[1][6] != "cancelled" {
		t.Fatalf("%q", vac)
	}
	// The placements export is audited once, with the row count.
	before := s.auditCount("MetricsDetailExported")
	if r := export("placements", "&held=true"); r.status != 200 || len(parseCSV(t, r.body)) != 2 {
		t.Fatalf("%d", r.status)
	}
	var report string
	var count int
	var filters map[string]any
	if err := h.pool.QueryRow(context.Background(), `SELECT metadata->>'report', (metadata->>'row_count')::int, metadata->'filters' FROM audit_events WHERE company_id=$1 AND event_type='MetricsDetailExported' ORDER BY occurred_at DESC LIMIT 1`, s.company.companyID).Scan(&report, &count, &filters); err != nil {
		t.Fatal(err)
	}
	if s.auditCount("MetricsDetailExported") != before+1 || report != "placements" || count != 1 {
		t.Fatalf("export audit %s %d", report, count)
	}
	editJSONEqual(t, filters, mxJSON(t, map[string]any{"from": "2025-01-01", "to": "2025-03-31", "held": true, "sort": "hired_at", "order": "desc"}))
	if s.auditCount("MetricsDetailExported") != before+1 {
		t.Fatal("unaudited kinds wrote export rows")
	}
	// No cursor and no limit.
	r := export("deliveries", "&cursor=x&limit=5")
	shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{map[string]any{"field": "cursor", "code": "unknown"}, map[string]any{"field": "limit", "code": "unknown"}}})
}

func TestMetricsLists_ExportTooLargeExportsNothing(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXScenario(t, h)
	h.metrics.WithExportLimit(1)
	t.Cleanup(func() { h.metrics.WithExportLimit(50_000) })
	before := s.auditCount("")
	for kind, rows := range map[string]int{"deliveries": 5, "vacancies": 5, "placements": 2, "reassignments": 2} {
		r := h.do(t, "GET", "/v2/me/company/metrics/"+kind+"/export?"+mxRange, "", s.owner.token, nil)
		draftFlowAssertNoStore(t, r)
		want := fmt.Sprintf(`{"error":"metrics export too large","code":"metrics_export_too_large","row_count":%d,"limit":1}`, rows) + "\n"
		if r.status != 422 || string(r.body) != want {
			t.Fatalf("%s: %d %s", kind, r.status, r.body)
		}
	}
	if s.auditCount("") != before {
		t.Fatal("too large export audited")
	}
	// Exactly at the limit is allowed.
	if r := h.do(t, "GET", "/v2/me/company/metrics/placements/export?"+mxRange+"&held=true", "", s.owner.token, nil); r.status != 200 {
		t.Fatalf("at the limit %d", r.status)
	}
}
