//go:build integration

package main

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// Stakeholder role gate (stakeholder-metrics-v1 §1.2): fail closed on every
// recruiter and owner route, answer only the routes the contract lists.

// shCompanyState is every row a rejected stakeholder request could touch.
func shCompanyState(t *testing.T, h *draftFlowHarness, company uuid.UUID) string {
	t.Helper()
	var raw string
	if err := h.pool.QueryRow(t.Context(), `SELECT jsonb_build_object(
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM company_members m WHERE company_id=$1),
 'company',(SELECT to_jsonb(c) FROM companies c WHERE id=$1),
 'drafts',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM job_drafts d WHERE company_id=$1),
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vacancy_assignments a WHERE company_id=$1),
 'invitations',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM stakeholder_invitations i WHERE company_id=$1),
 'viewers',(SELECT jsonb_agg(to_jsonb(v) ORDER BY user_id) FROM company_talent_base_viewers v WHERE company_id=$1),
 'audit',(SELECT count(*) FROM audit_events WHERE company_id=$1))::text`, company).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

// shReadableCompany gives the fixture company a valid RFC: the shared fixture
// RFC is 32 characters and GET /me/company rehydrates a valid company.
func shReadableCompany(t *testing.T, h *draftFlowHarness, company uuid.UUID) {
	t.Helper()
	if _, err := h.pool.Exec(t.Context(), `UPDATE companies SET rfc=upper(right(replace(id::text,'-',''),12)) WHERE id=$1`, company); err != nil {
		t.Fatal(err)
	}
}

// shAssertBody compares a JSON response body with want, key by key.
func shAssertBody(t *testing.T, r draftFlowResponse, status int, want map[string]any) {
	t.Helper()
	if r.status != status {
		t.Fatalf("status = %d, want %d; body=%s", r.status, status, r.body)
	}
	editJSONEqual(t, draftFlowObject(t, r.body), want)
}

func TestStakeholderGate_RejectsRecruiterAndOwnerRoutes(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	recruiterID, _ := company.addUser(t, "recruiter")
	_, stakeholderSub := company.addUser(t, "stakeholder")
	token := h.signer.validToken(t, stakeholderSub)
	draft := draftListFlowCreate(t, h, owner, `{"fields":{"title":"Gate"}}`)
	member := memberGuardID(t, h.pool, recruiterID).String()
	json := map[string]string{"Content-Type": "application/json"}
	before := shCompanyState(t, h, company.companyID)
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/me/company/members", ""},
		{"POST", "/me/company/members", fmt.Sprintf(`{"user_id":%q,"role":"recruiter"}`, uuid.New())},
		{"PATCH", "/me/company/members/" + member, `{"role":"owner"}`},
		{"DELETE", "/me/company/members/" + member, ""},
		{"GET", "/me/company/members/" + member + "/offboard-preview", ""},
		{"POST", "/me/company/members/" + member + "/offboard", `{}`},
		{"PATCH", "/me/company", `{"name":"Stakeholder Co"}`},
		{"DELETE", "/me/company", ""},
		{"POST", "/me/company/job-drafts", `{}`},
		{"GET", "/me/company/requesters", ""},
		{"POST", "/me/company/requesters", `{"kind":"client","name":"Acme"}`},
		{"GET", "/v2/me/company/job-drafts", ""},
		{"POST", "/v2/me/company/job-drafts", `{"fields":{}}`},
		{"GET", "/v2/me/company/dashboard", ""},
		{"GET", "/v2/me/vacancy-assignments/history", ""},
		{"GET", "/v2/me/company/job-drafts/" + draft, ""},
		{"PATCH", "/v2/me/company/job-drafts/" + draft, `{"fields":{}}`},
		{"GET", "/v2/me/company/job-drafts/" + draft + "/team", ""},
		{"POST", "/v2/me/company/job-drafts/" + draft + "/team/members", fmt.Sprintf(`{"user_id":%q}`, recruiterID)},
		{"GET", "/v2/me/company/job-drafts/" + draft + "/board", ""},
		{"GET", "/v2/me/company/job-drafts/" + draft + "/pipeline/delivery/status", ""},
		{"POST", "/v2/me/company/job-drafts/" + draft + "/lifecycle/close", `{}`},
		{"GET", "/v2/me/company/candidates", ""},
		{"GET", "/v2/me/company/talent-base-visibility", ""},
		{"PUT", "/v2/me/company/talent-base-visibility", `{"mode":"all_recruiters","user_ids":[]}`},
		{"GET", "/v2/me/company/site", ""},
		{"POST", "/v2/me/company/site/publish", ""},
		{"GET", "/v2/me/company/audit-events", ""},
		{"GET", "/v2/me/company/stakeholder-invitations", ""},
		{"POST", "/v2/me/company/stakeholder-invitations", ""},
		{"DELETE", "/v2/me/company/stakeholder-invitations/" + uuid.NewString(), ""},
		{"POST", "/jobs", `{}`},
		{"PATCH", "/jobs/" + uuid.NewString(), `{}`},
		{"GET", "/jobs/" + uuid.NewString() + "/applications", ""},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			r := h.do(t, tc.method, tc.path, tc.body, token, json)
			shAssertBody(t, r, http.StatusForbidden, map[string]any{"error": "insufficient role", "code": "forbidden"})
		})
	}
	if shCompanyState(t, h, company.companyID) != before {
		t.Fatal("rejected stakeholder requests changed company state")
	}
	// Candidate-only routes keep refusing an employer account.
	draftFlowAssertCatalogError(t, h.do(t, "GET", "/me/applications", "", token, nil), 403, "wrong_role")
}

