//go:build integration

package main

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDraftListDatesFlow_MatchesLifecycleAcrossTransitions(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	principalID, principalSub := company.addUser(t, "recruiter")
	principal := h.actor(t, principalID, principalSub)
	id := publicationFlowReady(t, h, principal)
	path := draftFlowV2Path + "/" + id + "/lifecycle"
	keys := []string{"published_at", "paused_at", "closed_at", "process_finished_at"}
	const layout = "2006-01-02T15:04:05.000000Z"
	// Both session scopes must see exactly the same values as lifecycle GET;
	// the timestamps are always present, including nulls before publication.
	parity := func(t *testing.T) draftFlowResponse {
		t.Helper()
		view := h.do(t, "GET", path, "", principal.token, nil)
		draftFlowAssertNoStore(t, view)
		if view.status != 200 {
			t.Fatalf("lifecycle GET: %d %s", view.status, view.body)
		}
		lifecycle := draftFlowObject(t, view.body)
		for _, actor := range []draftFlowActor{owner, principal} {
			item := draftListCandidateItem(t, h, actor, id)
			for _, key := range keys {
				value, present := item[key]
				if !present || value != lifecycle[key] {
					t.Fatalf("%s list=%v present=%v lifecycle=%v", key, value, present, lifecycle[key])
				}
				if value != nil {
					raw, ok := value.(string)
					at, err := time.Parse(layout, raw)
					if !ok || err != nil || at.UTC().Format(layout) != raw {
						t.Fatalf("%s not UTC microseconds: %v", key, value)
					}
				}
			}
			wantStatus := lifecycle["publication"]
			if wantStatus == nil {
				wantStatus = "draft"
			}
			if item["status"] != wantStatus || item["process"] != lifecycle["process"] {
				t.Fatalf("state mismatch list=%v lifecycle=%v", item, lifecycle)
			}
		}
		return view
	}
	initial := draftFlowObject(t, parity(t).body)
	for _, key := range keys {
		if initial[key] != nil {
			t.Fatalf("never-published %s=%v", key, initial[key])
		}
	}
	publicFlowPublish(t, h, id, principal)
	current := parity(t)
	published := draftFlowObject(t, current.body)
	if published["published_at"] == nil {
		t.Fatal("published_at must be populated")
	}
	for _, key := range keys[1:] {
		if published[key] != nil {
			t.Fatalf("before transition %s=%v", key, published[key])
		}
	}
	// Publication retains the first event; all other dates retain the latest
	// occurrence. Resume/reopen must not change any historical date.
	for _, cycle := range []string{"first", "latest"} {
		for _, step := range []struct{ name, body, changed, status, process string }{
			{"pause", `{}`, "paused_at", "paused", "active"},
			{"resume", `{}`, "", "published", "active"},
			{"close", `{"process":"continue","reason":"cancelled","reason_note":null}`, "closed_at", "closed", "active"},
			{"finish-process", `{}`, "process_finished_at", "closed", "finished"},
			{"reopen", `{}`, "", "published", "active"},
		} {
			t.Run(cycle+"/"+step.name, func(t *testing.T) {
				before := draftFlowObject(t, current.body)
				changed := h.do(t, "POST", path+"/"+step.name, step.body, principal.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
				if changed.status != 200 {
					t.Fatalf("%s: %d %s", step.name, changed.status, changed.body)
				}
				current = parity(t)
				after := draftFlowObject(t, current.body)
				response := draftFlowObject(t, changed.body)
				if after["publication"] != step.status || after["process"] != step.process {
					t.Fatal("unexpected state", after)
				}
				for _, key := range keys {
					if after[key] != response[key] {
						t.Fatalf("%s mutation/GET mismatch", key)
					}
					if key == step.changed {
						if after[key] == nil || after[key] == before[key] {
							t.Fatalf("%s must record latest %s", step.name, key)
						}
					} else if after[key] != before[key] {
						t.Fatalf("%s cleared/changed retained %s: before=%v after=%v", step.name, key, before[key], after[key])
					}
				}
			})
			if t.Failed() {
				return
			}
		}
	}
}
