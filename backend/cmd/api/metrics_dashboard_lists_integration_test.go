//go:build integration

package main

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
)

// Company dashboard v2 lists (company-dashboard-v2 §5) through the production
// router, on the d2a scenario (newMXDashboard): every d2a figure equals the
// total of the list it opens, for the owner and both recruiters; a recruiter
// never sees another's rows; not audited (DD4).

var mxDashboardLists = []string{"candidates", "deliveries", "vacancies", "applications"}

func (s *mxDashboard) list(actor draftFlowActor, kind, query string) map[string]any {
	s.t.Helper()
	r := s.h.do(s.t, "GET", "/v2/me/company/dashboard/lists/"+kind+"?"+query, "", actor.token, nil)
	if r.status != 200 {
		s.t.Fatalf("GET %s?%s: %d %s", kind, query, r.status, r.body)
	}
	draftFlowAssertNoStore(s.t, r)
	return draftFlowObject(s.t, r.body)
}

func (s *mxDashboard) listTotal(actor draftFlowActor, kind, query string) int {
	s.t.Helper()
	return mxNum(s.list(actor, kind, query)["total"])
}

func TestDashboardLists_Gate(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	for _, kind := range mxDashboardLists {
		for _, path := range []string{"/v2/me/company/dashboard/lists/" + kind, "/v2/me/company/dashboard/lists/" + kind + "/export"} {
			r := h.do(t, "GET", path, "", s.stakeholderActor.token, nil)
			shAssertBody(t, r, 403, map[string]any{"error": "insufficient role", "code": "forbidden"})
			draftFlowAssertNoStore(t, r)
			draftFlowAssertCatalogError(t, h.do(t, "GET", path, "", "", nil), 401, "unauthenticated")
			// No filter widens the scope.
			for query, field := range map[string]map[string]any{
				"recruiter_id=" + s.beto.String(): {"field": "recruiter_id", "code": "unknown"},
				"scope=company":                   {"field": "scope", "code": "unknown"},
				"window=14":                       {"field": "window", "code": "invalid"},
			} {
				r := h.do(t, "GET", path+"?"+query, "", s.anaActor.token, nil)
				shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{field}})
			}
		}
	}
	r := h.do(t, "GET", "/v2/me/company/dashboard/lists/candidates?in_process=true&on=2026-03-01&window=7", "", s.owner.token, nil)
	shAssertBody(t, r, 422, map[string]any{"error": "invalid filter", "code": "invalid_filter", "fields": []any{map[string]any{"field": "on", "code": "range"}}})
	r = h.do(t, "GET", "/v2/me/company/dashboard/lists/candidates?cursor=bad", "", s.owner.token, nil)
	draftFlowAssertCatalogError(t, r, 400, "invalid_cursor")
}

