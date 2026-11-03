//go:build integration

package main

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestOffboardDeleteCollaboratorAndCreditAttributionHTTP(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	base, path := boardCorrectionPaths(t, f)
	id := base[len(draftFlowV2Path)+1:]
	offboardTeamWrite(t, f.h, f.owner, id, "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, f.recruiter.userID))
	creditMoveToHire(t, f)
	before := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)["placement_credit"]
	historyBefore := f.h.do(t, "GET", path+"/history", "", f.owner.token, nil)
	membership := offboardPath(t, f.h, f.recruiter.userID)
	preview := f.h.do(t, "GET", membership+"/offboard-preview", "", f.owner.token, nil)
	if preview.status != 200 {
		t.Fatal(preview.status, string(preview.body))
	}
	p := draftFlowObject(t, preview.body)
	editJSONEqual(t, p["vacancies"], []any{})
	if p["other_tramos"] != float64(1) {
		t.Fatal(p)
	}
	teamBefore := f.h.do(t, "GET", base+"/team", "", f.owner.token, nil)
	del := f.h.do(t, "DELETE", membership, "", f.owner.token, nil)
	if del.status != 204 || len(del.body) != 0 {
		t.Fatal(del.status, string(del.body))
	}
	teamAfter := f.h.do(t, "GET", base+"/team", "", f.owner.token, nil)
	if teamAfter.header.Get("ETag") == teamBefore.header.Get("ETag") {
		t.Fatal("team version not bumped")
	}
	tr := offboardTramo(t, f.h, f.owner, id, f.recruiter.userID)
	if tr["end_cause"] != "membership_ended" || tr["user"].(map[string]any)["id"] != f.recruiter.userID.String() {
		t.Fatal(tr)
	}
	editJSONEqual(t, draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)["placement_credit"], before)
	historyAfter := f.h.do(t, "GET", path+"/history", "", f.owner.token, nil)
	if historyAfter.status != 200 || string(historyAfter.body) != string(historyBefore.body) {
		t.Fatal("candidate history attribution changed")
	}
	offboardAssertAudit(t, f.h, f.owner.userID, "VacancyAssignmentEndedByMembership", "vacancy", id, map[string]any{"company_id": f.company.companyID.String(), "assignment_id": tr["assignment_id"], "user_id": f.recruiter.userID.String()})
	for _, route := range []string{base, base + "/team", path, "/me/company/members"} {
		draftFlowAssertCatalogError(t, f.h.do(t, "GET", route, "", f.recruiter.token, nil), 403, "forbidden")
	}
	// A new company membership restores the general gate, not vacancy access.
	draftFlowInsertMembership(t, f.h.pool, f.company.companyID, f.recruiter.userID, "recruiter")
	draftFlowAssertCatalogError(t, f.h.do(t, "GET", base, "", f.recruiter.token, nil), 404, "team_access_ended")
}

func TestOffboardDefaultResponsibleCreditAndReplayHTTP(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	base, path := boardCorrectionPaths(t, f)
	id := base[len(draftFlowV2Path)+1:]
	offboardTeamWrite(t, f.h, f.owner, id, "POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, f.recruiter.userID))
	creditMoveToHire(t, f)
	credit := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)["placement_credit"]
	membership := offboardPath(t, f.h, f.recruiter.userID)
	body := fmt.Sprintf(`{"default_to_user_id":%q}`, f.owner.userID)
	key := map[string]string{"Idempotency-Key": uuid.NewString()}
	r := f.h.do(t, "POST", membership+"/offboard", body, f.owner.token, key)
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	editJSONEqual(t, draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)["placement_credit"], credit)
	replay := f.h.do(t, "POST", membership+"/offboard", body, f.owner.token, key)
	if replay.status != 200 || string(replay.body) != string(r.body) || replay.header.Get("Idempotency-Replayed") != "true" {
		t.Fatal(replay.status, string(replay.body))
	}
	draftFlowAssertCatalogError(t, f.h.do(t, "POST", membership+"/offboard", `{}`, f.owner.token, key), 409, "idempotency_conflict")
	// The offboarding reassignment includes the full stored snapshot.
	found := false
	for _, raw := range offboardHistory(t, f.h, f.owner, id)["items"].([]any) {
		item := raw.(map[string]any)
		if item["kind"] != "reassignment" {
			continue
		}
		v := item["reassignment"].(map[string]any)
		if v["reason"] != "recruiter_departure" {
			continue
		}
		found = true
		if v["previous_responsible"] != "remove" || v["from_user"].(map[string]any)["id"] != f.recruiter.userID.String() {
			t.Fatal(v)
		}
		snapshot := v["state_snapshot"].(map[string]any)
		orgCandidateKeys(t, snapshot, "captured_at", "lifecycle", "stage_counts", "tramo", "delivery", "placements")
		if snapshot["placements"].(map[string]any)["current"] != float64(1) {
			t.Fatal(snapshot)
		}
	}
	if !found {
		t.Fatal("no offboard reassignment snapshot")
	}
}

