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

// Replacement processes in the metrics (replacement-processes-v1 §«Metrics»,
// R6a): one logical vacancy, an original and a private replacement, read
// through the production router. "now" is Saturday 2025-03-15 (Mexico City).

const mxReplRange = "from=2025-01-01&to=2025-03-31"

type mxReplacement struct {
	*mxFixture
	ana, beto                uuid.UUID
	anaActor                 draftFlowActor
	root, repl, plain        uuid.UUID
	rootCutoff, replCutoff   uuid.UUID
	pLucia, pMario, pNora    uuid.UUID
	carried                  uuid.UUID
	creditLucia, creditMario uuid.UUID
}

func newMXReplacement(t *testing.T, h *draftFlowHarness) *mxReplacement {
	t.Helper()
	h.metrics.WithClock(func() time.Time { return mxAt("2025-03-15T18:00:00Z") })
	t.Cleanup(func() { h.metrics.WithClock(time.Now) })
	s := &mxReplacement{mxFixture: newMXFixture(t, h)}
	s.ana, s.anaActor = s.member("recruiter", "Ana")
	s.beto, _ = s.member("recruiter", "Beto")

	// The original: on-time delivery, two hires (one did not hold), closed filled.
	s.root = s.draft("Original", mxPtr(mxAt("2025-01-06T16:00:00Z")), nil, nil, "with_responsible")
	a := s.stay(s.root, s.ana, "responsible", mxAt("2025-01-06T16:00:00Z"), nil)
	s.rootCutoff = mxStages(pipelineconfig.Defaults(s.root))["screening"]
	rootNew := mxStages(pipelineconfig.Defaults(s.root))["new"]
	s.delivery(s.root, s.rootCutoff, 1, "2025-01-20")
	s.pLucia = s.apply(s.root, s.rootCutoff, "Lucía", "portal", mxAt("2025-01-10T18:00:00Z"))
	s.fulfill(s.root, s.rootCutoff, "2025-01-20", mxAt("2025-01-10T18:00:00Z"), mxAt("2025-01-10T18:00:00Z"))
	s.pMario = s.apply(s.root, rootNew, "Mario", "portal", mxAt("2025-01-12T18:00:00Z"))
	s.management(s.root, mxPtr(2), mxPtr("2025-02-28"))
	s.lifecycle(s.root, "close", mxAt("2025-02-10T18:00:00Z"), mxPtr("filled"))
	s.exec(`UPDATE vacancy_processes SET status='closed', closed_at=$2 WHERE id=$1`, s.root, mxAt("2025-02-10T18:00:00Z"))
	s.creditMario = s.credit(s.root, s.pMario, mxAt("2025-02-05T18:00:00Z"), "did_not_hold", mxRecipient{s.ana, a, "direct"})
	s.creditLucia = s.credit(s.root, s.pLucia, mxAt("2025-02-08T18:00:00Z"), "active", mxRecipient{s.ana, a, "direct"})

	// The replacement (a private process: no projection), worked by Beto: its own
	// delivery (overdue at «now»), a carried candidate that counts as delivered
	// and one organic application.
	s.repl = s.replacement("Reemplazo", s.root, s.root, 1, mxAt("2025-02-12T16:00:00Z"), "with_responsible")
	b := s.stay(s.repl, s.beto, "responsible", mxAt("2025-02-12T16:00:00Z"), nil)
	replStages := mxStages(pipelineconfig.Defaults(s.repl))
	s.replCutoff = replStages["screening"]
	s.delivery(s.repl, s.replCutoff, 2, "2025-03-05")
	s.management(s.repl, mxPtr(1), nil)
	s.carried = s.carry(s.repl, s.pLucia, s.replCutoff, mxAt("2025-02-12T17:00:00Z"))
	s.pNora = s.apply(s.repl, replStages["new"], "Nora", "portal", mxAt("2025-02-13T18:00:00Z"))
	s.credit(s.repl, s.pNora, mxAt("2025-03-01T18:00:00Z"), "active", mxRecipient{s.beto, b, "direct"})

	// An ordinary vacancy of the same company: nothing about it changes.
	s.plain = s.draft("Común", mxPtr(mxAt("2025-01-08T16:00:00Z")), nil, nil, "with_responsible")
	s.stay(s.plain, s.ana, "responsible", mxAt("2025-01-08T16:00:00Z"), nil)
	s.lifecycle(s.plain, "close", mxAt("2025-03-01T18:00:00Z"), mxPtr("cancelled"))
	return s
}

func mxObj(t *testing.T, v any, path ...string) map[string]any {
	t.Helper()
	cur := v
	for _, key := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			t.Fatalf("%s: not an object in %v", strings.Join(path, "."), cur)
		}
		cur = m[key]
	}
	m, ok := cur.(map[string]any)
	if !ok {
		t.Fatalf("%s: not an object: %v", strings.Join(path, "."), cur)
	}
	return m
}

