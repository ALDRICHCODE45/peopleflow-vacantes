//go:build integration

package main

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// Members (audit-log-v1 §5): add, role change and removal are audited in the
// transaction of the change itself.

func membersAdd(t *testing.T, h *draftFlowHarness, token string, user uuid.UUID, role string) draftFlowResponse {
	t.Helper()
	return h.do(t, http.MethodPost, "/me/company/members", fmt.Sprintf(`{"user_id":%q,"role":%q}`, user, role), token, map[string]string{"Content-Type": "application/json"})
}

func membersPatch(t *testing.T, h *draftFlowHarness, token string, membership uuid.UUID, role string) draftFlowResponse {
	t.Helper()
	return h.do(t, http.MethodPatch, "/me/company/members/"+membership.String(), fmt.Sprintf(`{"role":%q}`, role), token, map[string]string{"Content-Type": "application/json"})
}

func membersRole(t *testing.T, h *draftFlowHarness, membership uuid.UUID) string {
	t.Helper()
	var role string
	if err := h.pool.QueryRow(t.Context(), `SELECT role FROM company_members WHERE id=$1`, membership).Scan(&role); err != nil {
		t.Fatal(err)
	}
	return role
}

func membersExist(t *testing.T, h *draftFlowHarness, membership uuid.UUID) bool {
	t.Helper()
	return draftFlowCount(t, h.pool, `SELECT count(*) FROM company_members WHERE id=$1`, membership) == 1
}

// membersUser inserts a recruiter user with no membership; the company fixture removes it.
func membersUser(t *testing.T, c *draftFlowCompany) uuid.UUID {
	t.Helper()
	id, _ := draftFlowInsertUser(t, c.pool)
	c.userIDs = append(c.userIDs, id)
	return id
}

func TestAuditMembers_AddIsRecorded(t *testing.T) {
	h := newMemberGuardHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	for _, role := range []string{"recruiter", "owner"} {
		user := membersUser(t, company)
		r := membersAdd(t, h, token, user, role)
		if r.status != http.StatusCreated {
			t.Fatalf("add %s: %d %s", role, r.status, r.body)
		}
		membership := draftFlowUUID(t, draftFlowObject(t, r.body)["id"].(string))
		rows := auditRowsWhere(t, h.pool, `company_id=$1 AND event_type='CompanyMemberAdded' AND entity_id=$2`, company.companyID, membership)
		if len(rows) != 1 {
			t.Fatalf("add %s: rows = %d, want 1", role, len(rows))
		}
		assertAuditRow(t, rows[0], wantAuditRow{actor: ownerID, eventType: "CompanyMemberAdded", entityType: "company_member", entityID: membership, company: company.companyID, metadata: map[string]any{"member_user_id": user.String(), "role": role}})
	}
	if n := len(auditRowsOf(t, h.pool, company.companyID, "CompanyMemberAdded")); n != 2 {
		t.Fatalf("rows = %d, want 2", n)
	}
}

func TestAuditMembers_RejectedAddWritesNothing(t *testing.T) {
	h := newMemberGuardHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	candidateID, _ := sessionInsertUser(t, h, "candidate")
	token := h.signer.validToken(t, ownerSub)
	before := auditCompanyCount(t, h.pool, company.companyID)
	members := memberGuardSnapshot(t, h.pool, company.companyID)
	for _, tc := range []struct {
		name, token string
		user        uuid.UUID
		role        string
		status      int
		code        string
	}{
		{"already a member", token, recruiterID, "recruiter", 409, "already_exists"},
		{"unknown user", token, uuid.New(), "recruiter", 404, "not_found"},
		{"candidate target", token, candidateID, "recruiter", 400, "invalid_request"},
		{"invalid role", token, membersUser(t, company), "admin", 400, "invalid_request"},
		{"recruiter cannot add", h.signer.validToken(t, recruiterSub), membersUser(t, company), "recruiter", 403, "forbidden"},
		{"unauthenticated", "", membersUser(t, company), "recruiter", 401, "unauthenticated"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draftFlowAssertCatalogError(t, membersAdd(t, h, tc.token, tc.user, tc.role), tc.status, tc.code)
		})
	}
	if got := auditCompanyCount(t, h.pool, company.companyID); got != before {
		t.Fatalf("rejected adds wrote %d rows", got-before)
	}
	if memberGuardSnapshot(t, h.pool, company.companyID) != members {
		t.Fatal("rejected adds changed membership")
	}
}