func TestDashboardLists_FigureEqualsTotal(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	audits := s.auditCount("")
	for name, actor := range map[string]draftFlowActor{"owner": s.owner, "ana": s.anaActor, "beto": s.betoActor} {
		check := func(figure string, got, want int) {
			t.Helper()
			if got != want {
				t.Errorf("%s %s: list %d, figure %d", name, figure, got, want)
			}
		}
		sum := s.dash(actor, "summary?window=7")
		ip := sum["in_process"].(map[string]any)
		for _, raw := range ip["series"].([]any) {
			p := raw.(map[string]any)
			check("in_process "+p["date"].(string), s.listTotal(actor, "candidates", "window=7&in_process=true&on="+p["date"].(string)), mxNum(p["value"]))
		}
		check("in_process current", s.listTotal(actor, "candidates", "window=7&in_process=true"), mxNum(ip["current"]))
		pub := s.list(actor, "vacancies", "window=7&status=published&sort=positions_open")
		check("published", mxNum(pub["total"]), mxNum(sum["published_vacancies"].(map[string]any)["current"]))
		covered, required := 0, 0
		for _, raw := range pub["items"].([]any) {
			pos := raw.(map[string]any)["positions"].(map[string]any)
			covered, required = covered+mxNum(pos["covered"]), required+mxNum(pos["required"])
		}
		pos := sum["positions"].(map[string]any)
		check("positions covered", covered, mxNum(pos["covered"]))
		check("positions required", required, mxNum(pos["required"]))
		// The response-level aggregate covers every page of the filtered list.
		paged := s.list(actor, "vacancies", "window=7&status=published&sort=positions_open&limit=1")["positions"].(map[string]any)
		check("list positions covered", mxNum(paged["covered"]), mxNum(pos["covered"]))
		check("list positions required", mxNum(paged["required"]), mxNum(pos["required"]))

		att := s.dash(actor, "attention")
		check("overdue", s.listTotal(actor, "deliveries", "state=overdue"), mxNum(att["overdue"].(map[string]any)["total"]))
		check("due_this_week", s.listTotal(actor, "deliveries", "state=due_this_week"), mxNum(att["due_this_week"].(map[string]any)["total"]))
		check("stalled", s.listTotal(actor, "candidates", "stalled=true"), mxNum(att["stalled"].(map[string]any)["total"]))

		for _, raw := range s.dash(actor, "pipeline")["stages"].([]any) {
			st := raw.(map[string]any)
			check("stage "+st["kind"].(string), s.listTotal(actor, "candidates", "stage_kind="+st["kind"].(string)), mxNum(st["candidates"]))
			check("stalled "+st["kind"].(string), s.listTotal(actor, "candidates", "stage_kind="+st["kind"].(string)+"&stalled=true"), mxNum(st["stalled"]))
		}
		for _, raw := range s.dash(actor, "vacancies")["top"].([]any) {
			top := raw.(map[string]any)
			id := top["vacancy"].(map[string]any)["draft_id"].(string)
			check("top "+id, s.listTotal(actor, "candidates", "in_process=true&vacancy_id="+id), mxNum(top["in_process"]))
		}
		for _, raw := range s.dash(actor, "origin?window=7")["by_day"].([]any) {
			d := raw.(map[string]any)
			day := "window=7&from=" + d["date"].(string) + "&to=" + d["date"].(string)
			check("origin "+d["date"].(string), s.listTotal(actor, "applications", day), mxNum(d["organic"])+mxNum(d["manual"]))
			check("origin manual "+d["date"].(string), s.listTotal(actor, "applications", day+"&channel=manual"), mxNum(d["manual"]))
		}
	}
	// The figures are not trivially zero on this scenario.
	if s.listTotal(s.owner, "candidates", "window=7&in_process=true&on=2026-03-19") != 4 || s.listTotal(s.owner, "deliveries", "state=overdue") != 1 {
		t.Fatal("scenario")
	}
	if n := s.auditCount(""); n != audits {
		t.Fatalf("dashboard lists wrote %d audit rows", n-audits)
	}
}

// A recruiter sees only their vacancies' rows, and another recruiter's
// vacancy_id answers an empty list with title null.
func TestDashboardLists_RecruiterScope(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	for _, kind := range mxDashboardLists {
		body := s.list(s.anaActor, kind, "window=90&limit=100")
		if text := fmt.Sprint(body); strings.Contains(text, "Beatriz") || strings.Contains(text, "Backend") || strings.Contains(text, "Cajero") || strings.Contains(text, "Carla") {
			t.Fatalf("%s: recruiter sees another's rows: %v", kind, body)
		}
		other := s.list(s.anaActor, kind, "window=90&vacancy_id="+s.b.String())
		vac := other["applied_filters"].(map[string]any)["vacancy"].(map[string]any)
		if mxNum(other["total"]) != 0 || len(other["items"].([]any)) != 0 || vac["title"] != nil || vac["draft_id"] != s.b.String() || other["scope"] != "own_vacancies" {
			t.Fatalf("%s: %v", kind, other)
		}
	}
	// The owner sees Backend's in-process candidate and its title.
	own := s.list(s.owner, "candidates", "in_process=true&vacancy_id="+s.b.String())
	if mxNum(own["total"]) != 1 || own["applied_filters"].(map[string]any)["vacancy"].(map[string]any)["title"] != "Backend" || own["scope"] != "company" {
		t.Fatalf("%v", own)
	}
	row := own["items"].([]any)[0].(map[string]any)
	if row["participation_id"] != s.pb1.String() || row["candidate"].(map[string]any)["full_name"] != "Beatriz Secreta" {
		t.Fatalf("%v", row)
	}
	// Another company sees none of these rows.
	other := newMXFixture(t, h)
	for _, kind := range mxDashboardLists {
		r := h.do(t, "GET", "/v2/me/company/dashboard/lists/"+kind+"?window=90", "", other.owner.token, nil)
		if r.status != 200 || strings.Contains(string(r.body), "Analista") || strings.Contains(string(r.body), "Pablo") {
			t.Fatalf("%s: %d %s", kind, r.status, r.body)
		}
	}
}

