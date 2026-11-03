//go:build integration

package main

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"testing"
)

func teamWriteState(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var raw []byte
	err := h.pool.QueryRow(context.Background(), `SELECT jsonb_build_object(
 'team',(SELECT to_jsonb(t) FROM vacancy_teams t WHERE draft_id=$1),
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vacancy_assignments a WHERE draft_id=$1),
 'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM vacancy_assignment_functions f WHERE draft_id=$1),
 'reassignments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM vacancy_reassignments r WHERE draft_id=$1),
 'modes',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM vacancy_team_mode_changes m WHERE draft_id=$1),
 'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM job_draft_idempotency i WHERE company_id=(SELECT company_id FROM job_drafts WHERE id=$1)), 
 'audits',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM audit_events e WHERE entity_id=$1))`, id).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestTeamWritePermissionsAndPreconditions(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	responsibleID, responsibleSub := company.addUser(t, "recruiter")
	responsible := h.actor(t, responsibleID, responsibleSub)
	collaboratorID, collaboratorSub := company.addUser(t, "recruiter")
	collaborator := h.actor(t, collaboratorID, collaboratorSub)
	targetID, _ := company.addUser(t, "recruiter")
	outsiderID, outsiderSub := company.addUser(t, "recruiter")
	outsider := h.actor(t, outsiderID, outsiderSub)
	for _, mode := range []string{"with_responsible", "shared"} {
		for _, role := range []string{"owner", "responsible", "collaborator", "outsider"} {
			for _, action := range []string{"add", "remove", "leave", "deadline", "reassign", "mode"} {
				t.Run(mode+"/"+role+"/"+action, func(t *testing.T) {
					id := draftListFlowCreate(t, h, responsible, `{"fields":{}}`)
					base := draftFlowV2Path + "/" + id + "/team"
					tag := h.do(t, "GET", base, "", owner.token, nil).header.Get("ETag")
					add := h.do(t, "POST", base+"/members", fmt.Sprintf(`{"user_id":%q}`, collaboratorID), owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
					if add.status != 200 {
						t.Fatal(add.status, string(add.body))
					}
					tag = add.header.Get("ETag")
					if mode == "shared" {
						r := h.do(t, "PUT", base+"/mode", `{"mode":"shared"}`, owner.token, map[string]string{"If-Match": tag})
						if r.status != 200 {
							t.Fatal(r.status, string(r.body))
						}
						tag = r.header.Get("ETag")
					}
					actor := owner
					switch role {
					case "responsible":
						actor = responsible
					case "collaborator":
						actor = collaborator
					case "outsider":
						actor = outsider
					}
					method, path, body := "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, targetID)
					switch action {
					case "remove":
						path = "/members/" + collaboratorID.String() + "/remove"
						body = "{}"
					case "leave":
						path = "/leave"
						body = "{}"
					case "deadline":
						method = "PATCH"
						path = "/members/" + collaboratorID.String()
						body = `{"recruiter_deadline":null}`
					case "reassign":
						path = "/reassign-responsible"
						body = fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, targetID)
					case "mode":
						method = "PUT"
						path = "/mode"
						body = `{"mode":"shared"}`
						if mode == "shared" {
							body = fmt.Sprintf(`{"mode":"with_responsible","responsible_user_id":%q}`, responsibleID)
						}
					}
					// Every route uses the same precondition contract, before action permission.
					if role == "owner" {
						for _, tc := range []struct {
							tag     string
							present bool
							status  int
							code    string
						}{{"", false, 428, "precondition_required"}, {"bad", true, 400, "invalid_request"}, {`"stale"`, true, 412, "team_version_conflict"}} {
							headers := map[string]string{"Idempotency-Key": uuid.NewString()}
							if tc.present {
								headers["If-Match"] = tc.tag
							}
							before := teamWriteState(t, h, id)
							r := h.do(t, method, base+path, body, actor.token, headers)
							draftFlowAssertCatalogError(t, r, tc.status, tc.code)
							if teamWriteState(t, h, id) != before {
								t.Fatal("precondition rejection mutated state")
							}
						}
					}
					status, code := 200, ""
					if role == "outsider" {
						status = 404
						code = "not_found"
					} else {
						switch action {
						case "add", "deadline":
							if role == "collaborator" && mode == "with_responsible" {
								status = 403
								code = "team_action_forbidden"
							}
						case "remove":
							if role != "owner" && !(role == "responsible" && mode == "with_responsible") {
								status = 403
								code = "team_action_forbidden"
							}
						case "leave":
							if role == "owner" {
								status = 403
								code = "team_action_forbidden"
							} else if role == "responsible" && mode == "with_responsible" {
								status = 409
								code = "responsible_cannot_leave"
							}
						case "reassign":
							if role != "owner" {
								status = 403
								code = "team_action_forbidden"
							} else if mode == "shared" {
								status = 409
								code = "team_mode_mismatch"
							}
						case "mode":
							if role != "owner" {
								status = 403
								code = "team_action_forbidden"
							}
						}
					}
					before := teamWriteState(t, h, id)
					headers := map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()}
					r := h.do(t, method, base+path, body, actor.token, headers)
					if status != 200 {
						draftFlowAssertCatalogError(t, r, status, code)
						if teamWriteState(t, h, id) != before {
							t.Fatal("permission rejection mutated state")
						}
						return
					}
					if r.status != 200 || r.header.Get("ETag") == "" || r.header.Get("ETag") == tag {
						t.Fatal(r.status, string(r.body))
					}
					if action != "leave" {
						fresh := h.do(t, "GET", base, "", actor.token, nil)
						if fresh.status != 200 || string(fresh.body) != string(r.body) || fresh.header.Get("ETag") != r.header.Get("ETag") {
							t.Fatal("not full team resource", fresh.status, string(fresh.body), string(r.body))
						}
					}
					if method == "POST" && action != "leave" {
						frozen := teamWriteState(t, h, id)
						replay := h.do(t, method, base+path, body, actor.token, headers)
						if replay.status != 200 || string(replay.body) != string(r.body) || replay.header.Get("ETag") != r.header.Get("ETag") || replay.header.Get("Idempotency-Replayed") != "true" || teamWriteState(t, h, id) != frozen {
							t.Fatal("replay changed state", replay.status, string(replay.body))
						}
					}
				})
			}
		}
	}
}
