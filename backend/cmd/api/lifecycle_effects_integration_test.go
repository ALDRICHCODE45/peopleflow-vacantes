//go:build integration

package main

import (
	"context"
	"encoding/json"
	"net/url"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func lifecycleFlowWithoutView(t *testing.T, body []byte) []byte {
	t.Helper()
	root := draftFlowObject(t, body)
	delete(root, "lifecycle")
	raw, err := json.Marshal(root)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestLifecycleEffectsPublicPrivacyEmbeddingsAndConfigurationWire(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	id := publicationFlowReady(t, h, owner)
	base := draftFlowV2Path + "/" + id
	draft := h.do(t, "GET", base, "", owner.token, nil)
	title := draftFlowFields(t, draft.body)["title"]
	var companyName string
	if err := h.pool.QueryRow(context.Background(), `SELECT name FROM companies WHERE id=$1`, company.companyID).Scan(&companyName); err != nil {
		t.Fatal(err)
	}
	for _, unknown := range []string{id, uuid.NewString(), "malformed"} {
		for _, suffix := range []string{"", "/screening"} {
			got := publicFlowGet(t, h, "/v2/jobs/"+unknown+suffix, 404)
			if len(got) != 2 || got["code"] != "not_found" {
				t.Fatal(got)
			}
		}
	}
	publicFlowPublish(t, h, id, owner)
	// Hit the DB-backed board before any transition too: the harness must wire
	// the real movement handler, not return its nil-handler fallback 500.
	publishedView := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
	board := h.do(t, "GET", base+"/board", "", owner.token, nil)
	if board.status != 200 || !reflect.DeepEqual(draftFlowObject(t, board.body)["lifecycle"], draftFlowObject(t, publishedView.body)) {
		t.Fatalf("published board: %d %s", board.status, board.body)
	}
	for _, step := range []struct{ action, body, state, process string }{
		{"pause", `{}`, "paused", "active"},
		{"close", `{"process":"continue"}`, "closed", "active"},
		{"finish-process", `{}`, "closed", "finished"},
	} {
		current := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
		changed := h.do(t, "POST", base+"/lifecycle/"+step.action, step.body, owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
		if changed.status != 200 {
			t.Fatal(changed.status, string(changed.body))
		}
		wantView := draftFlowObject(t, changed.body)
		before := publicationFlowSnapshot(t, h, id)
		for _, suffix := range []string{"", "/screening"} {
			got := publicFlowGet(t, h, "/v2/jobs/"+id+suffix, 410)
			if len(got) != 3 || got["error"] != "vacancy unavailable" || got["code"] != "vacancy_unavailable" || !reflect.DeepEqual(got["data"], map[string]any{"id": id, "title": title, "company": map[string]any{"id": company.companyID.String(), "name": companyName}, "availability": step.state}) {
				t.Fatal("tombstone wire/privacy", got)
			}
		}
		for _, query := range []string{"", "?q=" + url.QueryEscape(title.(string))} {
			page := publicFlowGet(t, h, "/v2/jobs"+query, 200)
			for _, item := range page["items"].([]any) {
				if item.(map[string]any)["id"] == id {
					t.Fatal("hidden vacancy listed")
				}
			}
		}
		for _, suffix := range []string{"", "/pipeline", "/board"} {
			got := h.do(t, "GET", base+suffix, "", owner.token, nil)
			draftFlowAssertNoStore(t, got)
			root := draftFlowObject(t, got.body)
			if got.status != 200 || !reflect.DeepEqual(root["lifecycle"], wantView) {
				t.Fatal("embedding", suffix, got.status, string(got.body))
			}
			wantKeys := 9
			if suffix == "/pipeline" {
				wantKeys = 7
			}
			if suffix == "/board" {
				wantKeys = 9
			}
			if len(root) != wantKeys {
				t.Fatal("root keys", suffix, len(root), root)
			}
		}
		list := h.do(t, "GET", draftFlowV2Path, "", owner.token, nil)
		item := draftFlowObject(t, list.body)["items"].([]any)[0].(map[string]any)
		if list.status != 200 || len(item) != 12 || item["status"] != step.state || item["process"] != step.process {
			t.Fatal("company list", string(list.body))
		}
		if step.process == "finished" {
			for _, op := range []struct{ method, suffix string }{
				{"PUT", "/pipeline"}, {"POST", "/pipeline/preview"}, {"PUT", "/pipeline/substates"}, {"PUT", "/pipeline/delivery"}, {"PUT", "/management"},
			} {
				got := h.do(t, op.method, base+op.suffix, `{}`, owner.token, nil)
				draftFlowAssertNoStore(t, got)
				root := draftFlowObject(t, got.body)
				if got.status != 409 || len(root) != 3 || root["error"] != "process finished" || root["code"] != "process_finished" || !reflect.DeepEqual(root["data"], map[string]any{"lifecycle": wantView}) || got.header.Get("ETag") != "" {
					t.Fatal("finished config wire", op, got.status, string(got.body))
				}
			}
		}
		if before != publicationFlowSnapshot(t, h, id) {
			t.Fatal("reads/rejections wrote data")
		}
		// The live company gate still hides the tombstone, not just published detail.
		if _, err := h.pool.Exec(context.Background(), `UPDATE companies SET status='suspended' WHERE id=$1`, company.companyID); err != nil {
			t.Fatal(err)
		}
		for _, suffix := range []string{"", "/screening"} {
			got := publicFlowGet(t, h, "/v2/jobs/"+id+suffix, 404)
			if len(got) != 2 || got["code"] != "not_found" {
				t.Fatal(got)
			}
		}
		if _, err := h.pool.Exec(context.Background(), `UPDATE companies SET status='active' WHERE id=$1`, company.companyID); err != nil {
			t.Fatal(err)
		}
	}
}
