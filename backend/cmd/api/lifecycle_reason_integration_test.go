//go:build integration

package main

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestLifecycleCloseReasonHTTPContract(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, actorID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, actorID, sub)
	id := publicationFlowReady(t, h, actor)
	publicFlowPublish(t, h, id, actor)
	base := draftFlowV2Path + "/" + id
	path := base + "/lifecycle"
	current := h.do(t, "GET", path, "", actor.token, nil)
	post := func(action, body string) draftFlowResponse {
		t.Helper()
		return h.do(t, "POST", path+"/"+action, body, actor.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	}
	for _, body := range []string{
		`{"process":"continue"}`,
		`{"process":"continue","reason":"unknown","reason_note":null}`,
		`{"process":"continue","reason":"filled","reason_note":"x"}`,
		`{"process":"continue","reason":"cancelled","reason_note":"x"}`,
		`{"process":"continue","reason":"other"}`,
		`{"process":"continue","reason":"other","reason_note":null}`,
		`{"process":"continue","reason":"other","reason_note":""}`,
		`{"process":"continue","reason":"other","reason_note":" \t\n "}`,
		`{"process":"continue","reason":"other","reason_note":"` + strings.Repeat("界", 201) + `"}`,
	} {
		t.Run(body, func(t *testing.T) {
			before := publicationFlowSnapshot(t, h, id)
			got := post("close", body)
			publicationFlowAssertError(t, got, 400, "invalid_request", nil)
			if before != publicationFlowSnapshot(t, h, id) {
				t.Fatal("invalid body wrote")
			}
		})
	}
	// The board and close rule must use the same live semantic Placement count.
	config := pipelineconfig.Defaults(uuid.MustParse(id))
	placement := config.Stages[len(config.Stages)-1].ID
	draftListCandidateSeed(t, h, id, placement)
	for _, required := range []any{int64(2), nil} {
		if _, err := h.pool.Exec(context.Background(), `UPDATE job_draft_management_configs SET hiring_headcount=$2 WHERE draft_id=$1`, id, required); err != nil {
			t.Fatal(err)
		}
		board := h.do(t, "GET", base+"/board", "", actor.token, nil)
		if board.status != 200 {
			t.Fatal(board.status, string(board.body))
		}
		coverage := draftFlowObject(t, board.body)["coverage"].(map[string]any)
		before := publicationFlowSnapshot(t, h, id)
		got := post("close", `{"process":"finish","reason":"filled","reason_note":null}`)
		draftFlowAssertNoStore(t, got)
		root := draftFlowObject(t, got.body)
		want := map[string]any{"covered": coverage["covered"], "required": coverage["required"]}
		if got.status != 422 || len(root) != 3 || root["code"] != "close_reason_not_covered" || !reflect.DeepEqual(root["data"], want) || coverage["covered"] != float64(1) {
			t.Fatal("coverage response", got.status, string(got.body), coverage)
		}
		if before != publicationFlowSnapshot(t, h, id) {
			t.Fatal("coverage rejection wrote")
		}
	}
	if _, err := h.pool.Exec(context.Background(), `UPDATE job_draft_management_configs SET hiring_headcount=1 WHERE draft_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	current = post("close", `{"process":"continue","reason":"filled","reason_note":null}`)
	if current.status != 200 {
		t.Fatal(current.status, string(current.body))
	}
	assertReads := func(reason, note any) {
		t.Helper()
		view := draftFlowObject(t, current.body)
		if len(view) != 10 || view["close_reason"] != reason || view["close_reason_note"] != note {
			t.Fatal("view", view)
		}
		for _, suffix := range []string{"", "/pipeline", "/board"} {
			read := h.do(t, "GET", base+suffix, "", actor.token, nil)
			if read.status != 200 || !reflect.DeepEqual(draftFlowObject(t, read.body)["lifecycle"], view) {
				t.Fatal("embedded reason", suffix, read.status, string(read.body))
			}
		}
		item := draftListCandidateItem(t, h, actor, id)
		if item["close_reason"] != reason || item["close_reason_note"] != note {
			t.Fatal("list reason", item)
		}
	}
	assertReads("filled", nil)
	current = post("reopen", `{}`)
	if current.status != 200 {
		t.Fatal(current.status, string(current.body))
	}
	assertReads(nil, nil)
	note := strings.Repeat("界", 200)
	current = post("close", `{"process":"finish","reason":"other","reason_note":"  `+note+`  "}`)
	if current.status != 200 {
		t.Fatal(current.status, string(current.body))
	}
	assertReads("other", note)
	history := h.do(t, "GET", path+"/history", "", actor.token, nil)
	items := draftFlowObject(t, history.body)["items"].([]any)
	if history.status != 200 || len(items) != 3 {
		t.Fatal(history.status, string(history.body))
	}
	for i, raw := range items {
		item := raw.(map[string]any)
		if len(item) != 7 {
			t.Fatal("history keys", item)
		}
		if i == 0 && (item["reason"] != "other" || item["reason_note"] != note) || i == 1 && (item["reason"] != nil || item["reason_note"] != nil) || i == 2 && (item["reason"] != "filled" || item["reason_note"] != nil) {
			t.Fatal("history reason", item)
		}
	}
}
