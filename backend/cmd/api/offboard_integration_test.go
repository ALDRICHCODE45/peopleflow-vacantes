//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func offboardTeamWrite(t *testing.T, h *draftFlowHarness, owner draftFlowActor, id, method, suffix, body string) draftFlowResponse {
	t.Helper()
	base := draftFlowV2Path + "/" + id + "/team"
	team := h.do(t, "GET", base, "", owner.token, nil)
	r := h.do(t, method, base+suffix, body, owner.token, map[string]string{"If-Match": team.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if r.status != 200 {
		t.Fatalf("team %d %s", r.status, r.body)
	}
	return r
}
func offboardPath(t *testing.T, h *draftFlowHarness, user uuid.UUID) string {
	t.Helper()
	return "/me/company/members/" + memberGuardID(t, h.pool, user).String()
}
func offboardHistory(t *testing.T, h *draftFlowHarness, owner draftFlowActor, id string) map[string]any {
	t.Helper()
	r := h.do(t, "GET", draftFlowV2Path+"/"+id+"/team/history", "", owner.token, nil)
	if r.status != 200 {
		t.Fatalf("history %d %s", r.status, r.body)
	}
	return draftFlowObject(t, r.body)
}
func offboardTramo(t *testing.T, h *draftFlowHarness, owner draftFlowActor, id string, user uuid.UUID) map[string]any {
	t.Helper()
	for _, raw := range offboardHistory(t, h, owner, id)["items"].([]any) {
		item := raw.(map[string]any)
		if item["kind"] == "tramo" {
			tr := item["tramo"].(map[string]any)
			if tr["user"].(map[string]any)["id"] == user.String() {
				return tr
			}
		}
	}
	t.Fatal("missing tramo")
	return nil
}
func offboardAssertAudit(t *testing.T, h *draftFlowHarness, actor uuid.UUID, event, entity, id string, want map[string]any) {
	t.Helper()
	rows, err := h.pool.Query(context.Background(), `SELECT actor_id,entity_type,metadata FROM audit_events WHERE event_type=$1 AND entity_id=$2`, event, id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		n++
		var gotActor uuid.UUID
		var gotEntity string
		var raw []byte
		if err := rows.Scan(&gotActor, &gotEntity, &raw); err != nil {
			t.Fatal(err)
		}
		if gotActor != actor || gotEntity != entity {
			t.Fatal(gotActor, gotEntity)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		editJSONEqual(t, got, want)
	}
	if rows.Err() != nil || n != 1 {
		t.Fatal("audit cardinality", n, rows.Err())
	}
}
func TestOffboardPreviewDeleteAndHandoverHTTP(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	leaverID, ls := company.addUser(t, "recruiter")
	leaver := h.actor(t, leaverID, ls)
	targetID, _ := company.addUser(t, "recruiter")
	responsible := draftListFlowCreate(t, h, leaver, `{"fields":{"title":"Responsible"}}`)
	shared := draftListFlowCreate(t, h, leaver, `{"fields":{"title":"Shared"}}`)
	offboardTeamWrite(t, h, owner, shared, "PUT", "/mode", `{"mode":"shared"}`)
	other := draftListFlowCreate(t, h, owner, `{"fields":{"title":"Collaborator"}}`)
	offboardTeamWrite(t, h, owner, other, "POST", "/members", fmt.Sprintf(`{"user_id":%q,"recruiter_deadline":"2027-01-12"}`, leaverID))
	// Existing target stays in its continuous tramo when promoted.
	offboardTeamWrite(t, h, owner, responsible, "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, targetID))
	path := offboardPath(t, h, leaverID)
	membership := path[len("/me/company/members/"):]
	preview := h.do(t, "GET", path+"/offboard-preview", "", owner.token, nil)
	if preview.status != 200 {
		t.Fatalf("preview %d %s", preview.status, preview.body)
	}
	p := draftFlowObject(t, preview.body)
	orgCandidateKeys(t, p, "user", "vacancies", "other_tramos")
	editJSONEqual(t, p["user"], map[string]any{"id": leaverID.String(), "full_name": "Draft Flow"})
	want := []any{map[string]any{"draft_id": responsible, "title": "Responsible", "lifecycle": "draft", "hand_over": "responsible", "team": []any{map[string]any{"user_id": targetID.String(), "name": "Draft Flow", "function": "collaborator"}}}, map[string]any{"draft_id": shared, "title": "Shared", "lifecycle": "draft", "hand_over": "last_member", "team": []any{}}}
	editJSONEqual(t, p["vacancies"], want)
	if p["other_tramos"] != float64(1) {
		t.Fatal(p)
	}
	before := offboardHistory(t, h, owner, responsible)
	del := h.do(t, "DELETE", path, "", owner.token, nil)
	draftFlowAssertCatalogError(t, del, 409, "member_is_responsible")
	editJSONEqual(t, draftFlowObject(t, del.body)["data"].(map[string]any)["vacancies"], want)
	editJSONEqual(t, offboardHistory(t, h, owner, responsible), before)
	draftFlowAssertCatalogError(t, h.do(t, "GET", path+"/offboard-preview", "", leaver.token, nil), 403, "forbidden")
	body := fmt.Sprintf(`{"default_to_user_id":%q,"reassignments":[{"draft_id":%q,"to_user_id":%q}]}`, ownerID, responsible, targetID)
	headers := map[string]string{"Idempotency-Key": uuid.NewString()}
	r := h.do(t, "POST", path+"/offboard", body, owner.token, headers)
	if r.status != 200 {
		t.Fatalf("offboard %d %s", r.status, r.body)
	}
	out := draftFlowObject(t, r.body)
	orgCandidateKeys(t, out, "user_id", "handed_over", "ended_assignment_ids")
	if out["user_id"] != leaverID.String() {
		t.Fatal(out)
	}
	handovers := out["handed_over"].([]any)
	if len(handovers) != 2 {
		t.Fatal(out)
	}
	reassignment := handovers[0].(map[string]any)["reassignment_id"]
	editJSONEqual(t, handovers, []any{map[string]any{"draft_id": responsible, "hand_over": "responsible", "to_user_id": targetID.String(), "reassignment_id": reassignment}, map[string]any{"draft_id": shared, "hand_over": "last_member", "to_user_id": ownerID.String(), "reassignment_id": nil}})
	// Responsible removal follows the existing reassignment semantics.
	tr := offboardTramo(t, h, owner, responsible, leaverID)
	if tr["end_cause"] != "reassigned" || tr["ended_at"] == nil {
		t.Fatal(tr)
	}
	ended := []any{}
	for _, id := range []string{shared, other} {
		tr := offboardTramo(t, h, owner, id, leaverID)
		if tr["end_cause"] != "membership_ended" {
			t.Fatal(tr)
		}
		if id == other && tr["closing_deadline"] != "2027-01-12" {
			t.Fatal(tr)
		}
		periods := tr["functions"].([]any)
		fn := periods[len(periods)-1].(map[string]any)
		if fn["end_cause"] != "tramo_ended" || fn["ended_at"] != tr["ended_at"] {
			t.Fatal(tr)
		}
		ended = append(ended, tr["assignment_id"])
		offboardAssertAudit(t, h, ownerID, "VacancyAssignmentEndedByMembership", "vacancy", id, map[string]any{"company_id": company.companyID.String(), "assignment_id": tr["assignment_id"], "user_id": leaverID.String()})
	}
	editJSONEqual(t, out["ended_assignment_ids"], ended)
	offboardAssertAudit(t, h, ownerID, "CompanyMemberOffboarded", "company_member", membership, map[string]any{"company_id": company.companyID.String(), "user_id": leaverID.String(), "reassignment_ids": []any{reassignment}, "ended_assignment_ids": ended, "talent_base_viewer_removed": false})
	target := offboardTramo(t, h, owner, responsible, targetID)
	offboardAssertAudit(t, h, ownerID, "VacancyResponsibleReassigned", "vacancy", responsible, map[string]any{"company_id": company.companyID.String(), "reassignment_id": reassignment, "from_user_id": leaverID.String(), "to_user_id": targetID.String(), "from_assignment_id": tr["assignment_id"], "to_assignment_id": target["assignment_id"], "reason": "recruiter_departure", "previous_responsible": "remove"})
	added := offboardTramo(t, h, owner, shared, ownerID)
	if added["start_cause"] != "added" || added["started_by"].(map[string]any)["id"] != ownerID.String() {
		t.Fatal(added)
	}
	offboardAssertAudit(t, h, ownerID, "VacancyTeamMemberAdded", "vacancy", shared, map[string]any{"company_id": company.companyID.String(), "assignment_id": added["assignment_id"], "user_id": ownerID.String(), "function": "member", "recruiter_deadline": ""})
	after := offboardHistory(t, h, owner, responsible)
	replay := h.do(t, "POST", path+"/offboard", body, owner.token, headers)
	if replay.status != 200 || string(replay.body) != string(r.body) || replay.header.Get("Idempotency-Replayed") != "true" {
		t.Fatal(replay.status, string(replay.body))
	}
	editJSONEqual(t, offboardHistory(t, h, owner, responsible), after)
	for _, route := range []string{draftFlowV2Path + "/" + responsible, draftFlowV2Path + "/" + other + "/team", "/me/company/members"} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", route, "", leaver.token, nil), 403, "forbidden")
	}
}

func TestOffboardValidationHTTP(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	uid, us := company.addUser(t, "recruiter")
	user := h.actor(t, uid, us)
	target, _ := company.addUser(t, "recruiter")
	id := draftListFlowCreate(t, h, user, `{"fields":{}}`)
	path := offboardPath(t, h, uid)
	foreign := draftFlowNewCompany(t, h.pool, "active")
	foreignID, _ := foreign.addUser(t, "owner")
	for _, tc := range []struct {
		name, body, code string
		status           int
	}{
		{"unresolved", `{}`, "offboard_unresolved_vacancies", 422},
		{"self", fmt.Sprintf(`{"default_to_user_id":%q}`, uid), "not_company_member", 422},
		{"unknown", fmt.Sprintf(`{"default_to_user_id":%q}`, uuid.New()), "not_company_member", 422},
		{"foreign", fmt.Sprintf(`{"default_to_user_id":%q}`, foreignID), "not_company_member", 422},
		{"unrelated", fmt.Sprintf(`{"default_to_user_id":%q,"reassignments":[{"draft_id":%q,"to_user_id":%q}]}`, target, uuid.New(), target), "offboard_reassignment_not_applicable", 422},
		{"strict", `{"unknown":true}`, "invalid_request", 400}, {"null", `null`, "invalid_request", 400}, {"duplicates", `{"reassignments":[],"reassignments":[]}`, "invalid_request", 400},
		{"duplicate vacancy", fmt.Sprintf(`{"reassignments":[{"draft_id":%q,"to_user_id":%q},{"draft_id":%q,"to_user_id":%q}]}`, id, target, id, target), "invalid_request", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := offboardHistory(t, h, owner, id)
			members := h.do(t, "GET", "/me/company/members", "", owner.token, nil)
			r := h.do(t, "POST", path+"/offboard", tc.body, owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
			draftFlowAssertCatalogError(t, r, tc.status, tc.code)
			editJSONEqual(t, offboardHistory(t, h, owner, id), before)
			if string(h.do(t, "GET", "/me/company/members", "", owner.token, nil).body) != string(members.body) {
				t.Fatal("membership changed")
			}
			if tc.name == "unresolved" {
				p := h.do(t, "GET", path+"/offboard-preview", "", owner.token, nil)
				editJSONEqual(t, draftFlowObject(t, r.body)["data"].(map[string]any)["vacancies"], draftFlowObject(t, p.body)["vacancies"])
			}
		})
	}
	for _, p := range []string{"/me/company/members/" + uuid.NewString(), offboardPath(t, h, foreignID)} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", p+"/offboard-preview", "", owner.token, nil), 404, "not_found")
	}
	for _, headers := range []map[string]string{nil, {"Idempotency-Key": "bad"}} {
		code := "idempotency_key_required"
		if headers != nil {
			code = "invalid_idempotency_key"
		}
		draftFlowAssertCatalogError(t, h.do(t, "POST", path+"/offboard", `{}`, owner.token, headers), 400, code)
	}
}

func TestOffboardDeleteFinishedAndReopenHTTP(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	uid, us := company.addUser(t, "recruiter")
	user := h.actor(t, uid, us)
	id := publicationFlowReady(t, h, user)
	publicFlowPublish(t, h, id, user)
	base := draftFlowV2Path + "/" + id
	lc := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
	closed := h.do(t, "POST", base+"/lifecycle/close", `{"process":"finish","reason":"cancelled","reason_note":null}`, owner.token, map[string]string{"If-Match": lc.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if closed.status != 200 {
		t.Fatal(closed.status, string(closed.body))
	}
	path := offboardPath(t, h, uid)
	p := h.do(t, "GET", path+"/offboard-preview", "", owner.token, nil)
	if p.status != 200 {
		t.Fatal(p.status, string(p.body))
	}
	obj := draftFlowObject(t, p.body)
	if len(obj["vacancies"].([]any)) != 0 || obj["other_tramos"] != float64(1) {
		t.Fatal(obj)
	}
	del := h.do(t, "DELETE", path, "", owner.token, nil)
	if del.status != 204 || len(del.body) != 0 {
		t.Fatal(del.status, string(del.body))
	}
	tr := offboardTramo(t, h, owner, id, uid)
	if tr["end_cause"] != "membership_ended" {
		t.Fatal(tr)
	}
	before := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
	r := h.do(t, "POST", base+"/lifecycle/reopen", `{}`, owner.token, map[string]string{"If-Match": before.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	draftFlowAssertCatalogError(t, r, 409, "responsible_required")
	if string(h.do(t, "GET", base+"/lifecycle", "", owner.token, nil).body) != string(before.body) {
		t.Fatal("reopen changed state")
	}
}

func TestOffboardAuditRollbackHTTP(t *testing.T) {
	for _, event := range []string{"VacancyResponsibleReassigned", "VacancyAssignmentEndedByMembership", "CompanyMemberOffboarded", "VacancyTeamMemberAdded"} {
		t.Run(event, func(t *testing.T) {
			fault := &teamFailAudit{event: event}
			h := newDraftFlowHarnessWithAudit(t, fault)
			company, oid, sub := draftFlowNewPrincipal(t, h.pool, "active")
			owner := h.actor(t, oid, sub)
			uid, us := company.addUser(t, "recruiter")
			user := h.actor(t, uid, us)
			id := draftListFlowCreate(t, h, user, `{"fields":{}}`)
			other := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
			offboardTeamWrite(t, h, owner, other, "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, uid))
			if event == "VacancyTeamMemberAdded" {
				offboardTeamWrite(t, h, owner, id, "PUT", "/mode", `{"mode":"shared"}`)
			}
			path := offboardPath(t, h, uid)
			before := offboardHistory(t, h, owner, id)
			otherBefore := offboardHistory(t, h, owner, other)
			members := h.do(t, "GET", "/me/company/members", "", owner.token, nil)
			body := fmt.Sprintf(`{"default_to_user_id":%q}`, oid)
			headers := map[string]string{"Idempotency-Key": uuid.NewString()}
			fault.enabled.Store(true)
			r := h.do(t, "POST", path+"/offboard", body, owner.token, headers)
			draftFlowAssertCatalogError(t, r, 500, "internal_error")
			editJSONEqual(t, offboardHistory(t, h, owner, id), before)
			editJSONEqual(t, offboardHistory(t, h, owner, other), otherBefore)
			if string(h.do(t, "GET", "/me/company/members", "", owner.token, nil).body) != string(members.body) {
				t.Fatal("membership not rolled back")
			}
			fault.enabled.Store(false)
			r = h.do(t, "POST", path+"/offboard", body, owner.token, headers)
			if r.status != 200 {
				t.Fatal(r.status, string(r.body))
			}
		})
	}
}

// TestOffboardResponsibleUsesReassignmentOnly pins the clarified contract
// (df6a42f7): a handed-over responsible tramo ends `reassigned`, is reported
// through handed_over only, and emits no membership-end event.
func TestOffboardResponsibleUsesReassignmentOnly(t *testing.T) {
	h := newDraftFlowHarness(t)
	c, oid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, oid, sub)
	uid, us := c.addUser(t, "recruiter")
	user := h.actor(t, uid, us)
	id := draftListFlowCreate(t, h, user, `{"fields":{}}`)

	r := h.do(t, "POST", offboardPath(t, h, uid)+"/offboard",
		fmt.Sprintf(`{"default_to_user_id":%q}`, oid),
		owner.token,
		map[string]string{"Idempotency-Key": uuid.NewString()})
	if r.status != 200 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	tr := offboardTramo(t, h, owner, id, uid)
	if tr["end_cause"] != "reassigned" {
		t.Fatal(tr)
	}
	out := draftFlowObject(t, r.body)
	editJSONEqual(t, out["ended_assignment_ids"], []any{})
	if len(out["handed_over"].([]any)) != 1 {
		t.Fatal(out)
	}

	var count int
	err := h.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM audit_events
		WHERE entity_id=$1
		  AND event_type='VacancyAssignmentEndedByMembership'`,
		id).Scan(&count)
	if err != nil || count != 0 {
		t.Fatalf("membership-end events=%d err=%v", count, err)
	}
}
