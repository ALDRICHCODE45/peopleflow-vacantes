//go:build integration

package main

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// GET /me/company/members carries workload.active_vacancies per member (audit
// gap D5, docs/contracts/vacancy-team-v1.md «Member workload»): the vacancies
// of the company where the member holds an open team assignment and whose
// process is active, the same for every viewer. Production router, real
// RequireAuth/RequireCompanyRole, real SQL.

var memberListKeys = []string{"company_id", "created_at", "id", "role", "updated_at", "user", "workload"}

func (f *replFlow) teamAdd(draft string, user uuid.UUID) {
	f.t.Helper()
	team := f.h.do(f.t, "GET", draftFlowV2Path+"/"+draft+"/team", "", f.owner.token, nil)
	if team.status != 200 {
		f.t.Fatalf("team %d %s", team.status, team.body)
	}
	added := f.h.do(f.t, "POST", draftFlowV2Path+"/"+draft+"/team/members", fmt.Sprintf(`{"user_id":%q}`, user), f.owner.token, map[string]string{"If-Match": team.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if added.status != 200 {
		f.t.Fatalf("add %s to %s: %d %s", user, draft, added.status, added.body)
	}
}

func (f *replFlow) teamRemove(draft string, user uuid.UUID) {
	f.t.Helper()
	team := f.h.do(f.t, "GET", draftFlowV2Path+"/"+draft+"/team", "", f.owner.token, nil)
	removed := f.h.do(f.t, "POST", draftFlowV2Path+"/"+draft+"/team/members/"+user.String()+"/remove", `{}`, f.owner.token, map[string]string{"If-Match": team.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if removed.status != 200 {
		f.t.Fatalf("remove %s from %s: %d %s", user, draft, removed.status, removed.body)
	}
}

// workloads reads the member list as the viewer and returns user id → active_vacancies,
// pinning the member and workload keys.
func (f *replFlow) workloads(token string) (map[string]float64, string) {
	f.t.Helper()
	r := f.h.do(f.t, "GET", "/me/company/members", "", token, nil)
	if r.status != 200 {
		f.t.Fatalf("members %d %s", r.status, r.body)
	}
	out := map[string]float64{}
	for _, raw := range draftFlowObject(f.t, r.body)["members"].([]any) {
		m := raw.(map[string]any)
		if !reflect.DeepEqual(docsSorted(m), memberListKeys) {
			f.t.Fatalf("member keys %v", docsSorted(m))
		}
		workload, ok := m["workload"].(map[string]any)
		if !ok || len(workload) != 1 {
			f.t.Fatalf("workload %v", m["workload"])
		}
		count, ok := workload["active_vacancies"].(float64)
		if !ok {
			f.t.Fatalf("active_vacancies %v", workload["active_vacancies"])
		}
		out[m["user"].(map[string]any)["id"].(string)] = count
	}
	return out, string(r.body)
}

func TestMembersList_WorkloadIsTheSameForEveryViewer(t *testing.T) {
	f := newReplFlow(t)
	aID, aSub := f.company.addUser(t, "recruiter")
	bID, bSub := f.company.addUser(t, "recruiter")
	idleID, idleSub := f.company.addUser(t, "recruiter")
	stakeholderID, _ := f.company.addUser(t, "stakeholder")

	// The owner creates every vacancy and is its responsible.
	never := f.draft() // never published: no process, never counts
	f.teamAdd(never, aID)
	published := f.published()
	f.teamAdd(published, aID)
	paused := f.published()
	f.teamAdd(paused, aID)
	f.teamAdd(paused, bID)
	if got := f.transition(paused, "pause", `{}`); got.status != 200 {
		t.Fatalf("pause %d %s", got.status, got.body)
	}
	closedActive := f.published() // closed, process continues: still active
	f.teamAdd(closedActive, aID)
	f.closeIt(closedActive, "continue")
	finished := f.published() // closed, process finished: never counts
	f.teamAdd(finished, aID)
	f.teamAdd(finished, bID)
	f.closeIt(finished, "finish")
	left := f.published() // a ended tramo never counts
	f.teamAdd(left, bID)
	f.teamRemove(left, bID)
	// Another company's vacancy never counts toward this company.
	other := newReplFlow(t)
	other.published()

	want := map[string]float64{
		f.owner.userID.String(): 4, // published, paused, closedActive, left
		aID.String():            3, // published, paused, closedActive
		bID.String():            1, // paused
		idleID.String():         0,
		stakeholderID.String():  0,
	}
	owner, ownerBody := f.workloads(f.owner.token)
	if !reflect.DeepEqual(owner, want) {
		t.Fatalf("owner view %v, want %v", owner, want)
	}
	// A recruiter on few teams (or none) sees exactly the owner's list: the
	// count never depends on the viewer's own drafts.
	for _, sub := range []string{aSub, bSub, idleSub} {
		got, body := f.workloads(f.h.signer.validToken(t, sub))
		if body != ownerBody || !reflect.DeepEqual(got, want) {
			t.Fatalf("viewer view %v differs from the owner's %v", got, want)
		}
	}
	// Ending A's tramo on «published» drops it from A's count only.
	f.teamRemove(published, aID)
	want[aID.String()] = 2
	if got, _ := f.workloads(f.owner.token); !reflect.DeepEqual(got, want) {
		t.Fatalf("after removal %v, want %v", got, want)
	}
}
