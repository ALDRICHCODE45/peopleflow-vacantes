//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func TestDraftTeamSummaryFreshAndFrozenResponses(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	memberID, memberSub := company.addUser(t, "recruiter")
	member := h.actor(t, memberID, memberSub)
	key := uuid.NewString()
	body := `{"fields":{}}`
	created := h.do(t, "POST", draftFlowV2Path, body, member.token, map[string]string{"Idempotency-Key": key})
	if created.status != 201 {
		t.Fatal(created.status, string(created.body))
	}
	id := draftFlowObject(t, created.body)["id"].(string)
	base := draftFlowV2Path + "/" + id
	assertSummary := func(raw []byte, viewer any) {
		t.Helper()
		root := draftFlowObject(t, raw)
		if _, present := root["principal_recruiter_id"]; present {
			t.Fatal("old key", string(raw))
		}
		if _, present := root["principal_recruiter"]; present {
			t.Fatal("old list key", string(raw))
		}
		summary, ok := root["team"].(map[string]any)
		if !ok || len(summary) != 4 {
			t.Fatal("team", string(raw))
		}
		responsible := summary["responsible"].(map[string]any)
		if summary["mode"] != "with_responsible" || summary["members_count"] != float64(1) || summary["viewer_function"] != viewer || responsible["id"] != memberID.String() || responsible["name"] == nil || len(responsible) != 2 {
			t.Fatal(summary)
		}
	}
	assertSummary(created.body, "responsible")
	for _, tc := range []struct {
		actor  draftFlowActor
		viewer any
	}{{member, "responsible"}, {owner, nil}} {
		read := h.do(t, "GET", base, "", tc.actor.token, nil)
		if read.status != 200 || read.header.Get("ETag") != created.header.Get("ETag") {
			t.Fatal(read.status, string(read.body))
		}
		assertSummary(read.body, tc.viewer)
		page := h.do(t, "GET", draftFlowV2Path, "", tc.actor.token, nil)
		item := draftFlowObject(t, page.body)["items"].([]any)[0]
		raw, _ := json.Marshal(item)
		assertSummary(raw, tc.viewer)
		saved := h.do(t, "PATCH", base, `{"fields":{"title":null}}`, tc.actor.token, map[string]string{"If-Match": created.header.Get("ETag")})
		if saved.status != 200 || saved.header.Get("ETag") != created.header.Get("ETag") {
			t.Fatal(saved.status, string(saved.body))
		}
		assertSummary(saved.body, tc.viewer)
	}
	// Simulate a response frozen before this contract change. Replay must never
	// rebuild it, even though all fresh responses now carry team.
	legacy := draftFlowObject(t, created.body)
	delete(legacy, "team")
	legacy["principal_recruiter_id"] = memberID.String()
	frozen, _ := json.Marshal(legacy)
	if _, err := h.pool.Exec(context.Background(), `UPDATE job_draft_idempotency SET response_body=$1 WHERE company_id=$2 AND actor_id=$3 AND operation='create:v2' AND idem_key=$4`, frozen, company.companyID, memberID, key); err != nil {
		t.Fatal(err)
	}
	replay := h.do(t, "POST", draftFlowV2Path, body, member.token, map[string]string{"Idempotency-Key": key})
	if replay.status != 201 || replay.header.Get("Idempotency-Replayed") != "true" || replay.header.Get("ETag") != created.header.Get("ETag") || !bytes.Equal(replay.body, frozen) {
		t.Fatal(replay.status, string(replay.body))
	}
	// Shared teams have no responsible; open member function belongs to caller.
	if _, err := h.pool.Exec(context.Background(), `UPDATE vacancy_assignment_functions SET function='member' WHERE draft_id=$1;`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := h.pool.Exec(context.Background(), `UPDATE vacancy_teams SET mode='shared' WHERE draft_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	fresh := h.do(t, "GET", base, "", member.token, nil)
	want := map[string]any{"mode": "shared", "responsible": nil, "members_count": float64(1), "viewer_function": "member"}
	if fresh.status != 200 || !reflect.DeepEqual(draftFlowObject(t, fresh.body)["team"], want) {
		t.Fatal(fresh.status, string(fresh.body))
	}
}