func mxAtPath(t *testing.T, v any, path ...string) int {
	t.Helper()
	cur := v
	for _, key := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			t.Fatalf("%s: not an object in %v", strings.Join(path, "."), cur)
		}
		cur = m[key]
	}
	n, ok := cur.(float64)
	if !ok {
		t.Fatalf("%s: not a number: %v", strings.Join(path, "."), cur)
	}
	return int(n)
}

func mxItemTitles(t *testing.T, body map[string]any) []string {
	t.Helper()
	items, _ := body["items"].([]any)
	out := []string{}
	for _, it := range items {
		row := it.(map[string]any)
		if v, ok := row["vacancy"].(map[string]any); ok {
			out = append(out, v["title"].(string))
		} else if title, ok := row["title"].(string); ok {
			out = append(out, title)
		}
	}
	return out
}

// Vacancy-level figures ignore process_kind and count the logical vacancy once;
// process-level figures belong to each process and honor it.
func TestMetricsReplacement_SummarySplitsVacancyLevelFromProcessLevel(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXReplacement(t, h)
	for _, kind := range []string{"", "&process_kind=original", "&process_kind=replacement"} {
		got := s.get(s.owner, "summary?"+mxReplRange+kind)
		// Vacancy-level: the original and the plain vacancy, once each; the replacement is not a new vacancy.
		if n := mxAtPath(t, got, "vacancies", "assigned"); n != 2 {
			t.Errorf("%q: assigned %d, want 2", kind, n)
		}
		if mxAtPath(t, got, "vacancies", "closed", "filled") != 1 || mxAtPath(t, got, "vacancies", "closed", "cancelled") != 1 {
			t.Errorf("%q: closed %v", kind, got["vacancies"])
		}
		if mxAtPath(t, got, "placements", "positions_covered") != 1 || mxAtPath(t, got, "placements", "positions_required") != 2 {
			t.Errorf("%q: positions %v", kind, got["placements"])
		}
		d, pl := mxObj(t, got, "delivery"), mxObj(t, got, "placements")
		var onTime, overdue, notConfigured, credits, notHold, portal, manual int
		switch kind {
		case "":
			onTime, overdue, notConfigured, credits, notHold, portal, manual = 1, 1, 1, 3, 1, 3, 0
		case "&process_kind=original":
			onTime, overdue, notConfigured, credits, notHold, portal, manual = 1, 0, 1, 2, 1, 2, 0
		default:
			onTime, overdue, notConfigured, credits, notHold, portal, manual = 0, 1, 0, 1, 0, 1, 0
		}
		if int(d["on_time"].(float64)) != onTime || int(d["overdue"].(float64)) != overdue || int(d["not_configured"].(float64)) != notConfigured {
			t.Errorf("%q: delivery %v", kind, d)
		}
		if int(pl["credits"].(float64)) != credits || int(pl["did_not_hold"].(float64)) != notHold {
			t.Errorf("%q: placements %v", kind, pl)
		}
		// A carried participation is not an application: origin counts the organic one only.
		if mxAtPath(t, got, "origin", "portal") != portal || mxAtPath(t, got, "origin", "manual") != manual {
			t.Errorf("%q: origin %v", kind, got["origin"])
		}
	}
}