func TestAuditMembers_RoleChange(t *testing.T) {
	h := newMemberGuardHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	targetID, targetSub := company.addUser(t, "recruiter")
	target := memberGuardID(t, h.pool, targetID)

	if r := membersPatch(t, h, token, target, "owner"); r.status != 200 {
		t.Fatalf("promote: %d %s", r.status, r.body)
	}
	rows := auditRowsOf(t, h.pool, company.companyID, "CompanyMemberRoleChanged")
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	assertAuditRow(t, rows[0], wantAuditRow{actor: ownerID, eventType: "CompanyMemberRoleChanged", entityType: "company_member", entityID: target, company: company.companyID, metadata: map[string]any{"member_user_id": targetID.String(), "from_role": "recruiter", "to_role": "owner"}})

	// The same role again: the request succeeds as before and nothing is recorded.
	if r := membersPatch(t, h, token, target, "owner"); r.status != 200 {
		t.Fatalf("same role: %d %s", r.status, r.body)
	}
	if n := len(auditRowsOf(t, h.pool, company.companyID, "CompanyMemberRoleChanged")); n != 1 {
		t.Fatalf("a no-op role change wrote a row: %d rows", n)
	}

	// The new owner demotes the old one: attributed to the actor of that request.
	if r := membersPatch(t, h, h.signer.validToken(t, targetSub), memberGuardID(t, h.pool, ownerID), "recruiter"); r.status != 200 {
		t.Fatalf("demote: %d %s", r.status, r.body)
	}
	rows = auditRowsOf(t, h.pool, company.companyID, "CompanyMemberRoleChanged")
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	assertAuditRow(t, rows[1], wantAuditRow{actor: targetID, eventType: "CompanyMemberRoleChanged", entityType: "company_member", entityID: memberGuardID(t, h.pool, ownerID), company: company.companyID, metadata: map[string]any{"member_user_id": ownerID.String(), "from_role": "owner", "to_role": "recruiter"}})
}

func TestAuditMembers_RejectedRoleChangeWritesNothing(t *testing.T) {
	h := newMemberGuardHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	_, foreignID, _ := draftFlowNewPrincipal(t, h.pool, "active")
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	token := h.signer.validToken(t, ownerSub)
	owner := memberGuardID(t, h.pool, ownerID)
	foreign := memberGuardID(t, h.pool, foreignID)
	recruiter := memberGuardID(t, h.pool, recruiterID)
	before := auditCompanyCount(t, h.pool, company.companyID)
	members := memberGuardSnapshot(t, h.pool, company.companyID)
	for _, tc := range []struct {
		name, token string
		membership  uuid.UUID
		role        string
		status      int
		code        string
	}{
		{"last owner demoted", token, owner, "recruiter", 409, "last_owner"},
		{"invalid role", token, recruiter, "admin", 400, "invalid_request"},
		{"unknown membership", token, uuid.New(), "owner", 404, "not_found"},
		{"foreign membership", token, foreign, "recruiter", 404, "not_found"},
		{"recruiter cannot change roles", h.signer.validToken(t, recruiterSub), recruiter, "owner", 403, "forbidden"},
		{"unauthenticated", "", recruiter, "owner", 401, "unauthenticated"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draftFlowAssertCatalogError(t, membersPatch(t, h, tc.token, tc.membership, tc.role), tc.status, tc.code)
		})
	}
	if got := auditCompanyCount(t, h.pool, company.companyID); got != before {
		t.Fatalf("rejected role changes wrote %d rows", got-before)
	}
	if memberGuardSnapshot(t, h.pool, company.companyID) != members {
		t.Fatal("rejected role changes changed membership")
	}
}

