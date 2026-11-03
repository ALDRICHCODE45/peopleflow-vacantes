//go:build integration

package main

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

const ownHistoryPath = "/v2/me/vacancy-assignments/history"

func ownHistory(t *testing.T, h *draftFlowHarness, actor draftFlowActor, suffix string) map[string]any {
	t.Helper()
	r := h.do(t, "GET", ownHistoryPath+suffix, "", actor.token, nil)
	if r.status != 200 {
		t.Fatalf("history %d %s", r.status, r.body)
	}
	draftFlowAssertNoStore(t, r)
	obj := draftFlowObject(t, r.body)
	orgCandidateKeys(t, obj, "items", "next_cursor")
	for _, raw := range obj["items"].([]any) {
		item := raw.(map[string]any)
		orgCandidateKeys(t, item, "vacancy_title", "functions", "started_at", "ended_at", "end_cause", "effective_deadline", "delivered_in_tramo", "placements")
		orgCandidateKeys(t, item["placements"].(map[string]any), "direct", "participant", "shared")
		for _, f := range item["functions"].([]any) {
			orgCandidateKeys(t, f.(map[string]any), "function", "started_at", "ended_at")
		}
	}
	return obj
}

func TestOwnAssignmentHistoryContinuousStayAndAccess(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	peerID, peerSub := company.addUser(t, "recruiter")
	peer := h.actor(t, peerID, peerSub)
	id := draftListFlowCreate(t, h, peer, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id
	untitled := ownHistory(t, h, peer, "")["items"].([]any)[0].(map[string]any)
	if untitled["vacancy_title"] != nil || untitled["effective_deadline"] != nil {
		t.Fatal(untitled)
	}
	initial := h.do(t, "GET", base, "", peer.token, nil)
	titled := h.do(t, "PATCH", base, `{"fields":{"title":"Current title"}}`, peer.token, map[string]string{"If-Match": initial.header.Get("ETag")})
	if titled.status != 200 {
		t.Fatal(titled.status, string(titled.body))
	}
	// Owner-only vacancy and another company's vacancy must never appear.
	draftListFlowCreate(t, h, owner, `{"fields":{"title":"Not mine"}}`)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	draftListFlowCreate(t, h, foreign, `{"fields":{"title":"Foreign"}}`)
	write := func(method, suffix, body string) {
		t.Helper()
		team := h.do(t, "GET", base+"/team", "", owner.token, nil)
		r := h.do(t, method, base+"/team"+suffix, body, owner.token, map[string]string{"If-Match": team.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
		if r.status != 200 {
			t.Fatalf("team %d %s", r.status, r.body)
		}
	}
	write("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, ownerID))
	write("PATCH", "/members/"+peerID.String(), `{"recruiter_deadline":"2027-02-01"}`)
	write("POST", "/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload","previous_responsible":"keep_as_collaborator"}`, ownerID))
	write("PUT", "/mode", `{"mode":"shared"}`)
	obj := ownHistory(t, h, peer, "")
	items := obj["items"].([]any)
	if len(items) != 1 || obj["next_cursor"] != nil {
		t.Fatal(obj)
	}
	item := items[0].(map[string]any)
	if item["vacancy_title"] != "Current title" || item["effective_deadline"] != "2027-02-01" || item["ended_at"] != nil || item["end_cause"] != nil || item["delivered_in_tramo"] != float64(0) {
		t.Fatal(item)
	}
	functions := item["functions"].([]any)
	if len(functions) != 3 {
		t.Fatal(functions)
	}
	for i, want := range []string{"responsible", "collaborator", "member"} {
		f := functions[i].(map[string]any)
		if f["function"] != want {
			t.Fatal(functions)
		}
		if i > 0 && f["started_at"] != functions[i-1].(map[string]any)["ended_at"] {
			t.Fatal("function gap", functions)
		}
	}
	write("POST", "/members/"+peerID.String()+"/remove", `{}`)
	draftFlowAssertCatalogError(t, h.do(t, "GET", base, "", peer.token, nil), 404, "team_access_ended")
	ended := ownHistory(t, h, peer, "")["items"].([]any)
	if len(ended) != 1 {
		t.Fatal(ended)
	}
	closed := ended[0].(map[string]any)
	if closed["end_cause"] != "removed" || closed["ended_at"] == nil || closed["started_at"] != item["started_at"] || closed["effective_deadline"] != "2027-02-01" {
		t.Fatal(closed)
	}
	// Changing the current commitment cannot rewrite the frozen closing deadline.
	delivery := h.do(t, "GET", base+"/pipeline/delivery", "", owner.token, nil)
	_, cal := assertDeliveryFlowResponse(t, delivery, id, 0)
	date := deliveryFlowBusinessDate(t, cal)
	r := h.do(t, "PUT", base+"/pipeline/delivery", fmt.Sprintf(`{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":%q}`, date), owner.token, map[string]string{"If-Match": delivery.header.Get("ETag")})
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	if ownHistory(t, h, peer, "")["items"].([]any)[0].(map[string]any)["effective_deadline"] != "2027-02-01" {
		t.Fatal("closing deadline changed")
	}
	// Owner is allowed, but still sees only their own stays; their active deadline falls back to commitment.
	ownerItems := ownHistory(t, h, owner, "")["items"].([]any)
	if len(ownerItems) != 2 || ownerItems[0].(map[string]any)["effective_deadline"] != date {
		t.Fatal("owner scope/commitment fallback", ownerItems)
	}
	draft := h.do(t, "GET", base, "", owner.token, nil)
	renamed := h.do(t, "PATCH", base, `{"fields":{"title":"Renamed title"}}`, owner.token, map[string]string{"If-Match": draft.header.Get("ETag")})
	if renamed.status != 200 {
		t.Fatal(renamed.status, string(renamed.body))
	}
	if ownHistory(t, h, peer, "")["items"].([]any)[0].(map[string]any)["vacancy_title"] != "Renamed title" {
		t.Fatal("title is not current")
	}
	write("POST", "/members", fmt.Sprintf(`{"user_id":%q}`, peerID))
	rejoined := ownHistory(t, h, peer, "")["items"].([]any)
	if len(rejoined) != 2 || rejoined[0].(map[string]any)["ended_at"] != nil || rejoined[0].(map[string]any)["effective_deadline"] != date {
		t.Fatal(rejoined)
	}
	write("POST", "/members/"+peerID.String()+"/remove", `{}`)
	removed := h.do(t, "DELETE", "/me/company/members/"+ownHistoryMembership(t, h, peerID), "", owner.token, nil)
	if removed.status != 204 {
		t.Fatal(removed.status, string(removed.body))
	}
	draftFlowAssertCatalogError(t, h.do(t, "GET", ownHistoryPath, "", peer.token, nil), 403, "forbidden")
	draftFlowAssertCatalogError(t, h.do(t, "GET", ownHistoryPath, "", "", nil), 401, "unauthenticated")
	candidateID, candidateSub := draftFlowInsertUser(t, h.pool)
	company.userIDs = append(company.userIDs, candidateID)
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET user_type='candidate' WHERE id=$1`, candidateID); err != nil {
		t.Fatal(err)
	}
	candidate := h.actor(t, candidateID, candidateSub)
	draftFlowAssertCatalogError(t, h.do(t, "GET", ownHistoryPath, "", candidate.token, nil), 403, "forbidden")
}

func ownHistoryMembership(t *testing.T, h *draftFlowHarness, user uuid.UUID) string {
	t.Helper()
	var id string
	if err := h.pool.QueryRow(context.Background(), `SELECT id FROM company_members WHERE user_id=$1`, user).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestOwnAssignmentHistoryPaginationAndCompanyScope(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	peerID, peerSub := company.addUser(t, "recruiter")
	peer := h.actor(t, peerID, peerSub)
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ctx := context.Background()
	for i := 0; i < 22; i++ {
		id := draftListFlowCreate(t, h, owner, fmt.Sprintf(`{"fields":{"title":"Vacancy %02d"}}`, i))
		// Equal latest timestamps exercise the assignment-ID tiebreaker across pages.
		if _, err := h.pool.Exec(ctx, `UPDATE vacancy_assignments SET started_at=$2 WHERE draft_id=$1`, id, at); err != nil {
			t.Fatal(err)
		}
		if _, err := h.pool.Exec(ctx, `UPDATE vacancy_assignment_functions SET started_at=$2 WHERE draft_id=$1`, id, at); err != nil {
			t.Fatal(err)
		}
		if i == 20 {
			if _, err := h.pool.Exec(ctx, `UPDATE vacancy_assignment_functions SET started_at=$2 WHERE draft_id=$1`, id, at.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
		}
		if i == 21 {
			if _, err := h.pool.Exec(ctx, `UPDATE vacancy_assignment_functions SET ended_at=$2,end_cause='tramo_ended' WHERE draft_id=$1`, id, at.Add(2*time.Hour)); err != nil {
				t.Fatal(err)
			}
			if _, err := h.pool.Exec(ctx, `UPDATE vacancy_assignments SET ended_at=$2,end_cause='removed' WHERE draft_id=$1`, id, at.Add(2*time.Hour)); err != nil {
				t.Fatal(err)
			}
		}
	}
	first := ownHistory(t, h, owner, "")
	if len(first["items"].([]any)) != 20 || first["next_cursor"] == nil {
		t.Fatal(first)
	}
	token := first["next_cursor"].(string)
	last := ownHistory(t, h, owner, "?cursor="+token)
	if len(last["items"].([]any)) != 2 || last["next_cursor"] != nil {
		t.Fatal(last)
	}
	seen := map[string]bool{}
	for _, page := range []map[string]any{first, last} {
		for _, raw := range page["items"].([]any) {
			item := raw.(map[string]any)
			title := item["vacancy_title"].(string)
			if seen[title] {
				t.Fatal("duplicate", title)
			}
			seen[title] = true
			if item["effective_deadline"] != nil {
				t.Fatal(item)
			}
		}
	}
	// UUID-v7 assignments increase with creation: ties follow the team history's ascending ID rule.
	if first["items"].([]any)[0].(map[string]any)["vacancy_title"] != "Vacancy 21" || first["items"].([]any)[1].(map[string]any)["vacancy_title"] != "Vacancy 20" || first["items"].([]any)[2].(map[string]any)["vacancy_title"] != "Vacancy 00" || last["items"].([]any)[1].(map[string]any)["vacancy_title"] != "Vacancy 19" {
		t.Fatal(first, last)
	}
	before := ownHistory(t, h, owner, "")
	for _, bad := range []string{"!", "e30"} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", ownHistoryPath+"?cursor="+bad, "", owner.token, nil), 400, "invalid_cursor")
	}
	draftFlowAssertCatalogError(t, h.do(t, "GET", ownHistoryPath+"?cursor="+token, "", peer.token, nil), 400, "invalid_cursor")
	if !reflect.DeepEqual(before, ownHistory(t, h, owner, "")) {
		t.Fatal("rejected cursor changed history")
	}
	if len(ownHistory(t, h, peer, "")["items"].([]any)) != 0 {
		t.Fatal("another user's tramos leaked")
	}
	// A past company's assignments must not follow a user into their current company.
	other := draftFlowNewCompany(t, h.pool, "active")
	if _, err := h.pool.Exec(ctx, `UPDATE company_members SET company_id=$2 WHERE user_id=$1`, ownerID, other.companyID); err != nil {
		t.Fatal(err)
	}
	if len(ownHistory(t, h, owner, "")["items"].([]any)) != 0 {
		t.Fatal("past company leaked")
	}
	draftFlowAssertCatalogError(t, h.do(t, "GET", ownHistoryPath+"?cursor="+token, "", owner.token, nil), 400, "invalid_cursor")
}

func TestOwnAssignmentHistoryDeliveredActorWindowAndCredits(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	base, _ := boardCorrectionPaths(t, f)
	id := base[len(draftFlowV2Path)+1:]
	cfg := pipelineconfig.Defaults(uuid.MustParse(id))
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	f.exec(t, `UPDATE vacancy_assignments SET started_at=$2 WHERE draft_id=$1`, id, start)
	f.exec(t, `UPDATE vacancy_assignment_functions SET started_at=$2 WHERE draft_id=$1`, id, start)
	// Seed an ended stay: the HTTP view must not require vacancy visibility.
	f.exec(t, `UPDATE vacancy_assignment_functions SET ended_at=$2,end_cause='tramo_ended' WHERE draft_id=$1`, id, end)
	f.exec(t, `UPDATE vacancy_assignments SET ended_at=$2,end_cause='removed',closing_deadline='2026-01-20' WHERE draft_id=$1`, id, end)
	var assignment uuid.UUID
	if err := f.h.pool.QueryRow(context.Background(), `SELECT id FROM vacancy_assignments WHERE draft_id=$1`, id).Scan(&assignment); err != nil {
		t.Fatal(err)
	}
	assertCount := func(want float64) {
		t.Helper()
		obj := ownHistory(t, f.h, f.owner, "")
		items := obj["items"].([]any)
		if len(items) != 1 || items[0].(map[string]any)["delivered_in_tramo"] != want {
			t.Fatal(obj)
		}
	}
	// No cutoff is zero even with historical entries.
	cutoff := cfg.Stages[2].ID
	f.exec(t, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,event_kind,actor_kind,created_at) VALUES($1,$2,$3,$4,'intake','recruiter',$5)`, uuid.New(), f.pid, cutoff, f.owner.userID, start)
	assertCount(0)
	f.exec(t, `UPDATE job_draft_delivery_configs SET cutoff_stage_id=$2,commitment_date='2028-01-01' WHERE draft_id=$1`, id, cutoff)
	assertCount(1)
	// Each case replaces fixture history, never reads storage to determine the result.
	for _, tc := range []struct {
		name, stage, kind string
		actor             uuid.UUID
		at                time.Time
		want              float64
	}{
		{"inclusive start", cutoff, "intake", f.owner.userID, start, 1},
		{"before start", cutoff, "intake", f.owner.userID, start.Add(-time.Microsecond), 0},
		{"exclusive end", cutoff, "intake", f.owner.userID, end, 0},
		{"inside end", cutoff, "intake", f.owner.userID, end.Add(-time.Microsecond), 1},
		{"someone else", cutoff, "intake", f.recruiter.userID, start, 0},
		{"manual skips cutoff", cfg.Stages[3].ID, "intake", f.owner.userID, start, 1},
		{"before cutoff", cfg.Stages[0].ID, "intake", f.owner.userID, start, 0},
		{"normal move skips cutoff", cfg.Stages[3].ID, "move", f.owner.userID, start, 0},
		{"cutoff move", cutoff, "move", f.owner.userID, start, 1},
		{"cutoff recovery", cutoff, "recovery", f.owner.userID, start, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f.exec(t, `DELETE FROM participation_stage_history WHERE participation_id=$1`, f.pid)
			var from *string
			if tc.kind == "move" || tc.kind == "recovery" {
				v := cfg.Stages[0].ID
				from = &v
			}
			f.exec(t, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,event_kind,actor_kind,from_stage_id,created_at) VALUES($1,$2,$3,$4,$5,'recruiter',$6,$7)`, uuid.New(), f.pid, tc.stage, tc.actor, tc.kind, from, tc.at)
			assertCount(tc.want)
		})
	}
	// Repeat entries count a participation once, even through recovery.
	f.exec(t, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,event_kind,actor_kind,from_stage_id,created_at) VALUES($1,$2,$3,$4,'recovery','recruiter',$5,$6)`, uuid.New(), f.pid, cutoff, f.owner.userID, cfg.Exit.ID, start.Add(time.Hour))
	assertCount(1)
	// Active stays use now, not an unbounded upper window.
	f.exec(t, `UPDATE vacancy_assignments SET ended_at=NULL,end_cause=NULL WHERE id=$1`, assignment)
	f.exec(t, `UPDATE vacancy_assignment_functions SET ended_at=NULL,end_cause=NULL WHERE assignment_id=$1`, assignment)
	f.exec(t, `UPDATE participation_stage_history SET created_at=$2 WHERE participation_id=$1`, f.pid, time.Now().Add(24*time.Hour))
	assertCount(0)
	f.exec(t, `UPDATE participation_stage_history SET created_at=$2 WHERE participation_id=$1`, f.pid, start)
	assertCount(1)
	f.exec(t, `UPDATE vacancy_assignment_functions SET ended_at=$2,end_cause='tramo_ended' WHERE assignment_id=$1`, assignment, end)
	f.exec(t, `UPDATE vacancy_assignments SET ended_at=$2,end_cause='removed' WHERE id=$1`, assignment, end)
	for _, kind := range []string{"direct", "participant", "shared"} {
		for _, status := range []string{"active", "did_not_hold", "voided"} {
			credit, history := uuid.New(), uuid.New()
			f.exec(t, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,event_kind,actor_kind,hire,from_stage_id,created_at) VALUES($1,$2,$3,$4,'recovery','recruiter',true,$5,$6)`, history, f.pid, cfg.Stages[len(cfg.Stages)-1].ID, f.owner.userID, cfg.Exit.ID, start)
			f.exec(t, `INSERT INTO placement_credits(id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode,status) VALUES($1,$2,$3,$4,$5,$6,$7,'shared',$8)`, credit, f.company.companyID, id, f.pid, history, start, f.owner.userID, status)
			f.exec(t, `INSERT INTO placement_credit_recipients(credit_id,user_id,assignment_id,kind) VALUES($1,$2,$3,$4)`, credit, f.owner.userID, assignment, kind)
			// Avoid the fixture's at-most-one-active-credit invariant: assertions still include active rows, then mark them did_not_hold.
			obj := ownHistory(t, f.h, f.owner, "")
			placements := obj["items"].([]any)[0].(map[string]any)["placements"].(map[string]any)
			want := float64(1)
			if status != "active" {
				want = 2
			}
			if placements[kind] != want {
				t.Fatal(kind, status, placements)
			}
			if status == "active" {
				f.exec(t, `UPDATE placement_credits SET status='did_not_hold' WHERE id=$1`, credit)
			}
		}
	}
	obj := ownHistory(t, f.h, f.owner, "")
	item := obj["items"].([]any)[0].(map[string]any)
	if item["effective_deadline"] != "2026-01-20" {
		t.Fatal(item)
	}
	editJSONEqual(t, item["placements"], map[string]any{"direct": float64(2), "participant": float64(2), "shared": float64(2)})
}
