//go:build integration

package main

import (
	"reflect"
	"testing"
)

// S1 of odd/tasks/list-row-coverage-backend.md: every row of the employer list
// carries `coverage {covered, required}` with the board's live semantics (the
// Placement-stage occupants against the process' headcount), `null` for a draft
// without a process. Observed through the production router.

func draftListCoverageOf(t *testing.T, item map[string]any) any {
	t.Helper()
	value, present := item["coverage"]
	if !present {
		t.Fatalf("coverage key missing: %v", item)
	}
	return value
}

// boardCoverageOf is the board's coverage reduced to the two list keys.
func boardCoverageOf(t *testing.T, d *departureFlow) map[string]any {
	t.Helper()
	c := d.board()["coverage"].(map[string]any)
	return map[string]any{"covered": c["covered"], "required": c["required"]}
}

func TestDraftListCoverageFlow_RowsFollowTheBoardLive(t *testing.T) {
	d := newDepartureFlow(t)
	vacancy := d.base[len(draftFlowV2Path)+1:]

	// A draft that never published has no process, so no coverage.
	draft := publicationFlowReady(t, d.h, d.owner)
	if got := draftListCoverageOf(t, draftListCandidateItem(t, d.h, d.owner, draft)); got != nil {
		t.Fatalf("draft without a process: coverage = %v, want null", got)
	}

	// A published process with nobody placed yet: covered 0 of its headcount.
	published := publicationFlowReady(t, d.h, d.owner)
	publicFlowPublish(t, d.h, published, d.owner)
	var headcount int64
	if err := d.h.pool.QueryRow(t.Context(), `SELECT hiring_headcount FROM job_draft_management_configs WHERE draft_id=$1`, published).Scan(&headcount); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"covered": float64(0), "required": float64(headcount)}
	if got := draftListCoverageOf(t, draftListCandidateItem(t, d.h, d.owner, published)); !reflect.DeepEqual(got, want) {
		t.Fatalf("published without hires: coverage = %v, want %v", got, want)
	}

	// Intake only: the participation is not in Placement yet.
	row := func() any { return draftListCoverageOf(t, draftListCandidateItem(t, d.h, d.owner, vacancy)) }
	if got, board := row(), boardCoverageOf(t, d); !reflect.DeepEqual(got, board) || board["covered"] != float64(0) {
		t.Fatalf("before placement: list %v board %v", got, board)
	}

	// A hire reaches Placement, then the process closes: covered and required are the board's.
	d.advance("placement")
	d.closeProcess("continue")
	got, board := row(), boardCoverageOf(t, d)
	if !reflect.DeepEqual(got, board) || board["covered"] != float64(1) || board["required"] == nil {
		t.Fatalf("closed covered: list %v board %v", got, board)
	}
	required := board["required"]

	// The placement departs after the close (S7): live coverage drops below required, like the board.
	if r := d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`,"placement_exit_reason":"candidate_left"}`); r.status != 200 {
		t.Fatalf("departure: %d %s", r.status, r.body)
	}
	got, board = row(), boardCoverageOf(t, d)
	if !reflect.DeepEqual(got, board) || board["covered"] != float64(0) || !reflect.DeepEqual(got, map[string]any{"covered": float64(0), "required": required}) {
		t.Fatalf("after departure: list %v board %v", got, board)
	}

	// The other rows are unaffected by that change.
	if got := draftListCoverageOf(t, draftListCandidateItem(t, d.h, d.owner, draft)); got != nil {
		t.Fatalf("draft row changed: %v", got)
	}
	if got := draftListCoverageOf(t, draftListCandidateItem(t, d.h, d.owner, published)); !reflect.DeepEqual(got, want) {
		t.Fatalf("published row changed: %v", got)
	}
}
