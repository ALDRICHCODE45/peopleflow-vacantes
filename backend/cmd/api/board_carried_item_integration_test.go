//go:build integration

package main

import (
	"testing"
	"time"
)

// Replacement follow-ups S1: every pipeline board item carries
// carried_from_participation_id: the source participation of a row carried into
// a replacement, null for any other row (always present, never omitted).
func TestBoardItemCarriesTheSourceParticipation(t *testing.T) {
	f := newCarryFlow(t)
	src, _ := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	c1, c2 := f.credit(src, "did_not_hold"), f.credit(src, "did_not_hold")
	s := replStages(src)
	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Microsecond)
	marta, ana := f.manual("Marta Carried"), f.organic("Ana Carried")
	pMarta := f.participate(src, marta, s["in_process"], at)
	pAna := f.participate(src, ana, s["screening"], at)

	resp := f.start(src, replBody(t, carriedJSON(carriedItem(marta, s["in_process"]), carriedItem(ana, s["screening"])), c1, c2))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	out := draftFlowObject(t, resp.body)
	id := out["id"].(string)
	n := replStages(id)
	carried := out["carried"].([]any)
	newMarta, newAna := carried[0].(map[string]any)["participation_id"].(string), carried[1].(map[string]any)["participation_id"].(string)
	// An ordinary row of the replacement: an organic application, never carried.
	fresh := f.organic("Beto Ordinary")
	newFresh := f.participate(id, fresh, n["new"], time.Now().UTC().Truncate(time.Microsecond))

	want := map[string]any{newMarta: pMarta, newAna: pAna, newFresh: nil}
	base := draftFlowV2Path + "/" + id
	items := map[string]map[string]any{}
	for _, raw := range f.board(id)["participations"].([]any) {
		item := raw.(map[string]any)
		items[item["id"].(string)] = item
	}
	if len(items) != len(want) {
		t.Fatalf("board items = %d, want %d", len(items), len(want))
	}
	for pid, source := range want {
		item := items[pid]
		got, present := item["carried_from_participation_id"]
		if item == nil || !present || got != source {
			t.Fatalf("board item %s: carried_from_participation_id = %v (present %v), want %v", pid, got, present, source)
		}
		detail := f.h.do(t, "GET", base+"/participations/"+pid, "", f.owner.token, nil)
		if detail.status != 200 {
			t.Fatalf("detail %s: %d %s", pid, detail.status, detail.body)
		}
		got, present = draftFlowObject(t, detail.body)["carried_from_participation_id"]
		if !present || got != source {
			t.Fatalf("detail %s: carried_from_participation_id = %v (present %v), want %v", pid, got, present, source)
		}
	}

	// The mutation responses carry it too (move and discard of a carried row, move of an ordinary one).
	for _, c := range []struct {
		pid, path, body string
		source          any
	}{
		{newMarta, "/moves", `{"to_stage_id":"` + n["screening"] + `"}`, pMarta},
		{newMarta, "/discard", `{"reason":{"group":"recruiter","key":"profile_mismatch"},"comment":"Private note"}`, pMarta},
		{newFresh, "/moves", `{"to_stage_id":"` + n["screening"] + `"}`, nil},
	} {
		current := f.h.do(t, "GET", base+"/participations/"+c.pid, "", f.owner.token, nil)
		r := f.h.do(t, "POST", base+"/participations/"+c.pid+c.path, c.body, f.owner.token, map[string]string{"If-Match": draftFlowObject(t, current.body)["etag"].(string)})
		if r.status != 200 {
			t.Fatalf("%s %s: %d %s", c.path, c.pid, r.status, r.body)
		}
		got, present := draftFlowObject(t, r.body)["carried_from_participation_id"]
		if !present || got != c.source {
			t.Fatalf("%s %s: carried_from_participation_id = %v (present %v), want %v", c.path, c.pid, got, present, c.source)
		}
	}
}