// Both removal routes record CompanyMemberOffboarded with the removed user.
func TestAuditMembers_RemovalPaths(t *testing.T) {
	for _, path := range []string{"delete", "offboard"} {
		t.Run(path, func(t *testing.T) {
			h := newMemberGuardHarness(t)
			company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
			leaverID, _ := company.addUser(t, "recruiter")
			membership := memberGuardID(t, h.pool, leaverID)
			token := h.signer.validToken(t, ownerSub)
			base := "/me/company/members/" + membership.String()
			var r draftFlowResponse
			if path == "delete" {
				r = h.do(t, http.MethodDelete, base, "", token, nil)
				if r.status != http.StatusNoContent {
					t.Fatalf("delete: %d %s", r.status, r.body)
				}
			} else {
				r = h.do(t, http.MethodPost, base+"/offboard", `{}`, token, map[string]string{"Idempotency-Key": uuid.NewString()})
				if r.status != 200 {
					t.Fatalf("offboard: %d %s", r.status, r.body)
				}
			}
			rows := auditRowsOf(t, h.pool, company.companyID, "CompanyMemberOffboarded")
			if len(rows) != 1 {
				t.Fatalf("rows = %d, want 1", len(rows))
			}
			assertAuditRow(t, rows[0], wantAuditRow{actor: ownerID, eventType: "CompanyMemberOffboarded", entityType: "company_member", entityID: membership, company: company.companyID, metadata: map[string]any{
				"company_id": company.companyID.String(), "user_id": leaverID.String(), "member_user_id": leaverID.String(),
				"reassignment_ids": []any{}, "ended_assignment_ids": []any{}, "talent_base_viewer_removed": false,
			}})
		})
	}
}

func TestAuditMembers_RejectedRemovalWritesNothing(t *testing.T) {
	h := newMemberGuardHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	_, foreignID, _ := draftFlowNewPrincipal(t, h.pool, "active")
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	token := h.signer.validToken(t, ownerSub)
	owner := memberGuardID(t, h.pool, ownerID)
	foreign := memberGuardID(t, h.pool, foreignID)
	recruiter := memberGuardID(t, h.pool, recruiterID)
	before := auditCompanyCount(t, h.pool, company.companyID)
	members := memberGuardSnapshot(t, h.pool, company.companyID)
	for _, tc := range []struct {
		name, method, suffix, token string
		membership                  uuid.UUID
		status                      int
		code                        string
	}{
		{"delete last owner", http.MethodDelete, "", token, owner, 409, "last_owner"},
		{"offboard last owner", http.MethodPost, "/offboard", token, owner, 409, "last_owner"},
		{"delete unknown", http.MethodDelete, "", token, uuid.New(), 404, "not_found"},
		{"offboard unknown", http.MethodPost, "/offboard", token, uuid.New(), 404, "not_found"},
		{"delete foreign", http.MethodDelete, "", token, foreign, 404, "not_found"},
		{"offboard foreign", http.MethodPost, "/offboard", token, foreign, 404, "not_found"},
		{"recruiter cannot delete", http.MethodDelete, "", h.signer.validToken(t, recruiterSub), recruiter, 403, "forbidden"},
		{"unauthenticated", http.MethodDelete, "", "", recruiter, 401, "unauthenticated"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := h.do(t, tc.method, "/me/company/members/"+tc.membership.String()+tc.suffix, `{}`, tc.token, map[string]string{"Idempotency-Key": uuid.NewString()})
			draftFlowAssertCatalogError(t, r, tc.status, tc.code)
		})
	}
	if got := auditCompanyCount(t, h.pool, company.companyID); got != before {
		t.Fatalf("rejected removals wrote %d rows", got-before)
	}
	if memberGuardSnapshot(t, h.pool, company.companyID) != members {
		t.Fatal("rejected removals changed membership")
	}
}