func TestMetricsReplacement_ListsHonorTheFilterAndTotalsEqualFigures(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXReplacement(t, h)
	for _, kind := range []string{"", "&process_kind=original", "&process_kind=replacement"} {
		sum := s.get(s.owner, "summary?"+mxReplRange+kind)
		deliveries := s.get(s.owner, "deliveries?"+mxReplRange+kind)
		if mxAtPath(t, deliveries, "total") != mxAtPath(t, sum, "delivery", "total") {
			t.Errorf("%q: deliveries total %v, figure %v", kind, deliveries["total"], sum["delivery"])
		}
		placements := s.get(s.owner, "placements?"+mxReplRange+kind)
		if mxAtPath(t, placements, "total") != mxAtPath(t, sum, "placements", "credits") {
			t.Errorf("%q: placements total %v, figure %v", kind, placements["total"], sum["placements"])
		}
		applications := s.get(s.owner, "applications?"+mxReplRange+kind)
		origin := mxObj(t, sum, "origin")
		if mxAtPath(t, applications, "total") != int(origin["portal"].(float64))+int(origin["manual"].(float64))+int(origin["careers_site"].(float64))+int(origin["unknown"].(float64)) {
			t.Errorf("%q: applications total %v, origin %v", kind, applications["total"], origin)
		}
		// Facets: every kind counted with every filter but process_kind.
		if kind != "" {
			if mxAtPath(t, deliveries, "facets", "process_kind", "original") != 2 || mxAtPath(t, deliveries, "facets", "process_kind", "replacement") != 1 {
				t.Errorf("%q: deliveries facets %v", kind, deliveries["facets"])
			}
			if mxAtPath(t, placements, "facets", "process_kind", "original") != 2 || mxAtPath(t, placements, "facets", "process_kind", "replacement") != 1 {
				t.Errorf("%q: placements facets %v", kind, placements["facets"])
			}
			if mxAtPath(t, applications, "facets", "process_kind", "original") != 2 || mxAtPath(t, applications, "facets", "process_kind", "replacement") != 1 {
				t.Errorf("%q: applications facets %v", kind, applications["facets"])
			}
			if mxObj(t, deliveries, "applied_filters")["process_kind"] != strings.TrimPrefix(kind, "&process_kind=") {
				t.Errorf("%q: applied_filters %v", kind, deliveries["applied_filters"])
			}
		}
		// The vacancies list is vacancy-level: the logical vacancies, never the replacement.
		vacancies := s.get(s.owner, "vacancies?"+mxReplRange+kind)
		if got := mxItemTitles(t, vacancies); mxAtPath(t, vacancies, "total") != 2 || len(got) != 2 {
			t.Errorf("%q: vacancies %v", kind, got)
		}
		for _, title := range mxItemTitles(t, vacancies) {
			if title == "Reemplazo" {
				t.Errorf("%q: the replacement is listed as a vacancy", kind)
			}
		}
	}
	rows := s.get(s.owner, "deliveries?"+mxReplRange+"&process_kind=replacement")
	items := rows["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("replacement deliveries %v", items)
	}
	row := items[0].(map[string]any)
	// The carried candidate counts as delivered like a manual intake (A3); the target is the replacement's own.
	if row["vacancy"].(map[string]any)["title"] != "Reemplazo" || row["result"] != "overdue" || row["delivered"].(float64) != 1 || row["target"].(float64) != 2 {
		t.Errorf("replacement delivery row %v", row)
	}
	// Original unchanged: its did_not_hold credit stays in the original's figures.
	placements := s.get(s.owner, "placements?"+mxReplRange+"&process_kind=original&held=false")
	if mxAtPath(t, placements, "total") != 1 || mxItemTitles(t, placements)[0] != "Original" {
		t.Errorf("original did_not_hold %v", placements)
	}
}

// A recruiter who only worked the replacement has the logical vacancy assigned
// once (A5); the process-level figures stay with the process.
func TestMetricsReplacement_RecruiterAssignedThroughTheChain(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXReplacement(t, h)
	got := s.get(s.owner, "summary?"+mxReplRange+"&recruiter_id="+s.beto.String())
	if mxAtPath(t, got, "vacancies", "assigned") != 1 || mxAtPath(t, got, "delivery", "total") != 1 || mxAtPath(t, got, "delivery", "overdue") != 1 {
		t.Errorf("beto summary: %v %v", got["vacancies"], got["delivery"])
	}
	cards := s.get(s.owner, "recruiters?"+mxReplRange)
	byName := map[string]map[string]any{}
	for _, it := range cards["items"].([]any) {
		c := it.(map[string]any)
		byName[c["name"].(string)] = c
	}
	for _, name := range []string{"Ana", "Beto"} {
		if mxAtPath(t, byName[name], "vacancies", "assigned") < 1 {
			t.Errorf("%s: %v", name, byName[name]["vacancies"])
		}
	}
	// Ana: the plain vacancy and the original; Beto: the original through his replacement tramo.
	if mxAtPath(t, byName["Ana"], "vacancies", "assigned") != 2 || mxAtPath(t, byName["Beto"], "vacancies", "assigned") != 1 {
		t.Errorf("assigned: ana %v beto %v", byName["Ana"]["vacancies"], byName["Beto"]["vacancies"])
	}
	if mxAtPath(t, byName["Beto"], "placements", "direct") != 1 || mxAtPath(t, byName["Ana"], "placements", "direct") != 2 {
		t.Errorf("direct: ana %v beto %v", byName["Ana"]["placements"], byName["Beto"]["placements"])
	}
	filtered := s.get(s.owner, "recruiters?"+mxReplRange+"&process_kind=original")
	for _, it := range filtered["items"].([]any) {
		c := it.(map[string]any)
		if c["name"] == "Beto" {
			t.Errorf("Beto has no original process: %v", c)
		}
	}
}