func TestOffboardDeleteAuditRollbackHTTP(t *testing.T) {
	fault := &teamFailAudit{event: "VacancyAssignmentEndedByMembership"}
	h := newDraftFlowHarnessWithAudit(t, fault)
	company, oid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, oid, sub)
	uid, _ := company.addUser(t, "recruiter")
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	offboardTeamWrite(t, h, owner, id, "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, uid))
	path := offboardPath(t, h, uid)
	before := h.do(t, "GET", draftFlowV2Path+"/"+id+"/team", "", owner.token, nil)
	history := offboardHistory(t, h, owner, id)
	membership := h.do(t, "GET", "/me/company/members", "", owner.token, nil)
	fault.enabled.Store(true)
	draftFlowAssertCatalogError(t, h.do(t, "DELETE", path, "", owner.token, nil), 500, "internal_error")
	after := h.do(t, "GET", draftFlowV2Path+"/"+id+"/team", "", owner.token, nil)
	if string(before.body) != string(after.body) || before.header.Get("ETag") != after.header.Get("ETag") {
		t.Fatal("team changed")
	}
	editJSONEqual(t, offboardHistory(t, h, owner, id), history)
	if string(h.do(t, "GET", "/me/company/members", "", owner.token, nil).body) != string(membership.body) {
		t.Fatal("member changed")
	}
	fault.enabled.Store(false)
	if r := h.do(t, "DELETE", path, "", owner.token, nil); r.status != 204 {
		t.Fatal(r.status, string(r.body))
	}
}

type offboardBlockingAudit struct {
	enabled          atomic.Bool
	entered, release chan struct{}
}

func (a *offboardBlockingAudit) Append(ctx context.Context, tx pgx.Tx, event audit.AuditEvent) error {
	if a.enabled.Load() && event.EventType == "CompanyMemberOffboarded" {
		close(a.entered)
		select {
		case <-a.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return auditpostgres.NewAuditEventRepository().Append(ctx, tx, event)
}
func TestOffboardConcurrentTeamWriteHTTP(t *testing.T) {
	gate := &offboardBlockingAudit{entered: make(chan struct{}), release: make(chan struct{})}
	h := newDraftFlowHarnessWithAudit(t, gate)
	company, oid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, oid, sub)
	uid, us := company.addUser(t, "recruiter")
	user := h.actor(t, uid, us)
	id := draftListFlowCreate(t, h, user, `{"fields":{}}`)
	path := offboardPath(t, h, uid)
	base := draftFlowV2Path + "/" + id + "/team"
	tag := h.do(t, "GET", base, "", owner.token, nil).header.Get("ETag")
	gate.enabled.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	released := false
	defer func() {
		if !released {
			close(gate.release)
		}
	}()
	off := make(chan draftFlowCall, 1)
	go func() {
		r, err := h.roundTrip("POST", path+"/offboard", fmt.Sprintf(`{"default_to_user_id":%q}`, oid), owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
		off <- draftFlowCall{r, err}
	}()
	select {
	case <-gate.entered:
	case <-ctx.Done():
		t.Fatal("offboard did not reach audit")
	}
	write := make(chan draftFlowCall, 1)
	go func() {
		r, err := h.roundTrip("PATCH", base+"/members/"+oid.String(), `{"recruiter_deadline":null}`, owner.token, map[string]string{"If-Match": tag})
		write <- draftFlowCall{r, err}
	}()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := h.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT status, deleted_at FROM companies%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case result := <-write:
			t.Fatal("team write did not serialize", result)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
	close(gate.release)
	released = true
	select {
	case call := <-off:
		if call.err != nil || call.resp.status != 200 {
			t.Fatal(call.err, call.resp.status, string(call.resp.body))
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case call := <-write:
		if call.err != nil {
			t.Fatal(call.err)
		}
		draftFlowAssertCatalogError(t, call.resp, 412, "team_version_conflict")
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	tr := offboardTramo(t, h, owner, id, uid)
	if tr["end_cause"] != "reassigned" {
		t.Fatal(tr)
	}
}

func TestOffboardMirrorsLastOwnerHTTP(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, oid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, oid, sub)
	path := offboardPath(t, h, oid)
	draftFlowAssertCatalogError(t, h.do(t, "POST", path+"/offboard", `{}`, owner.token, map[string]string{"Idempotency-Key": uuid.NewString()}), 409, "last_owner")
	company.addUser(t, "owner")
	r := h.do(t, "POST", path+"/offboard", `{}`, owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	out := draftFlowObject(t, r.body)
	editJSONEqual(t, out, map[string]any{"user_id": oid.String(), "handed_over": []any{}, "ended_assignment_ids": []any{}})
	draftFlowAssertCatalogError(t, h.do(t, "GET", "/me/company/members", "", owner.token, nil), 403, "forbidden")
}
