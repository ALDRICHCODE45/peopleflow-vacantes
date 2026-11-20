//go:build integration

package main

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// The replacement keys of every row that names a vacancy, metrics and company
// dashboard (replacement-processes-v1 §«Metrics», R6b, Q1), through the
// production router.

var mxRefKeys = []string{"draft_id", "kind", "root_draft_id", "sequence", "title"}

// mxRefs collects every VacancyRef of a response: the objects under a «vacancy»
// key with a draft_id (applied_filters and the dashboard's recent rows keep
// their own shapes).
func mxRefs(v any, path string, out *[]map[string]any) {
	switch x := v.(type) {
	case map[string]any:
		for key, child := range x {
			if key == "applied_filters" || key == "recent" {
				continue
			}
			if m, ok := child.(map[string]any); ok && key == "vacancy" {
				if _, isRef := m["draft_id"]; isRef {
					*out = append(*out, m)
					continue
				}
			}
			mxRefs(child, path+"."+key, out)
		}
	case []any:
		for _, child := range x {
			mxRefs(child, path, out)
		}
	}
}

// mxCheckRefs asserts every ref has exactly the five keys, the right kind, root and
// sequence for the id it names, and returns the titles it saw.
func mxCheckRefs(t *testing.T, label string, body any, root uuid.UUID, replacements ...uuid.UUID) []string {
	t.Helper()
	var refs []map[string]any
	mxRefs(body, label, &refs)
	titles := []string{}
	for _, ref := range refs {
		keys := make([]string, 0, len(ref))
		for k := range ref {
			keys = append(keys, k)
		}
		slices.Sort(keys)
		if !slices.Equal(keys, mxRefKeys) {
			t.Errorf("%s: keys %v", label, keys)
			continue
		}
		id := ref["draft_id"].(string)
		titles = append(titles, ref["title"].(string))
		if slices.ContainsFunc(replacements, func(u uuid.UUID) bool { return u.String() == id }) {
			if ref["kind"] != "replacement" || ref["root_draft_id"] != root.String() || ref["sequence"] != float64(1) {
				t.Errorf("%s: replacement ref %v", label, ref)
			}
		} else if ref["kind"] != "original" || ref["root_draft_id"] != id || ref["sequence"] != nil {
			t.Errorf("%s: original ref %v", label, ref)
		}
	}
	return titles
}

func TestMetricsReplacement_EveryRowNamesItsProcess(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXReplacement(t, h)
	// A handover on the replacement gives the reassignments list a row of its own.
	var current uuid.UUID
	if err := h.pool.QueryRow(t.Context(), `SELECT id FROM vacancy_assignments WHERE draft_id=$1`, s.repl).Scan(&current); err != nil {
		t.Fatal(err)
	}
	next := s.tramo(s.repl, s.ana, mxAt("2025-03-03T16:00:00Z"), nil)
	s.reassign(s.repl, current, next, "workload", nil, mxAt("2025-03-03T16:00:00Z"))
	s.exec(`UPDATE process_participations SET stage_id=$2 WHERE id=$1`, s.pNora, mxStages(pipelineconfig.Defaults(s.repl))["screening"])

	seen := map[string][]string{}
	for _, path := range []string{"deliveries", "placements", "reassignments", "candidates", "applications", "delays", "pipeline"} {
		body := s.get(s.owner, path+"?"+mxReplRange)
		seen[path] = mxCheckRefs(t, path, body, s.root, s.repl)
		if !slices.Contains(seen[path], "Reemplazo") {
			t.Errorf("%s: no row names the replacement: %v", path, seen[path])
		}
	}
	// The ordinary vacancy keeps original / its own id / null.
	if !slices.Contains(seen["deliveries"], "Común") || !slices.Contains(seen["deliveries"], "Original") {
		t.Errorf("deliveries %v", seen["deliveries"])
	}
	// delays.overdue.top[].vacancy and pipeline.top_vacancies[].vacancy are the replacement.
	delays := s.get(s.owner, "delays?"+mxReplRange)
	top := delays["overdue"].(map[string]any)["top"].([]any)
	if len(top) != 1 || top[0].(map[string]any)["vacancy"].(map[string]any)["kind"] != "replacement" {
		t.Errorf("overdue.top %v", top)
	}
	pipeline := s.get(s.owner, "pipeline?"+mxReplRange)
	if tv := pipeline["top_vacancies"].([]any); len(tv) != 1 || tv[0].(map[string]any)["vacancy"].(map[string]any)["root_draft_id"] != s.root.String() {
		t.Errorf("top_vacancies %v", pipeline["top_vacancies"])
	}
	// applied_filters.vacancy is not a VacancyRef.
	applied := s.get(s.owner, "deliveries?"+mxReplRange+"&vacancy_id="+s.repl.String())["applied_filters"].(map[string]any)["vacancy"].(map[string]any)
	if len(applied) != 2 || applied["title"] != "Reemplazo" {
		t.Errorf("applied_filters.vacancy %v", applied)
	}
	// The flat vacancies rows are roots: no kind, and the chain's summary.
	rows := s.get(s.owner, "vacancies?"+mxReplRange)["items"].([]any)
	for _, it := range rows {
		row := it.(map[string]any)
		if _, has := row["kind"]; has {
			t.Errorf("flat vacancy row gained a kind: %v", row)
		}
		want := map[string]any{"count": float64(0), "active_draft_id": nil}
		if row["draft_id"] == s.root.String() {
			want = map[string]any{"count": float64(1), "active_draft_id": s.repl.String()}
		}
		if fmt.Sprint(row["replacements"]) != fmt.Sprint(want) {
			t.Errorf("%v: replacements %v, want %v", row["title"], row["replacements"], want)
		}
	}
	// Per-vacancy details name their process.
	for id, want := range map[uuid.UUID]string{
		s.repl: fmt.Sprint(map[string]any{"kind": "replacement", "root_draft_id": s.root.String(), "sequence": float64(1)}),
		s.root: fmt.Sprint(map[string]any{"kind": "original", "root_draft_id": s.root.String(), "sequence": nil}),
	} {
		for _, kind := range []string{"deliveries", "placements"} {
			got := s.get(s.owner, fmt.Sprintf("vacancies/%s/%s?%s", id, kind, mxReplRange))
			if fmt.Sprint(got["process"]) != want {
				t.Errorf("%s of %s: process %v, want %s", kind, id, got["process"], want)
			}
		}
	}
}

