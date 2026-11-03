//go:build integration

package main

import (
	"bytes"
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestTeamExplicitInputsAndLeaveReplay(t *testing.T) {
	for _, scenario := range []string{"leave replay", "existing target deadline", "shared responsible"} {
		t.Run(scenario, func(t *testing.T) {
			h := newDraftFlowHarness(t)
			company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
			owner := h.actor(t, ownerID, sub)
			peerID, peerSub := company.addUser(t, "recruiter")
			peer := h.actor(t, peerID, peerSub)
			id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
			base := draftFlowV2Path + "/" + id + "/team"
			tag := h.do(t, "GET", base, "", owner.token, nil).header.Get("ETag")
			added := h.do(t, "POST", base+"/members", fmt.Sprintf(`{"user_id":%q}`, peerID), owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
			if added.status != 200 {
				t.Fatal(added.status, string(added.body))
			}
			tag = added.header.Get("ETag")
			reject := func(method, path, body, token string, headers map[string]string, status int, code string) {
				t.Helper()
				before := teamWriteState(t, h, id)
				r := h.do(t, method, base+path, body, token, headers)
				draftFlowAssertCatalogError(t, r, status, code)
				if r.header.Get("ETag") != "" || r.header.Get("Idempotency-Replayed") == "true" || teamWriteState(t, h, id) != before {
					t.Fatal("rejection changed state or exposed frozen result", r.status, string(r.body))
				}
			}
			switch scenario {
			case "leave replay":
				headers := map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()}
				first := h.do(t, "POST", base+"/leave", "{}", peer.token, headers)
				if first.status != 200 || first.header.Get("ETag") == "" || first.header.Get("ETag") == tag || first.header.Get("Idempotency-Replayed") != "false" {
					t.Fatal(first.status, string(first.body))
				}
				before := teamWriteState(t, h, id)
				replay := h.do(t, "POST", base+"/leave", "{}", peer.token, headers)
				if replay.status != 200 || !bytes.Equal(replay.body, first.body) || replay.header.Get("ETag") != first.header.Get("ETag") || replay.header.Get("Idempotency-Replayed") != "true" || teamWriteState(t, h, id) != before {
					t.Errorf("leave replay: %d %s; want frozen 200", replay.status, replay.body)
				}
				reject("POST", "/leave", "{}", peer.token, map[string]string{"If-Match": first.header.Get("ETag"), "Idempotency-Key": uuid.NewString()}, 404, "team_access_ended")
				// A frozen leave never grants access to a different vacancy or write action.
				otherID := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
				other := h.do(t, "POST", draftFlowV2Path+"/"+otherID+"/team/leave", "{}", peer.token, headers)
				draftFlowAssertCatalogError(t, other, 404, "not_found")
				reject("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, ownerID), peer.token, headers, 404, "team_access_ended")
				var membership uuid.UUID
				if err := h.pool.QueryRow(context.Background(), `SELECT id FROM company_members WHERE company_id=$1 AND user_id=$2`, company.companyID, peerID).Scan(&membership); err != nil {
					t.Fatal(err)
				}
				// Fixture offboarding: this harness does not compose the company member handler.
				if _, err := h.pool.Exec(context.Background(), `DELETE FROM company_members WHERE id=$1`, membership); err != nil {
					t.Fatal(err)
				}
				before = teamWriteState(t, h, id)
				denied := h.do(t, "POST", base+"/leave", "{}", peer.token, headers)
				draftFlowAssertCatalogError(t, denied, 403, "forbidden")
				if bytes.Equal(denied.body, first.body) || denied.header.Get("ETag") != "" || denied.header.Get("Idempotency-Replayed") == "true" || teamWriteState(t, h, id) != before {
					t.Fatal("removed company member received frozen response or mutated state")
				}
			case "existing target deadline":
				reject("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload","recruiter_deadline":"2027-03-12"}`, peerID), owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()}, 422, "recruiter_deadline_not_applicable")
				// Explicit null remains compatible with reassigning an existing tramo.
				success := h.do(t, "POST", base+"/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload","recruiter_deadline":null}`, peerID), owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
				if success.status != 200 || success.header.Get("ETag") == tag {
					t.Fatal(success.status, string(success.body))
				}
			case "shared responsible":
				for _, value := range []string{fmt.Sprintf("%q", ownerID), "null"} {
					reject("PUT", "/mode", `{"mode":"shared","responsible_user_id":`+value+`}`, owner.token, map[string]string{"If-Match": tag}, 422, "responsible_not_applicable")
				}
				success := h.do(t, "PUT", base+"/mode", `{"mode":"shared"}`, owner.token, map[string]string{"If-Match": tag})
				if success.status != 200 || success.header.Get("ETag") == tag {
					t.Fatal(success.status, string(success.body))
				}
			}
		})
	}
}

func TestTeamConcurrentModeChangeAndMembershipWrite(t *testing.T) {
	for _, action := range []string{"add", "remove"} {
		t.Run(action, func(t *testing.T) {
			h := newDraftFlowHarness(t)
			company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
			owner := h.actor(t, ownerID, sub)
			peerID, _ := company.addUser(t, "recruiter")
			id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
			base := draftFlowV2Path + "/" + id + "/team"
			tag := h.do(t, "GET", base, "", owner.token, nil).header.Get("ETag")
			if action == "remove" {
				added := h.do(t, "POST", base+"/members", fmt.Sprintf(`{"user_id":%q}`, peerID), owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
				if added.status != 200 {
					t.Fatal(added.status, string(added.body))
				}
				tag = added.header.Get("ETag")
			}
			type counts struct{ version, audits, functions int64 }
			readCounts := func() counts {
				t.Helper()
				var c counts
				if err := h.pool.QueryRow(context.Background(), `SELECT version,(SELECT count(*) FROM audit_events WHERE entity_id=$1),(SELECT count(*) FROM vacancy_assignment_functions WHERE draft_id=$1) FROM vacancy_teams WHERE draft_id=$1`, id).Scan(&c.version, &c.audits, &c.functions); err != nil {
					t.Fatal(err)
				}
				return c
			}
			before := readCounts()
			start := make(chan struct{})
			out := make(chan draftFlowCall, 2)
			go func() {
				<-start
				r, err := h.roundTrip("PUT", base+"/mode", `{"mode":"shared"}`, owner.token, map[string]string{"If-Match": tag})
				out <- draftFlowCall{r, err}
			}()
			go func() {
				<-start
				path, body := base+"/members", fmt.Sprintf(`{"user_id":%q}`, peerID)
				if action == "remove" {
					path += "/" + peerID.String() + "/remove"
					body = "{}"
				}
				r, err := h.roundTrip("POST", path, body, owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
				out <- draftFlowCall{r, err}
			}()
			close(start)
			success, conflict := 0, 0
			for i := 0; i < 2; i++ {
				call := <-out
				if call.err != nil {
					t.Fatal(call.err)
				}
				switch call.resp.status {
				case 200:
					success++
				case 412:
					conflict++
					draftFlowAssertCatalogError(t, call.resp, 412, "team_version_conflict")
				default:
					t.Fatal(call.resp.status, string(call.resp.body))
				}
			}
			after := readCounts()
			if success != 1 || conflict != 1 || after.version != before.version+1 || after.audits != before.audits+1 {
				t.Fatal(success, conflict, before, after)
			}
			fresh := h.do(t, "GET", base, "", owner.token, nil)
			if fresh.status != 200 || fresh.header.Get("ETag") == tag {
				t.Fatal(fresh.status, string(fresh.body))
			}
			team := draftFlowObject(t, fresh.body)
			members := team["members"].([]any)
			responsibles := 0
			for _, raw := range members {
				fn := raw.(map[string]any)["function"]
				if fn == "responsible" {
					responsibles++
				}
				if team["mode"] == "shared" && fn != "member" {
					t.Fatal(team)
				}
			}
			if team["mode"] == "with_responsible" && responsibles != 1 || team["mode"] == "shared" && responsibles != 0 {
				t.Fatal(team)
			}
			var active, open int64
			if err := h.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM vacancy_assignments WHERE draft_id=$1 AND ended_at IS NULL),(SELECT count(*) FROM vacancy_assignment_functions WHERE draft_id=$1 AND ended_at IS NULL)`, id).Scan(&active, &open); err != nil || active != open || active != int64(len(members)) {
				t.Fatal(active, open, err)
			}
		})
	}
}
