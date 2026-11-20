//go:build integration

package main

import (
	"context"
	"reflect"
	"sort"
	"testing"

	"github.com/google/uuid"
)

// Replacement processes R2 (docs/contracts/replacement-processes-v1.md): the
// lifecycle read side and the reopen guards, observed through the production
// router with seeded chains (Start does not exist yet).

// replFlow seeds logical vacancies: every process is a real published draft
// (so lifecycle, board and list are the production ones) and the chain links
// and fallen credits are inserted directly.
type replFlow struct {
	t       *testing.T
	h       *draftFlowHarness
	company *draftFlowCompany
	owner   draftFlowActor
}

func newReplFlow(t *testing.T) *replFlow {
	t.Helper()
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	f := &replFlow{t: t, h: h, company: company, owner: h.actor(t, ownerID, sub)}
	t.Cleanup(func() { // runs before the company cleanup (LIFO): the chain FKs have no cascade
		for _, q := range []string{
			`DELETE FROM vacancy_replacement_credits WHERE replacement_process_id IN (SELECT process_id FROM vacancy_replacements WHERE company_id=$1)`,
			`DELETE FROM vacancy_replacements WHERE company_id=$1`,
		} {
			if _, err := h.pool.Exec(context.Background(), q, company.companyID); err != nil {
				t.Errorf("replacement fixture cleanup: %v", err)
			}
		}
	})
	return f
}

func (f *replFlow) exec(q string, args ...any) {
	f.t.Helper()
	if _, err := f.h.pool.Exec(context.Background(), q, args...); err != nil {
		f.t.Fatal(err)
	}
}

// draft is a ready, unpublished draft.
func (f *replFlow) draft() string { return publicationFlowReady(f.t, f.h, f.owner) }

// published is a ready draft, published (public projection included).
func (f *replFlow) published() string {
	id := f.draft()
	publicFlowPublish(f.t, f.h, id, f.owner)
	return id
}

// link makes `id` the replacement `sequence` of `root`, started from `source`.
func (f *replFlow) link(id, source, root string, sequence int) {
	f.exec(`INSERT INTO vacancy_replacements(process_id,company_id,source_process_id,root_process_id,sequence,started_at,started_by,target_quantity) VALUES($1,$2,$3,$4,$5,now(),$6,1)`,
		id, f.company.companyID, source, root, sequence, f.owner.userID)
}

func (f *replFlow) credit(process, status string) string {
	id := uuid.NewString()
	f.exec(`INSERT INTO placement_credits(id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode,status) VALUES($1,$2,$3,$1,$1,now(),$4,'with_responsible',$5)`,
		id, f.company.companyID, process, f.owner.userID, status)
	return id
}

func (f *replFlow) view(id string) (draftFlowResponse, map[string]any) {
	f.t.Helper()
	got := f.h.do(f.t, "GET", draftFlowV2Path+"/"+id+"/lifecycle", "", f.owner.token, nil)
	if got.status != 200 {
		f.t.Fatalf("lifecycle %s: %d %s", id, got.status, got.body)
	}
	return got, draftFlowObject(f.t, got.body)
}

func (f *replFlow) transition(id, action, body string) draftFlowResponse {
	f.t.Helper()
	current, _ := f.view(id)
	return f.h.do(f.t, "POST", draftFlowV2Path+"/"+id+"/lifecycle/"+action, body, f.owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
}

// closeIt closes without covering; process is "continue" or "finish".
func (f *replFlow) closeIt(id, process string) {
	f.t.Helper()
	if got := f.transition(id, "close", `{"process":"`+process+`","reason":"cancelled","reason_note":null}`); got.status != 200 {
		f.t.Fatalf("close %s: %d %s", id, got.status, got.body)
	}
}

// cover turns the stored close reason into the one a covered close records;
// a `filled` close needs live coverage that this fixture does not build.
func (f *replFlow) cover(id string) {
	f.exec(`UPDATE vacancy_lifecycle_events SET reason='filled' WHERE process_id=$1 AND action='close'`, id)
}

func (f *replFlow) reopen(id string) draftFlowResponse { return f.transition(id, "reopen", `{}`) }

var replViewKeys = []string{
	"publication", "process", "version", "published_at", "paused_at", "closed_at", "process_finished_at", "allowed_actions", "close_reason", "close_reason_note",
	"visibility", "kind", "sequence", "replacement_of", "root_process_id", "closed_covered", "can_start_replacement", "start_replacement_blocker", "startable_credits_count", "active_replacement_id",
}

func replAssertKeys(t *testing.T, view map[string]any) {
	t.Helper()
	got := make([]string, 0, len(view))
	for k := range view {
		got = append(got, k)
	}
	want := append([]string(nil), replViewKeys...)
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("lifecycle keys = %v, want %v", got, want)
	}
}