func TestMetricsReplacement_SectionsAndDetails(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXReplacement(t, h)
	for _, kind := range []string{"", "&process_kind=original", "&process_kind=replacement"} {
		closures := s.get(s.owner, "closures?"+mxReplRange+kind)
		feb := closures["closed_by_month"].([]any)[1].(map[string]any)
		if feb["closed"].(float64) != 1 || feb["filled"].(float64) != 1 {
			t.Errorf("%q: closed_by_month Feb %v", kind, feb)
		}
		delays := s.get(s.owner, "delays?"+mxReplRange+kind)
		if mxAtPath(t, delays, "closing_target", "no_target")+mxAtPath(t, delays, "closing_target", "on_time")+mxAtPath(t, delays, "closing_target", "late") != 1 {
			t.Errorf("%q: closing_target %v", kind, delays["closing_target"])
		}
		wantOverdue := map[string]int{"": 1, "&process_kind=original": 0, "&process_kind=replacement": 1}[kind]
		if mxAtPath(t, delays, "overdue", "total") != wantOverdue {
			t.Errorf("%q: overdue %v", kind, delays["overdue"])
		}
	}
	// Details are per process: the replacement's rows, nothing of the original's.
	got := s.get(s.owner, fmt.Sprintf("vacancies/%s/deliveries?%s", s.repl, mxReplRange))
	if items := got["items"].([]any); len(items) != 1 {
		t.Errorf("replacement deliveries %v", items)
	}
	got = s.get(s.owner, fmt.Sprintf("vacancies/%s/placements?%s&process_kind=replacement", s.repl, mxReplRange))
	if items := got["items"].([]any); len(items) != 1 || items[0].(map[string]any)["candidate"].(map[string]any)["full_name"] != "Nora" {
		t.Errorf("replacement placements %v", got)
	}
	// A process of the other kind answers an empty read, still a 200 of that process.
	got = s.get(s.owner, fmt.Sprintf("vacancies/%s/placements?%s&process_kind=replacement", s.root, mxReplRange))
	if items := got["items"].([]any); len(items) != 0 {
		t.Errorf("original under process_kind=replacement: %v", items)
	}
	got = s.get(s.owner, fmt.Sprintf("vacancies/%s/placements?%s&process_kind=original", s.root, mxReplRange))
	if items := got["items"].([]any); len(items) != 2 {
		t.Errorf("original placements %v", items)
	}
}

func TestMetricsReplacement_InvalidFilterOnEveryRoute(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXReplacement(t, h)
	paths := []string{"summary", "recruiters", "closures", "compliance", "delays", "origin", "pipeline", "vacancies", "deliveries", "placements", "reassignments",
		"candidates", "applications", "deliveries/export", "vacancies/" + s.repl.String() + "/deliveries"}
	for _, path := range paths {
		for _, q := range []string{"&process_kind=nope", "&process_kind=original&process_kind=replacement"} {
			r := h.do(t, "GET", "/v2/me/company/metrics/"+path+"?"+mxReplRange+q, "", s.owner.token, nil)
			if r.status != 422 || !strings.Contains(string(r.body), `"invalid_filter"`) || !strings.Contains(string(r.body), "process_kind") {
				t.Errorf("%s%s: %d %s", path, q, r.status, r.body)
			}
		}
		if r := h.do(t, "GET", "/v2/me/company/metrics/"+path+"?"+mxReplRange+"&process_kind=replacement", "", s.owner.token, nil); r.status != 200 {
			t.Errorf("%s: %d %s", path, r.status, r.body)
		}
	}
}

// The pipeline is process-level: the open replacement is its own row set.
func TestMetricsReplacement_PipelineIsProcessLevel(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXReplacement(t, h)
	stages := mxStages(pipelineconfig.Defaults(s.repl))
	s.exec(`UPDATE process_participations SET stage_id=$2 WHERE id=$1`, s.pNora, stages["screening"])
	count := func(body map[string]any) int {
		n := 0
		for _, st := range body["stages"].([]any) {
			n += int(st.(map[string]any)["candidates"].(float64))
		}
		return n
	}
	// The original is closed: not in the pipeline; the replacement is open with two candidates.
	all := s.get(s.owner, "pipeline?"+mxReplRange)
	rep := s.get(s.owner, "pipeline?"+mxReplRange+"&process_kind=replacement")
	orig := s.get(s.owner, "pipeline?"+mxReplRange+"&process_kind=original")
	if count(all) != 2 || count(rep) != 2 || count(orig) != 0 {
		t.Errorf("pipeline candidates all %d replacement %d original %d", count(all), count(rep), count(orig))
	}
	list := s.get(s.owner, "candidates?"+mxReplRange+"&process_kind=replacement")
	if mxAtPath(t, list, "total") != 2 || mxAtPath(t, list, "facets", "process_kind", "replacement") != 2 || mxAtPath(t, list, "facets", "process_kind", "original") != 0 {
		t.Errorf("candidates %v", list)
	}
}