// An audit failure rolls the change back: no member added, no role changed, no
// member removed.
func TestAuditMembers_AuditFailureRollsTheChangeBack(t *testing.T) {
	h := newMemberGuardHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	targetID, _ := company.addUser(t, "recruiter")
	target := memberGuardID(t, h.pool, targetID)
	newUser := membersUser(t, company)
	members := memberGuardSnapshot(t, h.pool, company.companyID)

	allow := auditBlock(t, h.pool, company.companyID, "CompanyMemberAdded", "CompanyMemberRoleChanged", "CompanyMemberOffboarded")
	draftFlowAssertCatalogError(t, membersAdd(t, h, token, newUser, "recruiter"), 500, "internal_error")
	draftFlowAssertCatalogError(t, membersPatch(t, h, token, target, "owner"), 500, "internal_error")
	draftFlowAssertCatalogError(t, h.do(t, http.MethodDelete, "/me/company/members/"+target.String(), "", token, nil), 500, "internal_error")
	draftFlowAssertCatalogError(t, h.do(t, http.MethodPost, "/me/company/members/"+target.String()+"/offboard", `{}`, token, map[string]string{"Idempotency-Key": uuid.NewString()}), 500, "internal_error")
	if memberGuardSnapshot(t, h.pool, company.companyID) != members {
		t.Fatal("a failed audit did not roll the membership change back")
	}
	if got := membersRole(t, h, target); got != "recruiter" || !membersExist(t, h, target) {
		t.Fatalf("target after failed audits: role %q", got)
	}
	if n := auditCompanyCount(t, h.pool, company.companyID); n != 0 {
		t.Fatalf("failed audits left %d rows", n)
	}

	allow()
	if r := membersAdd(t, h, token, newUser, "recruiter"); r.status != http.StatusCreated {
		t.Fatalf("add after unblocking: %d %s", r.status, r.body)
	}
	if r := membersPatch(t, h, token, target, "owner"); r.status != 200 {
		t.Fatalf("role change after unblocking: %d %s", r.status, r.body)
	}
}

// The plain removeMember handler is only registered when no offboard handler is
// composed (main.go always composes one). It still audits, so a mis-wired
// composition cannot silently drop the event.
func TestAuditMembers_PlainRemoveFallbackAudits(t *testing.T) {
	h := newMemberGuardHarnessWithoutOffboard(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	leaverID, _ := company.addUser(t, "recruiter")
	membership := memberGuardID(t, h.pool, leaverID)
	token := h.signer.validToken(t, ownerSub)
	if r := h.do(t, http.MethodDelete, "/me/company/members/"+membership.String(), "", token, nil); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	rows := auditRowsOf(t, h.pool, company.companyID, "CompanyMemberOffboarded")
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	assertAuditRow(t, rows[0], wantAuditRow{actor: ownerID, eventType: "CompanyMemberOffboarded", entityType: "company_member", entityID: membership, company: company.companyID, metadata: map[string]any{
		"company_id": company.companyID.String(), "user_id": leaverID.String(), "member_user_id": leaverID.String(),
		"reassignment_ids": []any{}, "ended_assignment_ids": []any{}, "talent_base_viewer_removed": false,
	}})

	// Last owner: refused, nothing recorded.
	before := auditCompanyCount(t, h.pool, company.companyID)
	draftFlowAssertCatalogError(t, h.do(t, http.MethodDelete, "/me/company/members/"+memberGuardID(t, h.pool, ownerID).String(), "", token, nil), 409, "last_owner")
	if got := auditCompanyCount(t, h.pool, company.companyID); got != before {
		t.Fatalf("a refused removal wrote %d rows", got-before)
	}

	// Audit failure: the member stays.
	other, _ := company.addUser(t, "recruiter")
	otherMembership := memberGuardID(t, h.pool, other)
	auditBlock(t, h.pool, company.companyID, "CompanyMemberOffboarded")
	draftFlowAssertCatalogError(t, h.do(t, http.MethodDelete, "/me/company/members/"+otherMembership.String(), "", token, nil), 500, "internal_error")
	if !membersExist(t, h, otherMembership) {
		t.Fatal("a failed audit did not roll the removal back")
	}
}