// replAssertView checks the replacement keys; nil means JSON null.
func replAssertView(t *testing.T, view map[string]any, want map[string]any) {
	t.Helper()
	replAssertKeys(t, view)
	for k, v := range want {
		if !reflect.DeepEqual(view[k], v) {
			t.Fatalf("%s = %#v, want %#v (view %v)", k, view[k], v, view)
		}
	}
}

func replActions(view map[string]any) []string {
	out := []string{}
	for _, a := range view["allowed_actions"].([]any) {
		out = append(out, a.(string))
	}
	return out
}

func TestReplacementLifecycleViewKeysOfAnOriginal(t *testing.T) {
	f := newReplFlow(t)
	id := f.draft()

	_, view := f.view(id)
	replAssertView(t, view, map[string]any{
		"publication": nil, "visibility": nil, "kind": "original", "sequence": nil, "replacement_of": nil, "root_process_id": id,
		"closed_covered": false, "can_start_replacement": false, "start_replacement_blocker": "source_not_closed",
		"startable_credits_count": float64(0), "active_replacement_id": nil, "allowed_actions": []any{"publish"},
	})

	publicFlowPublish(t, f.h, id, f.owner)
	_, view = f.view(id)
	replAssertView(t, view, map[string]any{"visibility": "public", "kind": "original", "root_process_id": id, "start_replacement_blocker": "source_not_closed", "allowed_actions": []any{"pause", "close"}})

	f.closeIt(id, "continue")
	_, view = f.view(id)
	replAssertView(t, view, map[string]any{
		"publication": "closed", "closed_covered": false, "can_start_replacement": false, "start_replacement_blocker": "no_startable_credits",
		"startable_credits_count": float64(0), "allowed_actions": []any{"finish_process", "reopen"},
	})

	// A fallen hire makes Start possible; a voided or still-active credit does not count.
	f.credit(id, "voided")
	f.credit(id, "active")
	_, view = f.view(id)
	replAssertView(t, view, map[string]any{"can_start_replacement": false, "startable_credits_count": float64(0)})
	f.credit(id, "did_not_hold")
	_, view = f.view(id)
	replAssertView(t, view, map[string]any{"can_start_replacement": true, "start_replacement_blocker": nil, "startable_credits_count": float64(1), "active_replacement_id": nil, "allowed_actions": []any{"finish_process", "reopen"}})

	// Closed covered: Reopen is gone, Start is offered, and the view does not follow coverage.
	f.cover(id)
	_, view = f.view(id)
	replAssertView(t, view, map[string]any{"closed_covered": true, "close_reason": "filled", "can_start_replacement": true, "allowed_actions": []any{"finish_process"}})
	if got := f.transition(id, "finish-process", `{}`); got.status != 200 {
		t.Fatalf("finish: %d %s", got.status, got.body)
	}
	_, view = f.view(id)
	replAssertView(t, view, map[string]any{"process": "finished", "closed_covered": true, "can_start_replacement": true, "allowed_actions": []any{}})
}

