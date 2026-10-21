//go:build integration

package main

import (
	"bytes"
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLifecycleFlowAuthorizationOrderReplayAndL1Effects(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	principalID, principalSub := company.addUser(t, "recruiter")
	principal := h.actor(t, principalID, principalSub)
	otherID, otherSub := company.addUser(t, "recruiter")
	other := h.actor(t, otherID, otherSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	candidateID, candidateSub := draftFlowInsertUser(t, h.pool)
	t.Cleanup(func() { _, _ = h.pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, candidateID) })
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET user_type='candidate' WHERE id=$1`, candidateID); err != nil {
		t.Fatal(err)
	}
	candidate := h.actor(t, candidateID, candidateSub)
	id := publicationFlowReady(t, h, principal)
	base := draftFlowV2Path + "/" + id
	path := base + "/lifecycle"
	read := h.do(t, "GET", path, "", owner.token, nil)
	obj := draftFlowObject(t, read.body)
	if read.status != 200 || len(obj) != 10 || obj["publication"] != nil || obj["process"] != nil || obj["version"] != "0" || obj["allowed_actions"].([]any)[0] != "publish" || read.header.Get("ETag") != `"vl-`+id+`-v0"` {
		t.Fatalf("draft=%d %s", read.status, read.body)
	}
	history := h.do(t, "GET", path+"/history", "", principal.token, nil)
	if history.status != 200 || string(history.body) != `{"items":[]}` {
		t.Fatalf("history=%d %s", history.status, history.body)
	}
	draft := h.do(t, "GET", base, "", principal.token, nil)
	published := h.do(t, "POST", base+"/publication", `{}`, owner.token, map[string]string{"If-Match": draft.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if published.status != 201 {
		t.Fatalf("publish=%d %s", published.status, published.body)
	}
	read = h.do(t, "GET", path, "", principal.token, nil)
	if read.status != 200 || read.header.Get("ETag") != `"vl-`+id+`-v1"` {
		t.Fatal(read)
	}
	for _, caller := range []struct {
		name, token string
		status      int
		code        string
	}{{"other", other.token, 404, "not_found"}, {"foreign", foreign.token, 404, "not_found"}, {"candidate", candidate.token, 403, "forbidden"}, {"anonymous", "", 401, "unauthenticated"}} {
		t.Run(caller.name, func(t *testing.T) {
			for _, suffix := range []string{"", "/history"} {
				got := h.do(t, "GET", path+suffix, "", caller.token, nil)
				draftFlowAssertNoStore(t, got)
				publicationFlowAssertError(t, got, caller.status, caller.code, nil)
			}
			got := h.do(t, "POST", path+"/pause", `bad`, caller.token, nil)
			publicationFlowAssertError(t, got, caller.status, caller.code, nil)
		})
	}
	for _, tc := range []struct {
		name, suffix, body string
		headers            map[string]string
		status             int
		code               string
	}{
		{"key before precondition", "/pause", `{}`, nil, 400, "idempotency_key_required"},
		{"precondition before body", "/pause", `bad`, map[string]string{"Idempotency-Key": uuid.NewString()}, 428, "precondition_required"},
		{"draft etag rejected", "/pause", `{}`, map[string]string{"Idempotency-Key": uuid.NewString(), "If-Match": draft.header.Get("ETag")}, 400, "invalid_request"},
		{"stale", "/pause", `{}`, map[string]string{"Idempotency-Key": uuid.NewString(), "If-Match": `"vl-` + id + `-v9"`}, 412, "version_conflict"},
		{"strict close", "/close", `{}`, map[string]string{"Idempotency-Key": uuid.NewString(), "If-Match": read.header.Get("ETag")}, 400, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := publicationFlowSnapshot(t, h, id)
			got := h.do(t, "POST", path+tc.suffix, tc.body, owner.token, tc.headers)
			publicationFlowAssertError(t, got, tc.status, tc.code, nil)
			if before != publicationFlowSnapshot(t, h, id) {
				t.Fatal("rejection wrote")
			}
		})
	}
	key := uuid.NewString()
	paused := h.do(t, "POST", path+"/pause", `{}`, principal.token, map[string]string{"Idempotency-Key": key, "If-Match": read.header.Get("ETag")})
	draftFlowAssertNoStore(t, paused)
	if paused.status != 200 || paused.header.Get("Idempotency-Replayed") != "false" || draftFlowObject(t, paused.body)["publication"] != "paused" {
		t.Fatalf("pause=%d %s", paused.status, paused.body)
	}
	replay := h.do(t, "POST", path+"/pause", ` { } `, principal.token, map[string]string{"Idempotency-Key": key})
	if replay.status != 200 || replay.header.Get("Idempotency-Replayed") != "true" || !bytes.Equal(replay.body, paused.body) || replay.header.Get("ETag") != paused.header.Get("ETag") {
		t.Fatalf("replay=%d %s", replay.status, replay.body)
	}
	invalid := h.do(t, "POST", path+"/reopen", `{}`, owner.token, map[string]string{"Idempotency-Key": uuid.NewString(), "If-Match": paused.header.Get("ETag")})
	if invalid.status != 409 || draftFlowObject(t, invalid.body)["code"] != "lifecycle_transition_invalid" || draftFlowObject(t, invalid.body)["data"].(map[string]any)["action"] != "reopen" {
		t.Fatalf("invalid=%d %s", invalid.status, invalid.body)
	}
	// L2 exposes only the safe public tombstone while paused.
	for _, suffix := range []string{"", "/screening"} {
		got := h.do(t, "GET", "/v2/jobs/"+id+suffix, "", "", nil)
		if got.status != 410 {
			t.Fatalf("L2 availability=%d %s", got.status, got.body)
		}
	}
	// Content saves remain allowed while hidden; their frozen response contract
	// stays independent from the additive lifecycle view on editor GET.
	changed := h.do(t, "PATCH", base, `{"fields":{"title":"Hidden vacancy edit"}}`, owner.token, map[string]string{"If-Match": draft.header.Get("ETag")})
	if changed.status != 200 {
		t.Fatalf("hidden edit=%d %s", changed.status, changed.body)
	}
	if _, err := h.pool.Exec(context.Background(), `UPDATE job_draft_management_configs SET hiring_headcount=NULL WHERE draft_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	incomplete := h.do(t, "POST", path+"/resume", `{}`, owner.token, map[string]string{"Idempotency-Key": uuid.NewString(), "If-Match": paused.header.Get("ETag")})
	publicationFlowAssertError(t, incomplete, 422, "publication_incomplete", []string{"hiring_headcount_missing"})
	if _, err := h.pool.Exec(context.Background(), `UPDATE job_draft_management_configs SET hiring_headcount=2 WHERE draft_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	closed := h.do(t, "POST", path+"/close", `{"process":"finish","reason":"cancelled","reason_note":null}`, owner.token, map[string]string{"Idempotency-Key": uuid.NewString(), "If-Match": paused.header.Get("ETag")})
	if closed.status != 200 {
		t.Fatalf("close=%d %s", closed.status, closed.body)
	}
	reopened := h.do(t, "POST", path+"/reopen", `{}`, owner.token, map[string]string{"Idempotency-Key": uuid.NewString(), "If-Match": closed.header.Get("ETag")})
	if reopened.status != 200 || draftFlowObject(t, reopened.body)["process"] != "active" {
		t.Fatalf("reopen=%d %s", reopened.status, reopened.body)
	}
	public := h.do(t, "GET", "/v2/jobs/"+id, "", "", nil)
	if public.status != 200 {
		t.Fatalf("restored public=%d %s", public.status, public.body)
	}
	history = h.do(t, "GET", path+"/history", "", owner.token, nil)
	items := draftFlowObject(t, history.body)["items"].([]any)
	if len(items) != 3 || items[2].(map[string]any)["actor"].(map[string]any)["id"] != principalID.String() {
		t.Fatalf("history=%s", history.body)
	}
}
