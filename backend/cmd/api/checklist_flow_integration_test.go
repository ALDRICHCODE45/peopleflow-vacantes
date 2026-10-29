//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func checklistFlowAssert(t *testing.T, r draftFlowResponse, id string, version int64) checklist.Checklist {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	if r.status != 200 || r.header.Get("ETag") != checklist.ETag(uuid.MustParse(id), version) {
		t.Fatalf("checklist=%d %s %v", r.status, r.body, r.header)
	}
	obj := draftFlowObject(t, r.body)
	if len(obj) != 3 || obj["version"] != fmt.Sprint(version) {
		t.Fatalf("checklist shape=%s", r.body)
	}
	c, err := checklist.Decode(r.body)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func checklistFlowSnapshot(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var raw string
	err := h.pool.QueryRow(context.Background(), `SELECT json_build_array(
 (SELECT row_to_json(c) FROM job_draft_checklists c WHERE draft_id=$1),
 (SELECT json_agg(m ORDER BY m.participation_id,m.criterion_id) FROM participation_checklist_marks m JOIN process_participations p ON p.id=m.participation_id WHERE p.process_id=$1),
 (SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1 OR entity_id IN (SELECT id FROM process_participations WHERE process_id=$1)))::text`, id).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func checklistFlowBody(criterionID string, stages string) string {
	return `{"criteria":[{"id":"` + criterionID + `","label":" Reviewed ","importance":"required","kind":"manual","params":{}}],"reminder_stage_ids":` + stages + `}`
}

func TestChecklistFlowStorageValidationAndAccess(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	otherID, otherSub := company.addUser(t, "recruiter")
	other := h.actor(t, otherID, otherSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id
	path := base + "/checklist"
	first := h.do(t, "GET", path, "", owner.token, nil)
	c := checklistFlowAssert(t, first, id, 0)
	if !c.Equal(checklist.Empty()) {
		t.Fatal(c)
	}
	before := checklistFlowSnapshot(t, h, id)
	second := h.do(t, "GET", path, "", owner.token, nil)
	checklistFlowAssert(t, second, id, 0)
	if before != checklistFlowSnapshot(t, h, id) {
		t.Fatal("GET wrote data")
	}
	criterion := uuid.NewString()
	body := checklistFlowBody(criterion, "[]")
	for _, tc := range []struct {
		name, tag string
		present   bool
		status    int
		code      string
	}{
		{"missing", "", false, 428, "precondition_required"}, {"stale", `"old"`, true, 412, "version_conflict"}, {"malformed", "bad", true, 400, "invalid_request"}, {"weak", `W/` + first.header.Get("ETag"), true, 400, "invalid_request"}, {"wildcard", "*", true, 400, "invalid_request"}, {"list", first.header.Get("ETag") + "," + first.header.Get("ETag"), true, 400, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var headers map[string]string
			if tc.present {
				headers = map[string]string{"If-Match": tc.tag}
			}
			r := h.do(t, "PUT", path, body, owner.token, headers)
			draftFlowAssertCatalogError(t, r, tc.status, tc.code)
			if before != checklistFlowSnapshot(t, h, id) {
				t.Fatal("rejected write changed state")
			}
		})
	}
	tag := first.header.Get("ETag")
	invalid := h.do(t, "PUT", path, `{"criteria":[],"reminder_stage_ids":[],"extra":true}`, owner.token, map[string]string{"If-Match": tag})
	wantFields := []any{map[string]any{"field": "extra", "code": "not_allowed"}}
	if invalid.status != 400 || !reflect.DeepEqual(draftFlowObject(t, invalid.body)["fields"], wantFields) || draftFlowObject(t, invalid.body)["code"] != "validation_error" || draftFlowObject(t, invalid.body)["error"] != "validation failed" {
		t.Fatalf("validation=%d %s", invalid.status, invalid.body)
	}
	if before != checklistFlowSnapshot(t, h, id) {
		t.Fatal("validation wrote data")
	}
	saved := h.do(t, "PUT", path, body, owner.token, map[string]string{"If-Match": tag})
	c = checklistFlowAssert(t, saved, id, 1)
	if len(c.Criteria) != 1 || c.Criteria[0].Label != "Reviewed" {
		t.Fatal(c)
	}
	var count int
	var metadata map[string]string
	var raw []byte
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftChecklistConfigured'`, id).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if err := h.pool.QueryRow(context.Background(), `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftChecklistConfigured'`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	previous, err := checklist.Decode([]byte(metadata["previous"]))
	if err != nil || !previous.Equal(checklist.Empty()) {
		t.Fatal(metadata, err)
	}
	next, err := checklist.Decode([]byte(metadata["new"]))
	if err != nil || !next.Equal(c) || metadata["version"] != "1" {
		t.Fatal(metadata, err)
	}
	before = checklistFlowSnapshot(t, h, id)
	noop := h.do(t, "PUT", path, body, owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	checklistFlowAssert(t, noop, id, 1)
	if before != checklistFlowSnapshot(t, h, id) {
		t.Fatal("identical PUT wrote data/audit")
	}
	for _, actor := range []draftFlowActor{other, foreign} {
		for _, method := range []string{"GET", "PUT"} {
			r := h.do(t, method, path, body, actor.token, nil)
			draftFlowAssertCatalogError(t, r, 404, "not_found")
			if before != checklistFlowSnapshot(t, h, id) {
				t.Fatal("foreign write changed state")
			}
		}
	}
	updated := h.do(t, "PUT", path, `{"criteria":[],"reminder_stage_ids":[]}`, owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	checklistFlowAssert(t, updated, id, 2)
}

func TestChecklistFlowRetiredReminderAndFinishedProcess(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	id := publicationFlowReady(t, h, owner)
	base := draftFlowV2Path + "/" + id
	path := base + "/checklist"
	pipeline := h.do(t, "GET", base+"/pipeline", "", owner.token, nil)
	config := pipelineFlowConfig(t, pipeline.body)
	// Custom stages are removable; built-in stages retain semantic identity.
	config.Stages = append(config.Stages[:4], append([]pipelineconfig.Stage{{Name: "Review"}}, config.Stages[4:]...)...)
	added := h.do(t, "PUT", base+"/pipeline", strings.ReplaceAll(pipelineFlowBody(t, config), `"id":"",`, ""), owner.token, map[string]string{"If-Match": pipeline.header.Get("ETag")})
	if added.status != 200 {
		t.Fatalf("add stage=%d %s", added.status, added.body)
	}
	config = pipelineFlowConfig(t, added.body)
	stage := config.Stages[4].ID
	saved := h.do(t, "PUT", path, checklistFlowBody(uuid.NewString(), `["`+stage+`"]`), owner.token, map[string]string{"If-Match": checklist.ETag(uuid.MustParse(id), 0)})
	checklistFlowAssert(t, saved, id, 1)
	config.Stages = append(config.Stages[:4], config.Stages[5:]...)
	removed := h.do(t, "PUT", base+"/pipeline", pipelineFlowBody(t, config), owner.token, map[string]string{"If-Match": added.header.Get("ETag")})
	if removed.status != 200 {
		t.Fatalf("remove stage=%d %s", removed.status, removed.body)
	}
	filtered := h.do(t, "GET", path, "", owner.token, nil)
	c := checklistFlowAssert(t, filtered, id, 1)
	if len(c.ReminderStageIDs) != 0 {
		t.Fatal(c)
	}
	publicFlowPublish(t, h, id, owner)
	current := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
	closed := h.do(t, "POST", base+"/lifecycle/close", `{"process":"finish","reason":"cancelled","reason_note":null}`, owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if closed.status != 200 {
		t.Fatalf("close=%d %s", closed.status, closed.body)
	}
	before := checklistFlowSnapshot(t, h, id)
	rejected := h.do(t, "PUT", path, `{}`, owner.token, nil)
	draftFlowAssertCatalogError(t, rejected, 409, "process_finished")
	checklistFlowAssert(t, h.do(t, "GET", path, "", owner.token, nil), id, 1)
	if before != checklistFlowSnapshot(t, h, id) {
		t.Fatal("finished write changed state")
	}
}