func TestReplacementLifecycleViewKeysOfAChain(t *testing.T) {
	f := newReplFlow(t)
	root := f.published()
	f.closeIt(root, "finish")
	f.cover(root)
	fallen := f.credit(root, "did_not_hold")
	first := f.published()
	f.link(first, root, root, 1)

	// The original now has a successor: it is no longer the one that starts or reopens.
	_, view := f.view(root)
	replAssertView(t, view, map[string]any{
		"kind": "original", "sequence": nil, "root_process_id": root, "closed_covered": true, "can_start_replacement": false,
		"start_replacement_blocker": "replacement_active", "startable_credits_count": float64(1), "active_replacement_id": first, "allowed_actions": []any{},
	})
	_, view = f.view(first)
	replAssertView(t, view, map[string]any{
		"publication": "published", "process": "active", "visibility": "public", "kind": "replacement", "sequence": float64(1), "replacement_of": root,
		"root_process_id": root, "closed_covered": false, "can_start_replacement": false, "start_replacement_blocker": "source_not_closed",
		"startable_credits_count": float64(1), "active_replacement_id": first, "allowed_actions": []any{"pause", "close"},
	})

	// A closed-active replacement is the latest, may start again, and is its own active replacement.
	f.closeIt(first, "continue")
	_, view = f.view(first)
	replAssertView(t, view, map[string]any{"can_start_replacement": true, "start_replacement_blocker": nil, "active_replacement_id": first, "allowed_actions": []any{"finish_process", "reopen"}})

	// Finished: nobody is active, the latest process starts, the older one is "not_latest".
	if got := f.transition(first, "finish-process", `{}`); got.status != 200 {
		t.Fatalf("finish: %d %s", got.status, got.body)
	}
	_, view = f.view(first)
	replAssertView(t, view, map[string]any{"can_start_replacement": true, "start_replacement_blocker": nil, "active_replacement_id": nil, "allowed_actions": []any{"reopen"}})
	_, view = f.view(root)
	replAssertView(t, view, map[string]any{"can_start_replacement": false, "start_replacement_blocker": "not_latest", "active_replacement_id": nil, "allowed_actions": []any{}})

	// A credit that a replacement already took is not startable any more.
	f.exec(`INSERT INTO vacancy_replacement_credits(replacement_process_id,placement_credit_id) VALUES($1,$2)`, first, fallen)
	_, view = f.view(first)
	replAssertView(t, view, map[string]any{"can_start_replacement": false, "start_replacement_blocker": "no_startable_credits", "startable_credits_count": float64(0)})

	// A replacement without projection is private (and still `published` on the process axis).
	private := f.published()
	f.link(private, first, root, 2)
	f.exec(`DELETE FROM vacancy_public_projections WHERE id=$1`, private)
	_, view = f.view(private)
	replAssertView(t, view, map[string]any{"publication": "published", "visibility": "private", "kind": "replacement", "sequence": float64(2), "replacement_of": first, "root_process_id": root, "active_replacement_id": private})
}

func TestReplacementLifecycleKeysEverywhereTheViewIsRendered(t *testing.T) {
	f := newReplFlow(t)
	id := f.published()
	base := draftFlowV2Path + "/" + id

	paused := f.transition(id, "pause", `{}`)
	if paused.status != 200 {
		t.Fatalf("pause: %d %s", paused.status, paused.body)
	}
	replAssertKeys(t, draftFlowObject(t, paused.body))
	closed := f.transition(id, "close", `{"process":"continue","reason":"cancelled","reason_note":null}`)
	if closed.status != 200 {
		t.Fatalf("close: %d %s", closed.status, closed.body)
	}
	replAssertView(t, draftFlowObject(t, closed.body), map[string]any{"publication": "closed", "closed_covered": false, "start_replacement_blocker": "no_startable_credits"})

	_, view := f.view(id)
	for _, suffix := range []string{"", "/pipeline", "/board"} {
		got := f.h.do(t, "GET", base+suffix, "", f.owner.token, nil)
		if got.status != 200 {
			t.Fatalf("GET %s: %d %s", suffix, got.status, got.body)
		}
		if embedded := draftFlowObject(t, got.body)["lifecycle"]; !reflect.DeepEqual(embedded, any(view)) {
			t.Fatalf("GET %s lifecycle = %v, want %v", suffix, embedded, view)
		}
	}
	// The conflict envelopes of the lifecycle family carry the same view.
	invalid := f.transition(id, "pause", `{}`)
	data := draftFlowObject(t, invalid.body)["data"].(map[string]any)
	if invalid.status != 409 || draftFlowObject(t, invalid.body)["code"] != "lifecycle_transition_invalid" {
		t.Fatalf("invalid: %d %s", invalid.status, invalid.body)
	}
	replAssertKeys(t, data["lifecycle"].(map[string]any))
}

