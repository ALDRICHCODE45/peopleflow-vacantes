//go:build integration

package main

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestVacancyTeamFlowAccessAndCreation(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	memberID, memberSub := company.addUser(t, "recruiter")
	member := h.actor(t, memberID, memberSub)
	outsiderID, outsiderSub := company.addUser(t, "recruiter")
	outsider := h.actor(t, outsiderID, outsiderSub)
	id := publicationFlowReady(t, h, member)
	publicFlowPublish(t, h, id, member)
	base := draftFlowV2Path + "/" + id
	team := h.do(t, "GET", base+"/team", "", member.token, nil)
	if team.status != 200 || team.header.Get("ETag") == "" {
		t.Fatalf("team %d %s", team.status, team.body)
	}
	obj := draftFlowObject(t, team.body)
	if len(obj) != 3 || obj["mode"] != "with_responsible" {
		t.Fatal(obj)
	}
	members := obj["members"].([]any)
	m := members[0].(map[string]any)
	if len(members) != 1 || len(m) != 7 || m["function"] != "responsible" || m["user"].(map[string]any)["id"] != memberID.String() || m["assignment_id"] == nil {
		t.Fatal(members)
	}
	viewer := obj["viewer"].(map[string]any)
	if viewer["function"] != "responsible" || viewer["is_owner"] != false || viewer["can"].(map[string]any)["renegotiate_commitment"] != true {
		t.Fatal(viewer)
	}
	var metadata map[string]string
	var raw []byte
	if err := h.pool.QueryRow(context.Background(), `SELECT metadata FROM audit_events WHERE entity_id=$1 AND entity_type='vacancy' AND event_type='VacancyTeamCreated'`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &metadata); err != nil || len(metadata) != 4 || metadata["company_id"] != company.companyID.String() || metadata["responsible_user_id"] != memberID.String() || metadata["assignment_id"] != m["assignment_id"] || metadata["mode"] != "with_responsible" {
		t.Fatal(metadata, err)
	}
	for _, suffix := range []string{"", "/board", "/team", "/team/history"} {
		if r := h.do(t, "GET", base+suffix, "", member.token, nil); r.status != 200 {
			t.Fatalf("active %s %d %s", suffix, r.status, r.body)
		}
		if r := h.do(t, "GET", base+suffix, "", owner.token, nil); r.status != 200 {
			t.Fatalf("owner %s %d %s", suffix, r.status, r.body)
		}
		draftFlowAssertCatalogError(t, h.do(t, "GET", base+suffix, "", outsider.token, nil), 404, "not_found")
	}
	// The list choke point includes an active recruiter and excludes a nonmember.
	for _, tc := range []struct {
		actor draftFlowActor
		count int
	}{{member, 1}, {outsider, 0}, {owner, 1}} {
		r := h.do(t, "GET", draftFlowV2Path, "", tc.actor.token, nil)
		if r.status != 200 || len(draftFlowObject(t, r.body)["items"].([]any)) != tc.count {
			t.Fatalf("list %d %s", r.status, r.body)
		}
	}
	// Close the function and stay together, as a future team write must.
	ctx := context.Background()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE vacancy_assignment_functions SET ended_at=now(),end_cause='tramo_ended' WHERE assignment_id=$1`, m["assignment_id"]); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE vacancy_assignments SET ended_at=now(),ended_by=$2,end_cause='removed' WHERE id=$1`, m["assignment_id"], ownerID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "/board", "/team", "/team/history", "/psychometric-profile", "/psychometric-invitations"} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", base+suffix, "", member.token, nil), 404, "team_access_ended")
		if r := h.do(t, "GET", base+suffix, "", owner.token, nil); r.status != 200 {
			t.Fatalf("owner after removal %s %d %s", suffix, r.status, r.body)
		}
	}
	r := h.do(t, "GET", draftFlowV2Path, "", member.token, nil)
	if r.status != 200 || len(draftFlowObject(t, r.body)["items"].([]any)) != 0 {
		t.Fatalf("ended list %d %s", r.status, r.body)
	}
}

