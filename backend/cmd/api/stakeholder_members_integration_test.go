//go:build integration

package main

import (
	"testing"

	"github.com/google/uuid"
)

// Membership writes that involve a stakeholder (stakeholder-metrics-v1 §1.1, §1.3).

// The owner fallback: POST /me/company/members adds an employer account as a
// stakeholder, audited as CompanyMemberAdded with role stakeholder.
func TestStakeholderMembers_AddAsStakeholder(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	userID, _ := shFreeUser(t, company)
	r := membersAdd(t, h, token, userID, "stakeholder")
	if r.status != 201 {
		t.Fatalf("add %d %s", r.status, r.body)
	}
	body := draftFlowObject(t, r.body)
	membership := draftFlowUUID(t, body["id"].(string))
	if body["role"] != "stakeholder" || body["user_id"] != userID.String() || membersRole(t, h, membership) != "stakeholder" {
		t.Fatal(string(r.body))
	}
	rows := auditRowsWhere(t, h.pool, `company_id=$1 AND event_type='CompanyMemberAdded' AND entity_id=$2`, company.companyID, membership)
	if len(rows) != 1 {
		t.Fatalf("rows %d", len(rows))
	}
	assertAuditRow(t, rows[0], wantAuditRow{actor: ownerID, eventType: "CompanyMemberAdded", entityType: "company_member", entityID: membership, company: company.companyID, metadata: map[string]any{"member_user_id": userID.String(), "role": "stakeholder"}})

	// Same rules as any add: a member of any company, or a candidate, is refused.
	candidateID, _ := sessionInsertUser(t, h, "candidate")
	for _, tc := range []struct {
		user          uuid.UUID
		status        int
		code, message string
	}{
		{userID, 409, "already_exists", "user already has a company membership"},
		{candidateID, 400, "invalid_request", "target user is not a recruiter"},
	} {
		shRejected(t, h, []uuid.UUID{company.companyID}, func() draftFlowResponse { return membersAdd(t, h, token, tc.user, "stakeholder") }, tc.status, tc.code, tc.message)
	}
}

// PATCH never converts to or from stakeholder (D5); other role changes keep working.
func TestStakeholderMembers_RoleChangeRefused(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	recruiterID, _ := company.addUser(t, "recruiter")
	stakeholderID, _ := company.addUser(t, "stakeholder")
	recruiter, stakeholder := memberGuardID(t, h.pool, recruiterID), memberGuardID(t, h.pool, stakeholderID)
	const msg = "stakeholder role changes are not supported"
	for _, tc := range []struct {
		member uuid.UUID
		role   string
	}{{recruiter, "stakeholder"}, {stakeholder, "recruiter"}, {stakeholder, "owner"}, {uuid.New(), "stakeholder"}} {
		shRejected(t, h, []uuid.UUID{company.companyID}, func() draftFlowResponse { return membersPatch(t, h, token, tc.member, tc.role) }, 422, "stakeholder_role_change_not_supported", msg)
	}
	// Any PATCH naming the stakeholder role is refused, even stakeholder→stakeholder.
	before := shInvitationState(t, h, company.companyID)
	if r := membersPatch(t, h, token, stakeholder, "stakeholder"); r.status != 422 {
		t.Fatalf("stakeholder→stakeholder %d %s", r.status, r.body)
	}
	if shInvitationState(t, h, company.companyID) != before {
		t.Fatal("refused patch wrote")
	}
	if r := membersPatch(t, h, token, recruiter, "owner"); r.status != 200 || membersRole(t, h, recruiter) != "owner" {
		t.Fatalf("recruiter→owner %d %s", r.status, r.body)
	}
}

// DELETE of a stakeholder goes through the existing removal path: one
// CompanyMemberOffboarded row, no tramo touched.
func TestStakeholderMembers_DeleteIsOffboardedOnce(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	draftListFlowCreate(t, h, owner, `{"fields":{"title":"Untouched"}}`)
	stakeholderID, stakeholderSub := company.addUser(t, "stakeholder")
	membership := memberGuardID(t, h.pool, stakeholderID)
	tramos := func() string {
		var raw string
		if err := h.pool.QueryRow(t.Context(), `SELECT jsonb_build_object('a',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vacancy_assignments a WHERE company_id=$1),'r',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM vacancy_reassignments r WHERE company_id=$1))::text`, company.companyID).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	before := tramos()
	auditBefore := auditCompanyCount(t, h.pool, company.companyID)
	if d := h.do(t, "DELETE", "/me/company/members/"+membership.String(), "", owner.token, nil); d.status != 204 {
		t.Fatalf("delete %d %s", d.status, d.body)
	}
	if membersExist(t, h, membership) || tramos() != before {
		t.Fatal("membership kept or tramos changed")
	}
	if got := auditCompanyCount(t, h.pool, company.companyID); got != auditBefore+1 {
		t.Fatalf("audit rows +%d, want +1", got-auditBefore)
	}
	rows := auditRowsOf(t, h.pool, company.companyID, "CompanyMemberOffboarded")
	if len(rows) != 1 {
		t.Fatalf("rows %d", len(rows))
	}
	assertAuditRow(t, rows[0], wantAuditRow{actor: ownerID, eventType: "CompanyMemberOffboarded", entityType: "company_member", entityID: membership, company: company.companyID, metadata: map[string]any{"company_id": company.companyID.String(), "user_id": stakeholderID.String(), "member_user_id": stakeholderID.String(), "reassignment_ids": []any{}, "ended_assignment_ids": []any{}, "talent_base_viewer_removed": false}})
	shAssertBody(t, h.do(t, "GET", "/me/company", "", h.signer.validToken(t, stakeholderSub), nil), 404, map[string]any{"error": "company member not found", "code": "not_found"})
}

// A stakeholder is never a talent base viewer entry (§1.1); recruiters still are.
func TestStakeholderMembers_NotATalentBaseViewer(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	recruiterID, _ := company.addUser(t, "recruiter")
	stakeholderID, _ := company.addUser(t, "stakeholder")
	current := tbGet(t, h, owner)
	before := shCompanyState(t, h, company.companyID)
	r := tbPut(t, h, owner, current.header.Get("ETag"), tbBody("selected_users", recruiterID, stakeholderID))
	shAssertBody(t, r, 422, map[string]any{"error": "user is not a member of this company", "code": "talent_base_viewer_not_member", "fields": []any{map[string]any{"field": "user_ids[1]", "code": "not_member"}}})
	if shCompanyState(t, h, company.companyID) != before {
		t.Fatal("rejected put wrote")
	}
	editJSONEqual(t, tbViewerIDs(t, tbSet(t, h, owner, "selected_users", recruiterID).body), []string{recruiterID.String()})
}