func TestReplacementReopenGuards(t *testing.T) {
	f := newReplFlow(t)

	assertGuard := func(id, code string, data map[string]any) {
		t.Helper()
		before := publicationFlowSnapshot(t, f.h, id)
		got := f.reopen(id)
		body := draftFlowObject(t, got.body)
		if got.status != 409 || body["code"] != code || len(body) != 3 {
			t.Fatalf("reopen %s: %d %s, want 409 %s", id, got.status, got.body, code)
		}
		gotData := body["data"].(map[string]any)
		wantKeys := len(data) + 1
		if len(gotData) != wantKeys {
			t.Fatalf("data = %v, want keys %v + lifecycle", gotData, data)
		}
		for k, v := range data {
			if gotData[k] != v {
				t.Fatalf("data[%s] = %v, want %v (%s)", k, gotData[k], v, got.body)
			}
		}
		_, view := f.view(id)
		if !reflect.DeepEqual(gotData["lifecycle"], any(view)) {
			t.Fatalf("data.lifecycle = %v, want the process' view %v", gotData["lifecycle"], view)
		}
		if after := publicationFlowSnapshot(t, f.h, id); after != before {
			t.Fatal("a rejected reopen wrote")
		}
	}

	t.Run("closed covered needs a replacement, and never masks a stale ETag", func(t *testing.T) {
		id := f.published()
		f.closeIt(id, "continue")
		f.cover(id)
		assertGuard(id, "reopen_requires_replacement", map[string]any{"action": "reopen"})
		stale := f.h.do(t, "POST", draftFlowV2Path+"/"+id+"/lifecycle/reopen", `{}`, f.owner.token, map[string]string{"If-Match": `"vl-` + id + `-v99"`, "Idempotency-Key": uuid.NewString()})
		draftFlowAssertCatalogError(t, stale, 412, "version_conflict")
	})

	t.Run("closed not covered reopens as today", func(t *testing.T) {
		id := f.published()
		f.closeIt(id, "continue")
		f.credit(id, "did_not_hold") // fallen hires do not make a cancelled close "covered"
		got := f.reopen(id)
		replAssertView(t, draftFlowObject(t, got.body), map[string]any{"publication": "published", "process": "active", "closed_covered": false})
		if got.status != 200 {
			t.Fatalf("reopen: %d %s", got.status, got.body)
		}
	})

	t.Run("a replacement that closed covered needs another replacement", func(t *testing.T) {
		root := f.published()
		f.closeIt(root, "finish")
		first := f.published()
		f.link(first, root, root, 1)
		f.closeIt(first, "continue")
		f.cover(first)
		assertGuard(first, "reopen_requires_replacement", map[string]any{"action": "reopen"})
	})

	t.Run("an active replacement blocks the reopen of every other process", func(t *testing.T) {
		root := f.published()
		f.closeIt(root, "finish")
		active := f.published()
		f.link(active, root, root, 1)
		assertGuard(root, "replacement_already_active", map[string]any{"process_id": active, "root_process_id": root})
	})

	t.Run("a process with a successor is superseded; only the latest reopens", func(t *testing.T) {
		root := f.published()
		f.closeIt(root, "finish")
		first := f.published()
		f.link(first, root, root, 1)
		f.closeIt(first, "finish")
		second := f.published()
		f.link(second, first, root, 2)
		f.closeIt(second, "continue")

		// second is closed-active: it is the active replacement itself, so every older one is blocked by it...
		assertGuard(root, "replacement_already_active", map[string]any{"process_id": second, "root_process_id": root})
		assertGuard(first, "replacement_already_active", map[string]any{"process_id": second, "root_process_id": root})
		// ...and the latest, being its own active replacement, reopens.
		if got := f.reopen(second); got.status != 200 {
			t.Fatalf("reopen latest: %d %s", got.status, got.body)
		}
		f.closeIt(second, "finish")

		// Nobody is active now: the guard is the successor.
		assertGuard(root, "reopen_superseded", map[string]any{"successor_process_id": first, "root_process_id": root})
		assertGuard(first, "reopen_superseded", map[string]any{"successor_process_id": second, "root_process_id": root})
		_, view := f.view(second)
		if !reflect.DeepEqual(replActions(view), []string{"reopen"}) {
			t.Fatalf("latest actions = %v", replActions(view))
		}
		if got := f.reopen(second); got.status != 200 {
			t.Fatalf("reopen latest after finish: %d %s", got.status, got.body)
		}
	})

	t.Run("covered wins over an active replacement", func(t *testing.T) {
		root := f.published()
		f.closeIt(root, "finish")
		f.cover(root)
		active := f.published()
		f.link(active, root, root, 1)
		assertGuard(root, "reopen_requires_replacement", map[string]any{"action": "reopen"})
	})

	t.Run("a state that never allowed reopen keeps lifecycle_transition_invalid", func(t *testing.T) {
		id := f.published()
		got := f.reopen(id)
		draftFlowAssertCatalogError(t, got, 409, "lifecycle_transition_invalid")
	})

	t.Run("a stranger cannot learn the chain", func(t *testing.T) {
		id := f.published()
		f.closeIt(id, "continue")
		f.cover(id)
		_, foreignID, foreignSub := draftFlowNewPrincipal(t, f.h.pool, "active")
		foreign := f.h.actor(t, foreignID, foreignSub)
		got := f.h.do(t, "POST", draftFlowV2Path+"/"+id+"/lifecycle/reopen", `{}`, foreign.token, map[string]string{"If-Match": `"vl-` + id + `-v3"`, "Idempotency-Key": uuid.NewString()})
		draftFlowAssertCatalogError(t, got, 404, "not_found")
	})
}