func TestVacancyTeamHistoryTimeline(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id
	peerID, _ := company.addUser(t, "recruiter")
	ctx := context.Background()
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := h.pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Old arrival, recent function change: at must be the function's start.
	exec(`UPDATE vacancy_assignments SET started_at=$2 WHERE draft_id=$1`, id, at)
	exec(`UPDATE vacancy_assignment_functions SET started_at=$2,ended_at=$3,end_cause='mode_change' WHERE draft_id=$1`, id, at, at.Add(48*time.Hour))
	exec(`INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause) SELECT $2,id,draft_id,'member',$3,'mode_change' FROM vacancy_assignments WHERE draft_id=$1`, id, uuid.New(), at.Add(48*time.Hour))
	exec(`UPDATE vacancy_teams SET mode='shared' WHERE draft_id=$1`, id)
	var responsible uuid.UUID
	if err := h.pool.QueryRow(ctx, `SELECT id FROM vacancy_assignments WHERE draft_id=$1`, id).Scan(&responsible); err != nil {
		t.Fatal(err)
	}
	ended := uuid.New()
	exec(`INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,started_by,start_cause,ended_at,ended_by,end_cause,closing_deadline) VALUES($1,$2,$3,$4,$5,$6,'added',$7,$6,'removed','2026-01-20')`, ended, id, company.companyID, peerID, at, ownerID, at.Add(72*time.Hour))
	exec(`INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause,ended_at,end_cause) VALUES($1,$2,$3,'collaborator',$4,'added',$5,'tramo_ended')`, uuid.New(), ended, id, at, at.Add(72*time.Hour))
	exec(`INSERT INTO vacancy_reassignments(id,draft_id,company_id,from_assignment_id,to_assignment_id,reason,previous_responsible,performed_by,performed_at,state_snapshot) VALUES($1,$2,$3,$4,$5,'workload','keep_as_collaborator',$6,$7,'{"captured_at":"2026-01-01T00:00:00Z"}')`, uuid.New(), id, company.companyID, responsible, ended, ownerID, at.Add(24*time.Hour))
	for i := 0; i < 21; i++ {
		exec(`INSERT INTO vacancy_team_mode_changes(id,draft_id,company_id,from_mode,to_mode,performed_by,performed_at) VALUES($1,$2,$3,'with_responsible','shared',$4,$5)`, uuid.New(), id, company.companyID, ownerID, at)
	}
	first := h.do(t, "GET", base+"/team/history", "", owner.token, nil)
	if first.status != 200 {
		t.Fatalf("history %d %s", first.status, first.body)
	}
	obj := draftFlowObject(t, first.body)
	items := obj["items"].([]any)
	if len(obj) != 2 || len(items) != 20 || obj["next_cursor"] == nil {
		t.Fatal(obj)
	}
	for i, want := range []struct {
		kind string
		at   time.Time
	}{{"tramo", at.Add(72 * time.Hour)}, {"tramo", at.Add(48 * time.Hour)}, {"reassignment", at.Add(24 * time.Hour)}} {
		item := items[i].(map[string]any)
		stamp, err := time.Parse(time.RFC3339Nano, item["at"].(string))
		if len(item) != 3 || item["kind"] != want.kind || err != nil || !stamp.Equal(want.at) {
			t.Fatal(item, err)
		}
	}
	tramo := items[1].(map[string]any)["tramo"].(map[string]any)
	if len(tramo["functions"].([]any)) != 2 || tramo["started_by"] == nil || tramo["ended_at"] != nil {
		t.Fatal(tramo)
	}
	token := obj["next_cursor"].(string)
	second := h.do(t, "GET", base+"/team/history?cursor="+token, "", owner.token, nil)
	last := draftFlowObject(t, second.body)
	if second.status != 200 || len(last["items"].([]any)) != 4 || last["next_cursor"] != nil {
		t.Fatal(second.status, last)
	}
	for _, bad := range []string{"!", "e30"} {
		draftFlowAssertCatalogError(t, h.do(t, "GET", base+"/team/history?cursor="+bad, "", owner.token, nil), 400, "invalid_cursor")
	}
	foreign := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	draftFlowAssertCatalogError(t, h.do(t, "GET", draftFlowV2Path+"/"+foreign+"/team/history?cursor="+token, "", owner.token, nil), 400, "invalid_cursor")
}
