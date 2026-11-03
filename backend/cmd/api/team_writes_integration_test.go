//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"reflect"
	"testing"
)

func TestTeamWritesHTTP(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	peerID, peerSub := company.addUser(t, "recruiter")
	peer := h.actor(t, peerID, peerSub)
	nextID, _ := company.addUser(t, "recruiter")
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id + "/team"
	get := func() draftFlowResponse { return h.do(t, "GET", base, "", owner.token, nil) }
	tag := get().header.Get("ETag")
	state := func() string { t.Helper(); return teamWriteState(t, h, id) }
	reject := func(method, path, body, token string, headers map[string]string, status int, code string) {
		t.Helper()
		before := state()
		r := h.do(t, method, base+path, body, token, headers)
		draftFlowAssertCatalogError(t, r, status, code)
		if state() != before {
			t.Fatal("rejected write changed state")
		}
	}
	headers := func() map[string]string {
		return map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()}
	}
	add := fmt.Sprintf(`{"user_id":%q}`, peerID)
	reject("POST", "/members", add, owner.token, map[string]string{"Idempotency-Key": uuid.NewString()}, 428, "precondition_required")
	reject("POST", "/members", add, owner.token, map[string]string{"If-Match": "bad", "Idempotency-Key": uuid.NewString()}, 400, "invalid_request")
	reject("POST", "/members", add, owner.token, map[string]string{"If-Match": `"stale"`, "Idempotency-Key": uuid.NewString()}, 412, "team_version_conflict")
	reject("POST", "/members", add, owner.token, map[string]string{"If-Match": tag}, 400, "idempotency_key_required")
	reject("POST", "/members", add, owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": "bad"}, 400, "invalid_idempotency_key")
	reject("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, uuid.New()), owner.token, headers(), 422, "not_company_member")
	write := func(method, path, body string, actor draftFlowActor) draftFlowResponse {
		t.Helper()
		r := h.do(t, method, base+path, body, actor.token, headers())
		if r.status != 200 || r.header.Get("ETag") == "" || r.header.Get("ETag") == tag {
			t.Fatalf("%s %s: %d %s", method, path, r.status, r.body)
		}
		tag = r.header.Get("ETag")
		return r
	}
	replayHeaders := headers()
	first := h.do(t, "POST", base+"/members", add, owner.token, replayHeaders)
	if first.status != 200 {
		t.Fatalf("add %d %s", first.status, first.body)
	}
	tag = first.header.Get("ETag")
	frozen := state()
	replay := h.do(t, "POST", base+"/members", add, owner.token, replayHeaders)
	if replay.status != 200 || string(replay.body) != string(first.body) || replay.header.Get("ETag") != tag || state() != frozen {
		t.Fatalf("replay %d %s", replay.status, replay.body)
	}
	reject("POST", "/members", add, owner.token, headers(), 409, "team_member_already_active")
	reject("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, nextID), peer.token, headers(), 403, "team_action_forbidden")
	reject("POST", "/members/"+ownerID.String()+"/remove", "{}", owner.token, headers(), 409, "use_reassign_responsible")
	reject("POST", "/members/"+nextID.String()+"/remove", "{}", owner.token, headers(), 404, "team_member_not_found")
	reject("POST", "/leave", "{}", owner.token, headers(), 409, "responsible_cannot_leave")
	write("PATCH", "/members/"+peerID.String(), `{"recruiter_deadline":"2027-02-01"}`, owner)
	beforeReplay := state()
	oldReplay := h.do(t, "POST", base+"/members", add, owner.token, replayHeaders)
	if oldReplay.status != 200 || string(oldReplay.body) != string(first.body) || oldReplay.header.Get("ETag") != first.header.Get("ETag") || state() != beforeReplay {
		t.Fatal("replay rebuilt response", oldReplay.status, string(oldReplay.body))
	}
	reject("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, nextID), owner.token, replayHeaders, 409, "idempotency_conflict")
	reject("PATCH", "/members/"+nextID.String(), `{"recruiter_deadline":null}`, owner.token, headers(), 404, "team_member_not_found")
	reject("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, uuid.New()), owner.token, headers(), 422, "not_company_member")
	reject("PATCH", "/members/"+peerID.String(), `{"recruiter_deadline":"2026-02-30"}`, owner.token, headers(), 400, "invalid_request")
	reject("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"other"}`, peerID), owner.token, headers(), 422, "reassignment_note_required")
	reject("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, ownerID), owner.token, headers(), 409, "reassign_target_is_responsible")
	write("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload","previous_responsible":"keep_as_collaborator"}`, peerID), owner)
	write("PUT", "/mode", `{"mode":"shared"}`, owner)
	reject("PUT", "/mode", `{"mode":"shared"}`, owner.token, headers(), 409, "team_mode_unchanged")
	reject("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, nextID), owner.token, headers(), 409, "team_mode_mismatch")
	reject("PUT", "/mode", fmt.Sprintf(`{"mode":"with_responsible","responsible_user_id":%q}`, nextID), owner.token, headers(), 422, "responsible_not_on_team")
	write("POST", "/leave", "{}", peer)
	draftFlowAssertCatalogError(t, h.do(t, "GET", base, "", peer.token, nil), 404, "team_access_ended")
	reject("POST", "/leave", "{}", owner.token, headers(), 409, "team_last_member")
	reject("POST", "/members/"+ownerID.String()+"/remove", "{}", owner.token, headers(), 409, "team_last_member")
	rejoined := write("POST", "/members", add, owner)
	write("POST", "/members/"+peerID.String()+"/remove", "{}", owner)
	write("PUT", "/mode", fmt.Sprintf(`{"mode":"with_responsible","responsible_user_id":%q}`, ownerID), owner)
	final := write("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"other","note":"private reason"}`, nextID), owner)
	history := h.do(t, "GET", base+"/history", "", owner.token, nil)
	if history.status != 200 {
		t.Fatal(string(history.body))
	}
	var timeline struct {
		Items []map[string]json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(history.body, &timeline); err != nil {
		t.Fatal(err)
	}
	if len(timeline.Items) != 8 {
		t.Fatalf("history items %d: %s", len(timeline.Items), history.body)
	}
	memberID := func(raw []byte, user uuid.UUID) string {
		t.Helper()
		for _, rawMember := range draftFlowObject(t, raw)["members"].([]any) {
			m := rawMember.(map[string]any)
			if m["user"].(map[string]any)["id"] == user.String() {
				return m["assignment_id"].(string)
			}
		}
		t.Fatal("missing member")
		return ""
	}
	ownerAssignment := memberID(first.body, ownerID)
	peerAssignment := memberID(first.body, peerID)
	rejoinedAssignment := memberID(rejoined.body, peerID)
	nextAssignment := memberID(final.body, nextID)
	withCompany := func(m map[string]string) map[string]string { m["company_id"] = company.companyID.String(); return m }
	expected := map[string][]map[string]string{
		"VacancyTeamMemberAdded":           {withCompany(map[string]string{"assignment_id": peerAssignment, "user_id": peerID.String(), "function": "collaborator", "recruiter_deadline": ""}), withCompany(map[string]string{"assignment_id": rejoinedAssignment, "user_id": peerID.String(), "function": "member", "recruiter_deadline": ""})},
		"VacancyTeamMemberRemoved":         {withCompany(map[string]string{"assignment_id": rejoinedAssignment, "user_id": peerID.String(), "function": "member"})},
		"VacancyTeamMemberLeft":            {withCompany(map[string]string{"assignment_id": peerAssignment, "user_id": peerID.String(), "function": "member"})},
		"VacancyTeamModeChanged":           {withCompany(map[string]string{"from_mode": "with_responsible", "to_mode": "shared", "responsible_user_id": ""}), withCompany(map[string]string{"from_mode": "shared", "to_mode": "with_responsible", "responsible_user_id": ownerID.String()})},
		"VacancyAssignmentDeadlineChanged": {withCompany(map[string]string{"assignment_id": peerAssignment, "user_id": peerID.String(), "previous": "", "new": "2027-02-01"})},
	}
	for _, raw := range timeline.Items {
		if r, ok := raw["reassignment"]; ok {
			v := draftFlowObject(t, r)
			to, assignment := peerID.String(), peerAssignment
			previous := "keep_as_collaborator"
			if v["reason"] == "other" {
				to = nextID.String()
				assignment = nextAssignment
				previous = "remove"
			}
			expected["VacancyResponsibleReassigned"] = append(expected["VacancyResponsibleReassigned"], withCompany(map[string]string{"reassignment_id": v["id"].(string), "from_user_id": ownerID.String(), "to_user_id": to, "from_assignment_id": ownerAssignment, "to_assignment_id": assignment, "reason": v["reason"].(string), "previous_responsible": previous}))
			s := v["state_snapshot"].(map[string]any)["tramo"].(map[string]any)
			if s["deadline_source"] != "none" || s["effective_deadline"] != nil || s["business_days_total"] != nil {
				t.Fatal(s)
			}
		}
		if r, ok := raw["tramo"]; ok {
			v := draftFlowObject(t, r)
			periods := v["functions"].([]any)
			for i, p := range periods {
				period := p.(map[string]any)
				if i > 0 && period["started_at"] != periods[i-1].(map[string]any)["ended_at"] {
					t.Fatal("function gap", v)
				}
				if i == len(periods)-1 && v["ended_at"] != nil && (period["ended_at"] != v["ended_at"] || period["end_cause"] != "tramo_ended") {
					t.Fatal(v)
				}
			}
			if v["assignment_id"] == peerAssignment && (v["closing_deadline"] != "2027-02-01" || v["end_cause"] != "left" || len(periods) != 3) {
				t.Fatal(v)
			}
		}
	}
	for event, want := range expected {
		rows, err := h.pool.Query(context.Background(), `SELECT actor_id,entity_type,metadata FROM audit_events WHERE entity_id=$1 AND event_type=$2`, id, event)
		if err != nil {
			t.Fatal(err)
		}
		var got []map[string]string
		for rows.Next() {
			var actor uuid.UUID
			var entity string
			var raw []byte
			if err := rows.Scan(&actor, &entity, &raw); err != nil {
				t.Fatal(err)
			}
			if entity != "vacancy" || actor != ownerID && event != "VacancyTeamMemberLeft" || event == "VacancyTeamMemberLeft" && actor != peerID {
				t.Fatal(event, actor, entity)
			}
			var m map[string]string
			if err := json.Unmarshal(raw, &m); err != nil {
				t.Fatal(err)
			}
			got = append(got, m)
		}
		rows.Close()
		if rows.Err() != nil {
			t.Fatal(rows.Err())
		}
		if len(got) != len(want) {
			t.Fatal(event, got, want)
		}
		for _, m := range got {
			found := false
			for _, w := range want {
				if reflect.DeepEqual(m, w) {
					found = true
				}
			}
			if !found {
				t.Fatal(event, m, want)
			}
		}
	}

}