func TestStakeholderGate_AnswersContractRoutes(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, _ := draftFlowNewPrincipal(t, h.pool, "active")
	shReadableCompany(t, h, company.companyID)
	stakeholderID, stakeholderSub := company.addUser(t, "stakeholder")
	token := h.signer.validToken(t, stakeholderSub)

	me := h.do(t, "GET", "/v2/me", "", token, nil)
	shAssertBody(t, me, 200, map[string]any{"role": "recruiter", "user": map[string]any{"id": stakeholderID.String(), "email": stakeholderSub + "@example.test", "full_name": "Draft Flow"}})

	r := h.do(t, "GET", "/me/company", "", token, nil)
	if r.status != 200 {
		t.Fatalf("GET /me/company %d %s", r.status, r.body)
	}
	body := draftFlowObject(t, r.body)
	if body["role"] != "stakeholder" || body["company_id"] != company.companyID.String() {
		t.Fatal(string(r.body))
	}
	editJSONEqual(t, body["can"], map[string]any{"view_talent_base": false, "view_metrics": true})

	for _, tc := range sessionEvents {
		before := len(auditRowsOf(t, h.pool, company.companyID, tc.eventType))
		if s := h.do(t, "POST", tc.path, "", token, nil); s.status != http.StatusNoContent {
			t.Fatalf("%s %d %s", tc.path, s.status, s.body)
		}
		if got := len(auditRowsOf(t, h.pool, company.companyID, tc.eventType)); got != before+1 {
			t.Fatalf("%s rows %d, want %d", tc.eventType, got, before+1)
		}
	}
	if p := h.do(t, "GET", "/v2/jobs", "", token, nil); p.status != 200 {
		t.Fatalf("public jobs %d %s", p.status, p.body)
	}
}

// can.view_metrics follows the role; the talent base flag keeps its rule for
// owners and recruiters and is always false for a stakeholder, whatever the mode.
func TestMeCompany_CapabilitiesByRole(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	shReadableCompany(t, h, company.companyID)
	_, recruiterSub := company.addUser(t, "recruiter")
	_, stakeholderSub := company.addUser(t, "stakeholder")
	can := func(sub string) any {
		t.Helper()
		r := h.do(t, "GET", "/me/company", "", h.signer.validToken(t, sub), nil)
		if r.status != 200 {
			t.Fatalf("%d %s", r.status, r.body)
		}
		return draftFlowObject(t, r.body)["can"]
	}
	editJSONEqual(t, can(ownerSub), map[string]any{"view_talent_base": true, "view_metrics": true})
	editJSONEqual(t, can(recruiterSub), map[string]any{"view_talent_base": true, "view_metrics": false})
	editJSONEqual(t, can(stakeholderSub), map[string]any{"view_talent_base": false, "view_metrics": true})
	tbSet(t, h, owner, "selected_users")
	editJSONEqual(t, can(recruiterSub), map[string]any{"view_talent_base": false, "view_metrics": false})
	editJSONEqual(t, can(stakeholderSub), map[string]any{"view_talent_base": false, "view_metrics": true})
}

// Owners and recruiters keep the access they had (no route changed for them).
func TestStakeholderGate_OwnerAndRecruiterUnchanged(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	_, recruiterSub := company.addUser(t, "recruiter")
	ownerToken, recruiterToken := h.signer.validToken(t, ownerSub), h.signer.validToken(t, recruiterSub)
	for _, path := range []string{"/me/company/members", "/v2/me/company/job-drafts", "/v2/me/company/audit-events", "/v2/me/company/stakeholder-invitations"} {
		if r := h.do(t, "GET", path, "", ownerToken, nil); r.status != 200 {
			t.Fatalf("owner %s: %d %s", path, r.status, r.body)
		}
	}
	for _, path := range []string{"/me/company/members", "/v2/me/company/job-drafts"} {
		if r := h.do(t, "GET", path, "", recruiterToken, nil); r.status != 200 {
			t.Fatalf("recruiter %s: %d %s", path, r.status, r.body)
		}
	}
	for _, path := range []string{"/v2/me/company/audit-events", "/v2/me/company/stakeholder-invitations"} {
		shAssertBody(t, h.do(t, "GET", path, "", recruiterToken, nil), 403, map[string]any{"error": "insufficient role", "code": "forbidden"})
	}
}

// GET /me/company/members lists stakeholders with their role (F1), for owners
// and recruiters alike.
func TestMembersList_IncludesStakeholders(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	stakeholderID, _ := company.addUser(t, "stakeholder")
	want := map[string]string{ownerID.String(): "owner", recruiterID.String(): "recruiter", stakeholderID.String(): "stakeholder"}
	for _, sub := range []string{ownerSub, recruiterSub} {
		r := h.do(t, "GET", "/me/company/members", "", h.signer.validToken(t, sub), nil)
		if r.status != 200 {
			t.Fatalf("%d %s", r.status, r.body)
		}
		got := map[string]string{}
		for _, raw := range draftFlowObject(t, r.body)["members"].([]any) {
			m := raw.(map[string]any)
			got[m["user"].(map[string]any)["id"].(string)] = m["role"].(string)
		}
		editJSONEqual(t, got, want)
	}
}
