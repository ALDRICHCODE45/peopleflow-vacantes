//go:build integration

package main

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
)

// A stakeholder never joins a vacancy team (stakeholder-metrics-v1 §1.1): team
// writes and offboard handovers naming one answer not_company_member, like a
// non-member, and leave tramos, reassignments and audit unchanged.

func TestStakeholderTeamWrites_Refused(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	recruiterID, _ := company.addUser(t, "recruiter")
	stakeholderID, _ := company.addUser(t, "stakeholder")
	id := draftListFlowCreate(t, h, owner, `{"fields":{"title":"Team"}}`)
	base := draftFlowV2Path + "/" + id + "/team"
	headers := func() map[string]string {
		return map[string]string{"If-Match": h.do(t, "GET", base, "", owner.token, nil).header.Get("ETag"), "Idempotency-Key": uuid.NewString()}
	}
	for _, tc := range []struct{ path, body string }{
		{"/members", fmt.Sprintf(`{"user_id":%q}`, stakeholderID)},
		{"/members", fmt.Sprintf(`{"user_id":%q,"recruiter_deadline":"2027-02-01"}`, stakeholderID)},
		{"/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, stakeholderID)},
	} {
		before, audit := teamWriteState(t, h, id), auditCompanyCount(t, h.pool, company.companyID)
		r := h.do(t, "POST", base+tc.path, tc.body, owner.token, headers())
		draftFlowAssertCatalogError(t, r, 422, "not_company_member")
		if teamWriteState(t, h, id) != before || auditCompanyCount(t, h.pool, company.companyID) != audit {
			t.Fatalf("%s: rejected write changed state", tc.path)
		}
	}
	// Recruiters keep joining and taking over as before.
	if r := h.do(t, "POST", base+"/members", fmt.Sprintf(`{"user_id":%q}`, recruiterID), owner.token, headers()); r.status != 200 {
		t.Fatalf("add recruiter %d %s", r.status, r.body)
	}
	if r := h.do(t, "POST", base+"/reassign-responsible", fmt.Sprintf(`{"to_user_id":%q,"reason":"workload","previous_responsible":"keep_as_collaborator"}`, recruiterID), owner.token, headers()); r.status != 200 {
		t.Fatalf("reassign to recruiter %d %s", r.status, r.body)
	}
}

func TestStakeholderOffboard_TargetRefused(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	leaverID, leaverSub := company.addUser(t, "recruiter")
	targetID, _ := company.addUser(t, "recruiter")
	stakeholderID, _ := company.addUser(t, "stakeholder")
	id := draftListFlowCreate(t, h, h.actor(t, leaverID, leaverSub), `{"fields":{"title":"Handover"}}`)
	path := offboardPath(t, h, leaverID) + "/offboard"
	state := func() string {
		return teamWriteState(t, h, id) + memberGuardSnapshot(t, h.pool, company.companyID)
	}
	for _, body := range []string{
		fmt.Sprintf(`{"default_to_user_id":%q}`, stakeholderID),
		fmt.Sprintf(`{"reassignments":[{"draft_id":%q,"to_user_id":%q}]}`, id, stakeholderID),
		fmt.Sprintf(`{"default_to_user_id":%q,"reassignments":[{"draft_id":%q,"to_user_id":%q}]}`, stakeholderID, id, targetID),
	} {
		before, audit := state(), auditCompanyCount(t, h.pool, company.companyID)
		r := h.do(t, "POST", path, body, owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
		draftFlowAssertCatalogError(t, r, 422, "not_company_member")
		if state() != before || auditCompanyCount(t, h.pool, company.companyID) != audit {
			t.Fatalf("%s: rejected offboard changed state", body)
		}
	}
	r := h.do(t, "POST", path, fmt.Sprintf(`{"default_to_user_id":%q}`, targetID), owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
	if r.status != 200 {
		t.Fatalf("offboard to recruiter %d %s", r.status, r.body)
	}
	if draftFlowCount(t, h.pool, `SELECT count(*) FROM company_members WHERE user_id=$1`, leaverID) != 0 ||
		draftFlowCount(t, h.pool, `SELECT count(*) FROM vacancy_assignments WHERE draft_id=$1 AND user_id=$2 AND ended_at IS NULL`, id, targetID) != 1 {
		t.Fatal("handover to the recruiter did not happen")
	}
}
