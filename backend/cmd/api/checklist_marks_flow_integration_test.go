//go:build integration

package main

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func checklistMarksItems(t *testing.T, r draftFlowResponse) []any {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	if r.status != 200 {
		t.Fatalf("marks=%d %s", r.status, r.body)
	}
	obj := draftFlowObject(t, r.body)
	items, ok := obj["items"].([]any)
	if len(obj) != 1 || !ok {
		t.Fatal(string(r.body))
	}
	return items
}
func checklistMarkAssert(t *testing.T, r draftFlowResponse, pid, cid, uid string) map[string]any {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	if r.status != 200 {
		t.Fatalf("mark=%d %s", r.status, r.body)
	}
	obj := draftFlowObject(t, r.body)
	by, ok := obj["marked_by"].(map[string]any)
	if len(obj) != 6 || obj["participation_id"] != pid || obj["criterion_id"] != cid || !ok || len(by) != 2 || by["id"] != uid || by["full_name"] == "" {
		t.Fatalf("mark shape=%s", r.body)
	}
	if _, err := time.Parse(time.RFC3339Nano, obj["marked_at"].(string)); err != nil {
		t.Fatal(err)
	}
	return obj
}
func checklistMarksAudit(t *testing.T, h *draftFlowHarness, pid string, count int, previous, next string) {
	t.Helper()
	var got int
	var raw []byte
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationChecklistMarked'`, pid).Scan(&got); err != nil || got != count {
		t.Fatal(got, count, err)
	}
	if count == 0 {
		return
	}
	if err := h.pool.QueryRow(context.Background(), `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationChecklistMarked' ORDER BY occurred_at DESC,id DESC LIMIT 1`, pid).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var metadata map[string]string
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"previous": previous, "new": next} {
		var a, b any
		errA := json.Unmarshal([]byte(metadata[key]), &a)
		errB := json.Unmarshal([]byte(want), &b)
		if errA != nil || errB != nil || !reflect.DeepEqual(a, b) {
			t.Fatal(key, metadata, want, errA, errB)
		}
	}
	if metadata["vacancy_id"] == "" || metadata["criterion_id"] == "" {
		t.Fatal(metadata)
	}
}

