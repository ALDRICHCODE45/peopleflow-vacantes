//go:build integration

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func assertCreditAudit(t *testing.T, f *candidateCVFixture, event string, want map[string]any) {
	t.Helper()
	rows, err := f.h.pool.Query(t.Context(), `SELECT actor_id,entity_type,metadata FROM audit_events WHERE entity_id=$1 AND event_type=$2`, f.pid, event)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var actor uuid.UUID
		var entity string
		var raw []byte
		if err := rows.Scan(&actor, &entity, &raw); err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		if got["credit_id"] == want["credit_id"] && (event == "VacancyPlacementCredited" || got["cause"] == want["cause"] && got["to_status"] == want["to_status"]) {
			if actor != f.owner.userID || entity != "process_participation" {
				t.Fatal(actor, entity)
			}
			editJSONEqual(t, got, want)
			found = true
		}
	}
	if rows.Err() != nil {
		t.Fatal(rows.Err())
	}
	if !found {
		t.Fatal("missing audit", event, want)
	}
}
func placementCreditState(t *testing.T, f *candidateCVFixture, vacancy uuid.UUID) string {
	t.Helper()
	var raw string
	err := f.h.pool.QueryRow(t.Context(), `SELECT jsonb_build_object(
 'credits',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM placement_credits c WHERE process_id=$1),
 'recipients',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.credit_id,r.user_id) FROM placement_credit_recipients r JOIN placement_credits c ON c.id=r.credit_id WHERE c.process_id=$1),
 'participations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM process_participations p WHERE process_id=$1),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id WHERE p.process_id=$1),
 'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_events a WHERE a.entity_id=$1 OR a.metadata->>'vacancy_id'=$1::text),
 'idempotency',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM job_draft_idempotency i WHERE i.company_id=$2),
 'milestones',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM process_coverage_milestones m WHERE process_id=$1))::text`, vacancy, f.company.companyID).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func creditMoveToHire(t *testing.T, f *candidateCVFixture) (string, string, pipelineconfig.Configuration) {
	t.Helper()
	base, path := boardCorrectionPaths(t, f)
	id := uuid.MustParse(base[len(draftFlowV2Path)+1:])
	cfg := pipelineconfig.Defaults(id)
	for i := 1; i < len(cfg.Stages); i++ {
		creditMove(t, f, path, fmt.Sprintf(`{"to_stage_id":%q}`, cfg.Stages[i].ID))
	}
	return base, path, cfg
}
func creditMove(t *testing.T, f *candidateCVFixture, path, body string) {
	t.Helper()
	d := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
	r := f.h.do(t, "POST", path+"/moves", body, f.owner.token, map[string]string{"If-Match": d["etag"].(string)})
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
}

func TestPlacementCreditMoveExits(t *testing.T) {
	for _, reason := range []string{"candidate_left", "moved_by_mistake"} {
		t.Run(reason, func(t *testing.T) {
			f := newCandidateCVFixture(t, "manual")
			base, path, cfg := creditMoveToHire(t, f)
			d := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
			cid := d["placement_credit"].(map[string]any)["id"]
			creditMove(t, f, path, fmt.Sprintf(`{"to_stage_id":%q,"placement_exit_reason":%q}`, cfg.Stages[len(cfg.Stages)-2].ID, reason))
			c := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)["placement_credit"].(map[string]any)
			want := "did_not_hold"
			if reason == "moved_by_mistake" {
				want = "voided"
			}
			if c["status"] != want || c["exit_reason"] != reason {
				t.Fatal(c)
			}
			assertCreditAudit(t, f, "VacancyPlacementCreditChanged", map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": base[len(draftFlowV2Path)+1:], "credit_id": cid, "from_status": "active", "to_status": want, "cause": "exit:" + reason})
			var linked bool
			if err := f.h.pool.QueryRow(t.Context(), `SELECT h.hire AND e.departure AND c.hired_by=$2 AND c.status_changed_by=$2 AND c.hired_at=h.created_at AND c.status_changed_at=e.created_at FROM placement_credits c JOIN participation_stage_history h ON h.id=c.hire_history_id JOIN participation_stage_history e ON e.id=c.exit_history_id WHERE c.id=$1`, cid, f.owner.userID).Scan(&linked); err != nil || !linked {
				t.Fatal("credit/history linkage", linked, err)
			}
		})
	}
}

func TestPlacementCreditNoCreditExit(t *testing.T) {
	for _, op := range []string{"moves", "discard"} {
		t.Run(op, func(t *testing.T) {
			f := newCandidateCVFixture(t, "manual")
			base, path := boardCorrectionPaths(t, f)
			cfg := pipelineconfig.Defaults(uuid.MustParse(base[len(draftFlowV2Path)+1:]))
			// Pre-T4 placements have no credit. A seed is needed because all new hires
			// now correctly create a credit; requests still go through the real router.
			f.exec(t, `UPDATE process_participations SET stage_id=$2 WHERE id=$1`, f.pid, cfg.Stages[len(cfg.Stages)-1].ID)
			d := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
			body := fmt.Sprintf(`{"to_stage_id":%q,"placement_exit_reason":"candidate_left"}`, cfg.Stages[len(cfg.Stages)-2].ID)
			if op == "discard" {
				body = `{"reason":{"group":"candidate","key":"unresponsive"},"placement_exit_reason":"candidate_left"}`
			}
			r := f.h.do(t, "POST", path+"/"+op, body, f.owner.token, map[string]string{"If-Match": d["etag"].(string)})
			if r.status != 200 {
				t.Fatal(r.status, string(r.body))
			}
			out := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
			if out["placement_credit"] != nil {
				t.Fatal(out)
			}
			list := f.h.do(t, "GET", path+"/placement-credits", "", f.owner.token, nil)
			if list.status != 200 {
				t.Fatal(list.status, string(list.body))
			}
			editJSONEqual(t, draftFlowObject(t, list.body)["items"], []any{})
			if draftFlowAuditCount(t, f.h.pool, f.pid, "VacancyPlacementCreditChanged") != 0 {
				t.Fatal("no-credit exit audited a credit")
			}
		})
	}
}

func TestPlacementCreditAuditRollback(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	base, path := boardCorrectionPaths(t, f)
	id := uuid.MustParse(base[len(draftFlowV2Path)+1:])
	cfg := pipelineconfig.Defaults(id)
	for i := 1; i < len(cfg.Stages)-1; i++ {
		creditMove(t, f, path, fmt.Sprintf(`{"to_stage_id":%q}`, cfg.Stages[i].ID))
	}
	fault := &teamFailAudit{event: "VacancyPlacementCredited"}
	fault.enabled.Store(true)
	failing := newDraftFlowHarnessWithAudit(t, fault, f.local)
	before := boardCorrectionRead(t, f, path, f.owner)
	state := placementCreditState(t, f, id)
	r := failing.do(t, "POST", path+"/moves", fmt.Sprintf(`{"to_stage_id":%q}`, cfg.Stages[len(cfg.Stages)-1].ID), f.owner.token, map[string]string{"If-Match": draftFlowObject(t, before.body)["etag"].(string)})
	draftFlowAssertError(t, r, 500, "internal_error")
	if state != placementCreditState(t, f, id) || !bytes.Equal(before.body, boardCorrectionRead(t, f, path, f.owner).body) {
		t.Fatal("hire audit failure leaked transaction")
	}
	fault.enabled.Store(false)
	creditMove(t, f, path, fmt.Sprintf(`{"to_stage_id":%q}`, cfg.Stages[len(cfg.Stages)-1].ID))
}

func TestPlacementCreditVoidRacingMove(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	base, path, cfg := creditMoveToHire(t, f)
	d := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
	cid := d["placement_credit"].(map[string]any)["id"].(string)
	start := make(chan struct{})
	out := make(chan draftFlowCall, 2)
	go func() {
		<-start
		r, e := f.h.roundTrip("POST", path+"/placement-credits/"+cid+"/void", "{}", f.owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
		out <- draftFlowCall{r, e}
	}()
	go func() {
		<-start
		r, e := f.h.roundTrip("POST", path+"/moves", fmt.Sprintf(`{"to_stage_id":%q,"placement_exit_reason":"candidate_left"}`, cfg.Stages[len(cfg.Stages)-2].ID), f.owner.token, map[string]string{"If-Match": d["etag"].(string)})
		out <- draftFlowCall{r, e}
	}()
	close(start)
	for i := 0; i < 2; i++ {
		call := <-out
		if call.err != nil || call.resp.status != 200 {
			t.Fatal(call.err, call.resp.status, string(call.resp.body))
		}
	}
	got := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
	if got["stage_id"] != cfg.Stages[len(cfg.Stages)-2].ID || got["placement_credit"].(map[string]any)["status"] != "voided" {
		t.Fatal(got)
	}
	if n := draftFlowCount(t, f.h.pool, `SELECT count(*) FROM placement_credits WHERE process_id=$1 AND status='active'`, base[len(draftFlowV2Path)+1:]); n != 0 {
		t.Fatal(n)
	}
	r := f.h.do(t, "POST", path+"/placement-credits/"+cid+"/restore", "{}", f.owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
	if r.status != 200 || draftFlowObject(t, r.body)["status"] != "did_not_hold" {
		t.Fatal(r.status, string(r.body))
	}
}
