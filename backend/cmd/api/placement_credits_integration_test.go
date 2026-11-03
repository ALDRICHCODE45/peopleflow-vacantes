//go:build integration

package main

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestPlacementCreditsHTTP(t *testing.T) {
	for _, mode := range []string{"with_responsible", "shared"} {
		t.Run(mode, func(t *testing.T) {
			f := newCandidateCVFixture(t, "manual")
			base, path := boardCorrectionPaths(t, f)
			vacancy := uuid.MustParse(base[len(draftFlowV2Path)+1:])
			cfg := pipelineconfig.Defaults(vacancy)
			teamWrite := func(method, suffix, body string) {
				t.Helper()
				team := f.h.do(t, "GET", base+"/team", "", f.owner.token, nil)
				r := f.h.do(t, method, base+"/team"+suffix, body, f.owner.token, map[string]string{"If-Match": team.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
				if r.status != 200 {
					t.Fatalf("team %d %s", r.status, r.body)
				}
			}
			teamWrite("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, f.recruiter.userID))
			// The owner moves the candidate but no longer holds a tramo.
			teamWrite("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload","previous_responsible":"remove"}`, f.recruiter.userID))
			peerID, _ := f.company.addUser(t, "recruiter")
			endedID, _ := f.company.addUser(t, "recruiter")
			teamWrite("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, peerID))
			teamWrite("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, endedID))
			teamWrite("POST", "/members/"+endedID.String()+"/remove", `{}`)
			if mode == "shared" {
				teamWrite("PUT", "/mode", `{"mode":"shared"}`)
			}
			detail := func() map[string]any {
				t.Helper()
				return draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
			}
			initial := detail()
			if initial["placement_credit"] != nil || initial["can"] == nil {
				t.Fatal("missing credit detail shape", initial)
			}
			mutate := func(suffix, body string) {
				t.Helper()
				d := detail()
				r := f.h.do(t, "POST", path+suffix, body, f.owner.token, map[string]string{"If-Match": d["etag"].(string)})
				if r.status != 200 {
					t.Fatalf("%s %d %s", suffix, r.status, r.body)
				}
			}
			for i := 1; i < len(cfg.Stages); i++ {
				mutate("/moves", fmt.Sprintf(`{"to_stage_id":%q}`, cfg.Stages[i].ID))
			}
			credit := detail()["placement_credit"].(map[string]any)
			orgCandidateKeys(t, credit, "id", "status", "team_mode", "hired_at", "hired_by", "exit_reason", "recipients")
			if credit["status"] != "active" || credit["team_mode"] != mode || credit["exit_reason"] != nil {
				t.Fatal(credit)
			}
			recipients := credit["recipients"].([]any)
			kind := "direct"
			if mode == "shared" {
				kind = "shared"
			}
			if len(recipients) != 2 {
				t.Fatal(recipients)
			}
			expectedRecipients := []any{}
			for _, raw := range recipients {
				r := raw.(map[string]any)
				want := kind
				if r["user_id"] == peerID.String() {
					want = "participant"
					if mode == "shared" {
						want = "shared"
					}
				} else if r["user_id"] != f.recruiter.userID.String() {
					t.Fatal("non-active recipient", r)
				}
				if r["kind"] != want || r["name"] != "Draft Flow" {
					t.Fatal(r)
				}
				orgCandidateKeys(t, r, "user_id", "name", "kind")
				expectedRecipients = append(expectedRecipients, map[string]any{"user_id": r["user_id"], "kind": want})
			}
			if credit["hired_by"].(map[string]any)["id"] != f.owner.userID.String() {
				t.Fatal(credit)
			}
			assertCreditAudit(t, f, "VacancyPlacementCredited", map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": vacancy.String(), "credit_id": credit["id"], "team_mode": mode, "hired_by": f.owner.userID.String(), "recipients": expectedRecipients})
			cid := credit["id"].(string)
			corrections := path + "/placement-credits/" + cid
			readList := func() draftFlowResponse {
				t.Helper()
				r := f.h.do(t, "GET", path+"/placement-credits", "", f.owner.token, nil)
				if r.status != 200 {
					t.Fatal(r.status, string(r.body))
				}
				return r
			}
			list := readList()
			orgCandidateKeys(t, draftFlowObject(t, list.body), "items")
			editJSONEqual(t, draftFlowObject(t, list.body)["items"], []any{credit})
			// Frozen mode/recipients survive team changes.
			otherMode := "shared"
			body := `{"mode":"shared"}`
			if mode == "shared" {
				otherMode = "with_responsible"
				body = fmt.Sprintf(`{"mode":%q,"responsible_user_id":%q}`, otherMode, f.recruiter.userID)
			}
			teamWrite("PUT", "/mode", body)
			editJSONEqual(t, detail()["placement_credit"], credit)
			reject := func(suffix, body, token string, headers map[string]string, status int, code string) {
				t.Helper()
				before := readList()
				d := boardCorrectionRead(t, f, path, f.owner)
				stored := placementCreditState(t, f, vacancy)
				r := f.h.do(t, "POST", corrections+suffix, body, token, headers)
				draftFlowAssertCatalogError(t, r, status, code)
				if !bytes.Equal(before.body, readList().body) || !bytes.Equal(d.body, boardCorrectionRead(t, f, path, f.owner).body) || placementCreditState(t, f, vacancy) != stored {
					t.Fatal("rejection changed state/audit/counters")
				}
			}
			key := func() map[string]string { return map[string]string{"Idempotency-Key": uuid.NewString()} }
			reject("/void", "{}", f.recruiter.token, key(), 403, "team_action_forbidden")
			reject("/void", "{}", f.foreign.token, key(), 404, "not_found")
			reject("/void", "{}", f.owner.token, nil, 400, "idempotency_key_required")
			reject("/void", "{}", f.owner.token, map[string]string{"Idempotency-Key": "bad"}, 400, "invalid_idempotency_key")
			for _, body := range []string{`null`, `[]`, `{"unknown":true}`, `{"a":1,"a":2}`} {
				reject("/void", body, f.owner.token, key(), 400, "invalid_request")
			}
			reject("/restore", "{}", f.owner.token, key(), 409, "credit_status_unchanged")
			frozenHeaders := key()
			correction := func(suffix string, headers map[string]string) draftFlowResponse {
				t.Helper()
				r := f.h.do(t, "POST", corrections+suffix, "{}", f.owner.token, headers)
				if r.status != 200 {
					t.Fatal(r.status, string(r.body))
				}
				if r.header.Get("ETag") != "" {
					t.Fatal("credit has no ETag")
				}
				return r
			}
			void := correction("/void", frozenHeaders)
			assertCreditAudit(t, f, "VacancyPlacementCreditChanged", map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": vacancy.String(), "credit_id": cid, "from_status": "active", "to_status": "voided", "cause": "owner_void"})
			if draftFlowObject(t, void.body)["status"] != "voided" || detail()["can"].(map[string]any)["restore_credit"] != true {
				t.Fatal(string(void.body))
			}
			reject("/void", "{}", f.owner.token, key(), 409, "credit_status_unchanged")
			correction("/restore", key())
			assertCreditAudit(t, f, "VacancyPlacementCreditChanged", map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": vacancy.String(), "credit_id": cid, "from_status": "voided", "to_status": "active", "cause": "owner_restore"})
			replay := correction("/void", frozenHeaders)
			if !bytes.Equal(void.body, replay.body) || detail()["placement_credit"].(map[string]any)["status"] != "active" {
				t.Fatal("replay was not frozen")
			}
			for _, reason := range []string{"moved_by_mistake", "candidate_left"} {
				mutate("/discard", fmt.Sprintf(`{"reason":{"group":"recruiter","key":"profile_mismatch"},"placement_exit_reason":%q}`, reason))
				want := "voided"
				if reason == "candidate_left" {
					want = "did_not_hold"
				}
				c := detail()["placement_credit"].(map[string]any)
				if c["status"] != want || c["exit_reason"] != reason {
					t.Fatal(c)
				}
				assertCreditAudit(t, f, "VacancyPlacementCreditChanged", map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": vacancy.String(), "credit_id": cid, "from_status": "active", "to_status": want, "cause": "exit:" + reason})
				if want == "did_not_hold" {
					correction("/void", key())
				}
				if got := draftFlowObject(t, correction("/restore", key()).body)["status"]; got != "did_not_hold" {
					t.Fatal(got)
				}
				mutate("/recover", `{"confirm_placement_reentry":true}`)
				cid = detail()["placement_credit"].(map[string]any)["id"].(string)
				corrections = path + "/placement-credits/" + cid
			}
			all := draftFlowObject(t, readList().body)["items"].([]any)
			if len(all) != 3 || all[0].(map[string]any)["id"] != cid {
				t.Fatal("recovery must create another latest credit")
			}
			for i := 1; i < len(all); i++ {
				if all[i-1].(map[string]any)["hired_at"].(string) <= all[i].(map[string]any)["hired_at"].(string) {
					t.Fatal("list is not newest first")
				}
			}
			// IDs must be scoped to both participation and vacancy, even for the owner.
			original := corrections
			corrections = strings.Replace(corrections, cid, uuid.NewString(), 1)
			reject("/void", "{}", f.owner.token, key(), 404, "not_found")
			corrections = strings.Replace(original, f.pid.String(), uuid.NewString(), 1)
			reject("/void", "{}", f.owner.token, key(), 404, "not_found")
			corrections = original
			if otherMode == "shared" {
				teamWrite("PUT", "/mode", fmt.Sprintf(`{"mode":"with_responsible","responsible_user_id":%q}`, f.recruiter.userID))
			}
			teamWrite("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, f.owner.userID))
			teamWrite("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, peerID))
			history := f.h.do(t, "GET", base+"/team/history", "", f.owner.token, nil)
			for _, raw := range draftFlowObject(t, history.body)["items"].([]any) {
				if r, ok := raw.(map[string]any)["reassignment"]; ok {
					snapshot := r.(map[string]any)["state_snapshot"].(map[string]any)
					if snapshot["placements"].(map[string]any)["credited"] != float64(3) || snapshot["placements"].(map[string]any)["current"] != float64(1) {
						t.Fatal(snapshot)
					}
					break
				}
			}
		})
	}
}