func TestChecklistMarksFlowWriteReadNoopRetentionAndLifecycle(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	principalID, principalSub := company.addUser(t, "recruiter")
	principal := h.actor(t, principalID, principalSub)
	id := publicationFlowReady(t, h, principal)
	base := draftFlowV2Path + "/" + id
	path := base + "/checklist"
	if len(checklistMarksItems(t, h.do(t, "GET", path+"/marks", "", owner.token, nil))) != 0 {
		t.Fatal("never-published marks")
	}
	cid := uuid.NewString()
	body := checklistFlowBody(cid, "[]")
	saved := h.do(t, "PUT", path, body, owner.token, map[string]string{"If-Match": checklist.ETag(uuid.MustParse(id), 0)})
	checklistFlowAssert(t, saved, id, 1)
	publicFlowPublish(t, h, id, owner)
	config := pipelineconfig.Defaults(uuid.MustParse(id))
	pid := draftListCandidateSeed(t, h, id, config.Stages[0].ID)
	markPath := base + "/participations/" + pid + "/checklist-marks/" + cid
	marked := h.do(t, "PUT", markPath, `{"verdict":"met","note":"  Checked  "}`, owner.token, nil)
	m := checklistMarkAssert(t, marked, pid, cid, uid.String())
	if m["verdict"] != "met" || m["note"] != "Checked" {
		t.Fatal(m)
	}
	checklistMarksAudit(t, h, pid, 1, "null", `{"verdict":"met","note":"Checked"}`)
	before := checklistFlowSnapshot(t, h, id)
	noop := h.do(t, "PUT", markPath, `{"verdict":"met","note":"Checked"}`, principal.token, nil)
	checklistMarkAssert(t, noop, pid, cid, uid.String())
	if !reflect.DeepEqual(marked.body, noop.body) || before != checklistFlowSnapshot(t, h, id) {
		t.Fatal("identical mark changed timestamp/author/audit")
	}
	changed := h.do(t, "PUT", markPath, `{"verdict":"not_met","note":" "}`, principal.token, nil)
	m = checklistMarkAssert(t, changed, pid, cid, principalID.String())
	if m["verdict"] != "not_met" || m["note"] != nil {
		t.Fatal(m)
	}
	checklistMarksAudit(t, h, pid, 2, `{"verdict":"met","note":"Checked"}`, `{"verdict":"not_met","note":null}`)
	items := checklistMarksItems(t, h.do(t, "GET", path+"/marks", "", owner.token, nil))
	if len(items) != 1 || !reflect.DeepEqual(items[0], m) {
		t.Fatal(items, m)
	}
	// Names are resolved at read time, not snapshotted into marks.
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET full_name='Renamed recruiter' WHERE id=$1`, principalID); err != nil {
		t.Fatal(err)
	}
	items = checklistMarksItems(t, h.do(t, "GET", path+"/marks", "", owner.token, nil))
	if items[0].(map[string]any)["marked_by"].(map[string]any)["full_name"] != "Renamed recruiter" {
		t.Fatal(items)
	}
	removed := h.do(t, "PUT", path, `{"criteria":[],"reminder_stage_ids":[]}`, owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	checklistFlowAssert(t, removed, id, 2)
	if len(checklistMarksItems(t, h.do(t, "GET", path+"/marks", "", owner.token, nil))) != 0 {
		t.Fatal("removed criterion visible")
	}
	restored := h.do(t, "PUT", path, body, owner.token, map[string]string{"If-Match": removed.header.Get("ETag")})
	checklistFlowAssert(t, restored, id, 3)
	if len(checklistMarksItems(t, h.do(t, "GET", path+"/marks", "", owner.token, nil))) != 1 {
		t.Fatal("readded criterion lost mark")
	}
	participation := h.do(t, "GET", base+"/participations/"+pid, "", owner.token, nil)
	discarded := h.do(t, "POST", base+"/participations/"+pid+"/discard", `{"reason":{"group":"candidate","key":"unresponsive"},"comment":"Checklist test","candidate_message":"Checklist test"}`, owner.token, map[string]string{"If-Match": draftFlowObject(t, participation.body)["etag"].(string)})
	if discarded.status != 200 {
		t.Fatalf("discard=%d %s", discarded.status, discarded.body)
	}
	if len(checklistMarksItems(t, h.do(t, "GET", path+"/marks", "", owner.token, nil))) != 1 {
		t.Fatal("discarded mark hidden")
	}
	cleared := h.do(t, "DELETE", markPath, "", owner.token, nil)
	draftFlowAssertNoStore(t, cleared)
	if cleared.status != 204 || len(cleared.body) != 0 {
		t.Fatal(cleared.status, string(cleared.body))
	}
	checklistMarksAudit(t, h, pid, 3, `{"verdict":"not_met","note":null}`, "null")
	before = checklistFlowSnapshot(t, h, id)
	again := h.do(t, "DELETE", markPath, "", owner.token, nil)
	if again.status != 204 || before != checklistFlowSnapshot(t, h, id) {
		t.Fatal("delete not idempotent")
	}
	if len(checklistMarksItems(t, h.do(t, "GET", path+"/marks", "", owner.token, nil))) != 0 {
		t.Fatal("deleted mark visible")
	}
	// Pausing or closing with an active process must not freeze configuration/marks.
	for _, step := range []struct{ action, body string }{
		{"pause", `{}`},
		{"close", `{"process":"continue","reason":"cancelled","reason_note":null}`},
	} {
		current := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
		transition := h.do(t, "POST", base+"/lifecycle/"+step.action, step.body, owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
		if transition.status != 200 {
			t.Fatal(transition.status, string(transition.body))
		}
		checklistFlowAssert(t, h.do(t, "PUT", path, body, owner.token, map[string]string{"If-Match": restored.header.Get("ETag")}), id, 3)
		checklistMarkAssert(t, h.do(t, "PUT", markPath, `{"verdict":"met"}`, owner.token, nil), pid, cid, uid.String())
	}
	// Finish via the real lifecycle route; all mark writes are blocked, reads work.
	current := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
	closed := h.do(t, "POST", base+"/lifecycle/finish-process", `{}`, owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if closed.status != 200 {
		t.Fatal(closed.status, string(closed.body))
	}
	before = checklistFlowSnapshot(t, h, id)
	for _, method := range []string{"PUT", "DELETE"} {
		r := h.do(t, method, markPath, `{"verdict":"met"}`, owner.token, nil)
		draftFlowAssertCatalogError(t, r, 409, "process_finished")
	}
	checklistMarksItems(t, h.do(t, "GET", path+"/marks", "", owner.token, nil))
	if before != checklistFlowSnapshot(t, h, id) {
		t.Fatal("finished writes changed marks/audit")
	}
}

func TestChecklistMarksFlowRejectedWritesAndOrdering(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	nonID, nonSub := company.addUser(t, "recruiter")
	non := h.actor(t, nonID, nonSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	id := publicationFlowReady(t, h, owner)
	base := draftFlowV2Path + "/" + id
	cid := uuid.NewString()
	saved := h.do(t, "PUT", base+"/checklist", checklistFlowBody(cid, "[]"), owner.token, map[string]string{"If-Match": checklist.ETag(uuid.MustParse(id), 0)})
	checklistFlowAssert(t, saved, id, 1)
	publicFlowPublish(t, h, id, owner)
	config := pipelineconfig.Defaults(uuid.MustParse(id))
	pid := draftListCandidateSeed(t, h, id, config.Stages[0].ID)
	other := publicationFlowReady(t, h, owner)
	publicFlowPublish(t, h, other, owner)
	otherPID := draftListCandidateSeed(t, h, other, pipelineconfig.Defaults(uuid.MustParse(other)).Stages[0].ID)
	path := base + "/participations/" + pid + "/checklist-marks/" + cid
	checklistMarkAssert(t, h.do(t, "PUT", path, `{"verdict":"not_met"}`, owner.token, nil), pid, cid, uid.String())
	before := checklistFlowSnapshot(t, h, id)
	for _, tc := range []struct {
		name, path, body, token string
		status                  int
	}{
		{"foreign participation", strings.Replace(path, pid, otherPID, 1), `{"verdict":"met"}`, owner.token, 404},
		{"missing criterion", strings.Replace(path, cid, uuid.NewString(), 1), `{"verdict":"met"}`, owner.token, 404},
		{"bad participation", strings.Replace(path, pid, "bad", 1), `{"verdict":"met"}`, owner.token, 404},
		{"bad criterion", strings.Replace(path, cid, "bad", 1), `{"verdict":"met"}`, owner.token, 404},
		{"foreign vacancy", path, `{"verdict":"met"}`, foreign.token, 404},
		{"nonprincipal", path, `{"verdict":"met"}`, non.token, 404},
		{"invalid verdict", path, `{"verdict":"maybe"}`, owner.token, 400},
		{"long note", path, `{"verdict":"met","note":"` + strings.Repeat("á", 501) + `"}`, owner.token, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, method := range []string{"PUT", "DELETE"} {
				if method == "DELETE" && tc.status == 400 {
					continue
				}
				r := h.do(t, method, tc.path, tc.body, tc.token, nil)
				draftFlowAssertNoStore(t, r)
				if r.status != tc.status {
					t.Fatalf("%s=%d %s", method, r.status, r.body)
				}
				if before != checklistFlowSnapshot(t, h, id) {
					t.Fatal("rejection changed state")
				}
			}
		})
	}
	for _, actor := range []draftFlowActor{foreign, non} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", base+"/checklist/marks", "", actor.token, nil), 404, "not_found")
	}
	pid2 := draftListCandidateSeed(t, h, id, config.Stages[0].ID)
	cid2 := uuid.NewString()
	updated := h.do(t, "PUT", base+"/checklist", checklistCriteriaBody(checklistCriterion(cid, "manual", `{}`), checklistCriterion(cid2, "manual", `{}`)), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	checklistFlowAssert(t, updated, id, 2)
	for _, p := range []string{pid2, pid} {
		for _, criterion := range []string{cid2, cid} {
			r := h.do(t, "PUT", base+"/participations/"+p+"/checklist-marks/"+criterion, `{"verdict":"met"}`, owner.token, nil)
			checklistMarkAssert(t, r, p, criterion, uid.String())
		}
	}
	items := checklistMarksItems(t, h.do(t, "GET", base+"/checklist/marks", "", owner.token, nil))
	if len(items) != 4 {
		t.Fatal(items)
	}
	previousKey := ""
	for _, raw := range items {
		item := raw.(map[string]any)
		key := item["participation_id"].(string) + item["criterion_id"].(string)
		if key <= previousKey {
			t.Fatal("marks not ordered", items)
		}
		previousKey = key
	}
}