func TestDashboardLists_PaginationWalk(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	full := s.list(s.owner, "candidates", "limit=100")
	total := mxNum(full["total"])
	seen := map[string]bool{}
	query := "limit=1&sort=candidate"
	page := s.list(s.owner, "candidates", query)
	for {
		for _, raw := range page["items"].([]any) {
			seen[raw.(map[string]any)["participation_id"].(string)] = true
		}
		next, _ := page["next_cursor"].(string)
		if next == "" {
			break
		}
		page = s.list(s.owner, "candidates", query+"&cursor="+url.QueryEscape(next))
	}
	if len(seen) != total || total < 5 {
		t.Fatalf("walked %d of %d", len(seen), total)
	}
	first := s.list(s.owner, "candidates", query)
	r := h.do(t, "GET", "/v2/me/company/dashboard/lists/candidates?limit=1&sort=title&cursor="+url.QueryEscape(first["next_cursor"].(string)), "", s.owner.token, nil)
	draftFlowAssertCatalogError(t, r, 400, "invalid_cursor")
	r = h.do(t, "GET", "/v2/me/company/dashboard/lists/candidates?limit=1&sort=candidate&cursor="+url.QueryEscape(first["next_cursor"].(string)), "", s.anaActor.token, nil)
	draftFlowAssertCatalogError(t, r, 400, "invalid_cursor")
}

func TestDashboardLists_ExportCSV(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	audits := s.auditCount("")
	for kind, query := range map[string]string{"candidates": "in_process=true", "deliveries": "", "vacancies": "status=published", "applications": "window=7"} {
		for _, actor := range []draftFlowActor{s.owner, s.anaActor} {
			r := h.do(t, "GET", "/v2/me/company/dashboard/lists/"+kind+"/export?"+query, "", actor.token, nil)
			window := "2026-02-23-2026-03-24"
			if kind == "applications" {
				window = "2026-03-18-2026-03-24"
			}
			if r.status != 200 || r.header.Get("Content-Type") != "text/csv; charset=utf-8" ||
				r.header.Get("Content-Disposition") != `attachment; filename="dashboard-`+kind+`-`+window+`.csv"` {
				t.Fatalf("%s: %d %v %s", kind, r.status, r.header, r.body)
			}
			draftFlowAssertNoStore(t, r)
			rows := parseCSV(t, r.body)
			if want := len(s.list(actor, kind, query+"&limit=100")["items"].([]any)); len(rows)-1 != want {
				t.Fatalf("%s: %d rows, want %d", kind, len(rows)-1, want)
			}
		}
	}
	rows := parseCSV(t, h.do(t, "GET", "/v2/me/company/dashboard/lists/vacancies/export?status=published&sort=title", "", s.owner.token, nil).body)
	if strings.Join(rows[0], "|") != "ID vacante|Vacante|Solicitante|Responsable|Estado|Publicada|En proceso|Cubiertas|Requeridas|Tipo de proceso" ||
		len(rows) != 3 || rows[1][1] != "Analista" || rows[1][3] != "Ana" || rows[1][4] != "published" || rows[1][7] != "1" || rows[1][8] != "3" {
		t.Fatalf("%q", rows)
	}
	if n := s.auditCount(""); n != audits {
		t.Fatalf("exports wrote %d audit rows", n-audits)
	}
}