func TestMetricsReplacement_ExportsCarryTheProcessKind(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXReplacement(t, h)
	for _, kind := range []string{"deliveries", "placements", "candidates", "applications"} {
		r := h.do(t, "GET", "/v2/me/company/metrics/"+kind+"/export?"+mxReplRange, "", s.owner.token, nil)
		if r.status != 200 {
			t.Fatalf("%s: %d %s", kind, r.status, r.body)
		}
		rows := parseCSV(t, r.body)
		last := len(rows[0]) - 1
		if rows[0][last] != "Tipo de proceso" {
			t.Errorf("%s: header %q", kind, rows[0])
		}
		kinds := map[string]bool{}
		for _, row := range rows[1:] {
			kinds[row[last]] = true
		}
		if kind != "candidates" && (!kinds["original"] || !kinds["replacement"]) {
			t.Errorf("%s: kinds %v", kind, kinds)
		}
		only := parseCSV(t, h.do(t, "GET", "/v2/me/company/metrics/"+kind+"/export?"+mxReplRange+"&process_kind=replacement", "", s.owner.token, nil).body)
		for _, row := range only[1:] {
			if row[last] != "replacement" {
				t.Errorf("%s with process_kind=replacement: %q", kind, row)
			}
		}
	}
	vac := parseCSV(t, h.do(t, "GET", "/v2/me/company/metrics/vacancies/export?"+mxReplRange, "", s.owner.token, nil).body)
	if vac[0][len(vac[0])-1] != "Reasignaciones" || len(vac) != 3 {
		t.Errorf("vacancies export %q", vac)
	}
}

// mxDashboardChain is one logical vacancy on «now» = Tuesday 2026-03-24 12:00
// (Mexico City): the original closed covered and finished on 02-12, its private
// replacement (no projection) started that day and still open: overdue, with
// one candidate stalled in screening.
type mxDashboardChain struct {
	*mxFixture
	ana, beto           uuid.UUID
	anaActor, betoActor draftFlowActor
	root, repl, plain   uuid.UUID
}

func newMXDashboardChain(t *testing.T, h *draftFlowHarness) *mxDashboardChain {
	t.Helper()
	h.metrics.WithClock(func() time.Time { return mxAt("2026-03-24T18:00:00Z") })
	t.Cleanup(func() { h.metrics.WithClock(time.Now) })
	s := &mxDashboardChain{mxFixture: newMXFixture(t, h)}
	s.ana, s.anaActor = s.member("recruiter", "Ana")
	s.beto, s.betoActor = s.member("recruiter", "Beto")
	jan, feb := mxAt("2026-01-05T16:00:00Z"), mxAt("2026-02-12T16:00:00Z")

	s.root = s.draft("Original", &jan, nil, nil, "with_responsible")
	s.stay(s.root, s.ana, "responsible", jan, nil)
	s.management(s.root, mxPtr(2), nil)
	s.lifecycle(s.root, "close", mxAt("2026-02-10T18:00:00Z"), mxPtr("filled"))
	s.lifecycle(s.root, "finish_process", feb, nil)
	s.exec(`UPDATE vacancy_processes SET status='closed', closed_at=$2, process_status='finished', process_finished_at=$3 WHERE id=$1`, s.root, mxAt("2026-02-10T18:00:00Z"), feb)

	s.repl = s.replacement("Reemplazo", s.root, s.root, 1, feb, "with_responsible")
	s.stay(s.repl, s.ana, "responsible", feb, nil)
	s.management(s.repl, mxPtr(1), nil)
	stages := mxStages(pipelineconfig.Defaults(s.repl))
	s.delivery(s.repl, stages["screening"], 1, "2026-03-10")
	s.apply(s.repl, stages["screening"], "Pía Reemplazo", "portal", mxAt("2026-03-02T18:00:00Z"))

	// A company's ordinary vacancy, Beto's.
	s.plain = s.draft("Común", &jan, nil, nil, "with_responsible")
	s.stay(s.plain, s.beto, "responsible", jan, nil)
	s.management(s.plain, mxPtr(1), nil)
	s.apply(s.plain, mxStages(pipelineconfig.Defaults(s.plain))["screening"], "Carlos Común", "portal", mxAt("2026-03-03T18:00:00Z"))
	return s
}

