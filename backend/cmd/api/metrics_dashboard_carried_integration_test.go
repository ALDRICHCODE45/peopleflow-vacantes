//go:build integration

package main

import (
	"fmt"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

// A participation carried into a replacement process is not a new application
// (replacement-processes-v1, R3b): the company dashboard's origin chart,
// applications list and recent applications skip it, while the operational
// figures (in-process series and counts, candidates list, pipeline) keep
// counting it. Through the production router, on the d2a scenario.
func TestDashboardV2_CarriedParticipationsAreNotApplications(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	actors := map[string]draftFlowActor{"owner": s.owner, "ana": s.anaActor}
	// as_of moves with the clock the test advances past the snapshot TTL.
	body := func(m map[string]any) string {
		delete(m, "as_of")
		return fmt.Sprint(m)
	}
	figures := func(actor draftFlowActor) map[string]string {
		return map[string]string{
			"origin":       body(s.dash(actor, "origin?window=7")),
			"recent":       body(s.dash(actor, "recent")),
			"applications": body(s.list(actor, "applications", "window=7")),
			"series":       mxSeries(s.dash(actor, "summary?window=7")),
		}
	}
	before := map[string]map[string]string{}
	for name, actor := range actors {
		before[name] = figures(actor)
	}
	candidatesBefore := s.listTotal(s.owner, "candidates", "window=7&in_process=true")
	pipelineBefore := fmt.Sprint(s.dash(s.owner, "pipeline")["stages"])

	// Pablo Dos, in process on the original (Analista), carried into its
	// replacement at the newest instant of the window, in screening.
	started := mxAt("2026-03-23T16:00:00Z")
	repl := s.replacement("Reemplazo Analista", s.a, s.a, 1, started, "with_responsible")
	s.stay(repl, s.ana, "responsible", started, nil)
	carried := s.carry(repl, s.pa2, mxStages(pipelineconfig.Defaults(repl))["screening"], mxAt("2026-03-24T09:00:00Z"))

	// Past the history snapshot's TTL, still on the same local day.
	h.metrics.WithClock(func() time.Time { return mxAt("2026-03-24T18:05:00Z") })
	for name, actor := range actors {
		after := figures(actor)
		for _, figure := range []string{"origin", "recent", "applications"} {
			if after[figure] != before[name][figure] {
				t.Errorf("%s %s counts the carried participation:\n got %s\nwant %s", name, figure, after[figure], before[name][figure])
			}
		}
		// The operational series keeps counting it: one more in process on 03-24.
		if after["series"] == before[name]["series"] {
			t.Errorf("%s in-process series ignores the carried participation: %s", name, after["series"])
		}
	}
	if got, want := mxSeries(s.dash(s.owner, "summary?window=7")), "03-17=2 03-18=2 03-19=4 03-20=2 03-21=2 03-22=0 03-23=2 03-24=3"; got != want {
		t.Errorf("owner series = %s, want %s", got, want)
	}
	if got, want := s.listTotal(s.owner, "candidates", "window=7&in_process=true"), candidatesBefore+1; got != want {
		t.Errorf("in-process candidates = %d, want %d", got, want)
	}
	found := false
	for _, raw := range s.list(s.owner, "candidates", "window=7&in_process=true&limit=100")["items"].([]any) {
		found = found || raw.(map[string]any)["participation_id"] == carried.String()
	}
	if !found {
		t.Error("the carried participation is missing from the dashboard candidates list")
	}
	if fmt.Sprint(s.dash(s.owner, "pipeline")["stages"]) == pipelineBefore {
		t.Error("pipeline stage counts ignore the carried participation")
	}
}
