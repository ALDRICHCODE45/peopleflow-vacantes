//go:build integration

package main

import (
	"testing"
)

// Feature doc L11 (3): GET V/pipeline/delivery has no lifecycle guard, so the
// frontend can read the delivery of a closed or finished source (for example
// to prefill a replacement's commitment date). Pinned here so a lifecycle
// guard added to the read would fail loudly.
func TestReplacementDeliveryReadWorksOnClosedAndFinishedSources(t *testing.T) {
	f := newReplFlow(t)
	read := func(id string) draftFlowResponse {
		t.Helper()
		got := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/pipeline/delivery", "", f.owner.token, nil)
		if got.status != 200 {
			t.Fatalf("delivery of %s: %d %s", id, got.status, got.body)
		}
		draftFlowAssertNoStore(t, got)
		return got
	}
	same := func(label string, got, want draftFlowResponse) {
		t.Helper()
		if string(got.body) != string(want.body) || got.header.Get("ETag") != want.header.Get("ETag") {
			t.Fatalf("%s changed the delivery read:\n got %s %v\nwant %s %v", label, got.body, got.header.Get("ETag"), want.body, want.header.Get("ETag"))
		}
	}

	open := f.published()
	before := read(open)

	// Closed, and the process continues.
	f.closeIt(open, "continue")
	if _, view := f.view(open); view["publication"] != "closed" || view["process"] != "active" {
		t.Fatalf("closed source: %v", view)
	}
	same("closing", read(open), before)

	// Closed and finished.
	if got := f.transition(open, "finish-process", `{}`); got.status != 200 {
		t.Fatalf("finish: %d %s", got.status, got.body)
	}
	if _, view := f.view(open); view["publication"] != "closed" || view["process"] != "finished" {
		t.Fatalf("finished source: %v", view)
	}
	same("finishing", read(open), before)

	// A source a start finished (closed covered, closed-active): the start itself finishes it.
	root := f.published()
	f.closeIt(root, "continue")
	f.cover(root)
	credit := f.credit(root, "did_not_hold")
	beforeStart := read(root)
	started := f.startOK(root, replBody(t, "", credit))
	if _, view := f.view(root); view["process"] != "finished" {
		t.Fatalf("the start must finish its source: %v", view)
	}
	same("starting a replacement", read(root), beforeStart)

	// The replacement's own delivery is readable too, while it runs and once it is closed.
	id := started["id"].(string)
	read(id)
	f.closeIt(id, "continue")
	read(id)
}