func (s *mxDashboardChain) get(actor draftFlowActor, route string) map[string]any {
	s.t.Helper()
	r := s.h.do(s.t, "GET", "/v2/me/company/dashboard/"+route, "", actor.token, nil)
	if r.status != 200 {
		s.t.Fatalf("GET %s: %d %s", route, r.status, r.body)
	}
	draftFlowAssertNoStore(s.t, r)
	return draftFlowObject(s.t, r.body)
}

// An active private replacement counts as an active vacancy and the logical
// vacancy counts once (Q1); every dashboard row that names a vacancy carries the keys.
func TestDashboardReplacement_CountsOnceAndNamesTheProcess(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboardChain(t, h)
	for _, tc := range []struct {
		name      string
		actor     draftFlowActor
		published int
		titles    []string
	}{{"owner", s.owner, 2, []string{"Común", "Reemplazo"}}, {"ana", s.anaActor, 1, []string{"Reemplazo"}}} {
		sum := s.get(tc.actor, "summary?window=7")
		published := sum["published_vacancies"].(map[string]any)
		// The original is finished: the logical vacancy is the replacement, once, plus the ordinary one.
		if mxNum(published["current"]) != tc.published || mxNum(published["previous"]) != tc.published {
			t.Errorf("%s: published_vacancies %v", tc.name, published)
		}
		list := s.get(tc.actor, "lists/vacancies?status=published&sort=title&order=asc")
		if mxNum(list["total"]) != tc.published || len(list["items"].([]any)) != tc.published {
			t.Errorf("%s: list total %v", tc.name, list["total"])
		}
		if got := mxCheckRefs(t, tc.name+" lists/vacancies", list, s.root, s.repl); !slices.Equal(got, tc.titles) {
			t.Errorf("%s: published rows %v, want %v", tc.name, got, tc.titles)
		}
		all := s.get(tc.actor, "lists/vacancies?sort=title&order=asc")
		if tc.name == "owner" && (mxNum(all["total"]) != 3 || fmt.Sprint(all["facets"]) != "map[status:map[closed:0 finished:1 paused:0 published:2]]") {
			t.Errorf("owner all: %v %v", all["total"], all["facets"])
		}
		mxCheckRefs(t, tc.name+" lists/vacancies all", all, s.root, s.repl)
		section := s.get(tc.actor, "vacancies?window=7")
		if got := mxCheckRefs(t, tc.name+" vacancies", section, s.root, s.repl); !slices.Contains(got, "Reemplazo") {
			t.Errorf("%s: vacancies section %v", tc.name, got)
		}
		attention := s.get(tc.actor, "attention?window=7")
		if got := mxCheckRefs(t, tc.name+" attention", attention, s.root, s.repl); !slices.Contains(got, "Reemplazo") || mxNum(attention["overdue"].(map[string]any)["total"]) != 1 {
			t.Errorf("%s: attention %v", tc.name, attention)
		}
		for _, route := range []string{"lists/deliveries?state=overdue", "lists/candidates?in_process=true", "lists/candidates?stalled=true", "lists/applications?window=90"} {
			body := s.get(tc.actor, route)
			if got := mxCheckRefs(t, tc.name+" "+route, body, s.root, s.repl); !slices.Contains(got, "Reemplazo") {
				t.Errorf("%s %s: %v", tc.name, route, got)
			}
		}
		// recent keeps its own {id, title}.
		for _, row := range s.get(tc.actor, "recent?window=7")["recent"].([]any) {
			if v := row.(map[string]any)["vacancy"].(map[string]any); len(v) != 2 {
				t.Errorf("%s: recent vacancy %v", tc.name, v)
			}
		}
	}
	// The dashboard CSVs carry the process kind.
	for _, kind := range []string{"vacancies", "deliveries", "candidates", "applications"} {
		query := map[string]string{"candidates": "in_process=true", "applications": "window=90"}[kind]
		rows := parseCSV(t, s.h.do(t, "GET", "/v2/me/company/dashboard/lists/"+kind+"/export?"+query, "", s.owner.token, nil).body)
		if last := len(rows[0]) - 1; rows[0][last] != "Tipo de proceso" || !slices.ContainsFunc(rows[1:], func(r []string) bool { return strings.HasSuffix(r[last], "replacement") }) {
			t.Errorf("%s export: %q", kind, rows)
		}
	}
}
