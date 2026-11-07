//go:build integration

package main

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Stakeholder invitations (stakeholder-metrics-v1 §1.3, §1.4).

const shInvitationsPath = "/v2/me/company/stakeholder-invitations"
const shAcceptPath = "/v2/me/stakeholder-invitations/accept"

// shFreeUser inserts an employer account with no membership; the company
// fixture removes it.
func shFreeUser(t *testing.T, c *draftFlowCompany) (uuid.UUID, string) {
	t.Helper()
	id, sub := draftFlowInsertUser(t, c.pool)
	c.userIDs = append(c.userIDs, id)
	return id, sub
}

// shInvite creates an invitation and returns its id and url token.
func shInvite(t *testing.T, h *draftFlowHarness, ownerToken string) (uuid.UUID, string) {
	t.Helper()
	r := h.do(t, "POST", shInvitationsPath, "", ownerToken, nil)
	if r.status != http.StatusCreated {
		t.Fatalf("create invitation %d %s", r.status, r.body)
	}
	body := draftFlowObject(t, r.body)
	return draftFlowUUID(t, body["id"].(string)), body["url_token"].(string)
}

func shAccept(t *testing.T, h *draftFlowHarness, token, urlToken string) draftFlowResponse {
	t.Helper()
	return h.do(t, "POST", shAcceptPath, fmt.Sprintf(`{"token":%q}`, urlToken), token, map[string]string{"Content-Type": "application/json"})
}

// shInvitationState is the invitation table, the memberships and the audit
// rows of the company: everything an invitation request may write.
func shInvitationState(t *testing.T, h *draftFlowHarness, company uuid.UUID) string {
	t.Helper()
	var raw string
	if err := h.pool.QueryRow(t.Context(), `SELECT jsonb_build_object(
 'invitations',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM stakeholder_invitations i WHERE company_id=$1),
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM company_members m WHERE company_id=$1),
 'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE company_id=$1))::text`, company).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func shRejected(t *testing.T, h *draftFlowHarness, companies []uuid.UUID, r func() draftFlowResponse, status int, code, message string) {
	t.Helper()
	before := make([]string, len(companies))
	for i, c := range companies {
		before[i] = shInvitationState(t, h, c)
	}
	shAssertBody(t, r(), status, map[string]any{"error": message, "code": code})
	for i, c := range companies {
		if shInvitationState(t, h, c) != before[i] {
			t.Fatal("rejected request changed invitations, members or audit")
		}
	}
}

func TestStakeholderInvitations_CreateAndList(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	start := time.Now().UTC().Add(-time.Second)
	r := h.do(t, "POST", shInvitationsPath, "", token, nil)
	if r.status != 201 || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("create %d %v %s", r.status, r.header, r.body)
	}
	body := orgCandidateKeys(t, draftFlowObject(t, r.body), "id", "url_token", "expires_at", "created_at")
	id := draftFlowUUID(t, body["id"].(string))
	raw, err := base64.RawURLEncoding.DecodeString(body["url_token"].(string))
	if err != nil || len(raw) != 32 {
		t.Fatalf("url_token %q: %v", body["url_token"], err)
	}
	created, err1 := time.Parse(time.RFC3339Nano, body["created_at"].(string))
	expires, err2 := time.Parse(time.RFC3339Nano, body["expires_at"].(string))
	if err1 != nil || err2 != nil || created.Before(start) || !expires.Equal(created.Add(7*24*time.Hour)) {
		t.Fatalf("times %s", r.body)
	}
	// Only the SHA-256 of the token is stored.
	sum := sha256.Sum256([]byte(body["url_token"].(string)))
	var stored []byte
	var createdBy uuid.UUID
	var dbCreated, dbExpires time.Time
	if err := h.pool.QueryRow(t.Context(), `SELECT token_sha256, created_by, created_at, expires_at FROM stakeholder_invitations WHERE id=$1 AND company_id=$2 AND revoked_at IS NULL AND used_at IS NULL AND used_by IS NULL AND member_id IS NULL`, id, company.companyID).Scan(&stored, &createdBy, &dbCreated, &dbExpires); err != nil {
		t.Fatal(err)
	}
	if string(stored) != string(sum[:]) || createdBy != ownerID || !dbCreated.Equal(created) || !dbExpires.Equal(expires) {
		t.Fatal("stored row does not match the response")
	}
	rows := auditRowsOf(t, h.pool, company.companyID, "StakeholderInvitationCreated")
	if len(rows) != 1 {
		t.Fatalf("audit rows %d", len(rows))
	}
	assertAuditRow(t, rows[0], wantAuditRow{actor: ownerID, eventType: "StakeholderInvitationCreated", entityType: "stakeholder_invitation", entityID: id, company: company.companyID, metadata: map[string]any{"invitation_id": id.String(), "expires_at": body["expires_at"]}})

	// The list shows pending invitations only, newest first, never a token.
	revoked, _ := shInvite(t, h, token)
	if d := h.do(t, "DELETE", shInvitationsPath+"/"+revoked.String(), "", token, nil); d.status != 204 {
		t.Fatalf("revoke %d %s", d.status, d.body)
	}
	expired, _ := shInvite(t, h, token)
	if _, err := h.pool.Exec(t.Context(), `UPDATE stakeholder_invitations SET created_at=now()-interval '8 days', expires_at=now()-interval '1 day' WHERE id=$1`, expired); err != nil {
		t.Fatal(err)
	}
	usedID, used := shInvite(t, h, token)
	_, inviteeSub := shFreeUser(t, company)
	if a := shAccept(t, h, h.signer.validToken(t, inviteeSub), used); a.status != 200 {
		t.Fatalf("accept %d %s", a.status, a.body)
	}
	last, _ := shInvite(t, h, token)
	list := h.do(t, "GET", shInvitationsPath, "", token, nil)
	if list.status != 200 || list.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("list %d %s", list.status, list.body)
	}
	items := orgCandidateKeys(t, draftFlowObject(t, list.body), "items")["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("items %s", list.body)
	}
	for i, want := range []uuid.UUID{last, id} {
		item := orgCandidateKeys(t, items[i], "id", "created_at", "created_by", "expires_at")
		if item["id"] != want.String() || item["created_by"] != ownerID.String() {
			t.Fatalf("item %d = %v", i, item)
		}
	}
	editJSONEqual(t, items[1], map[string]any{"id": id.String(), "created_at": body["created_at"], "created_by": ownerID.String(), "expires_at": body["expires_at"]})
	_ = usedID
}

func TestStakeholderInvitations_PendingLimit(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	var first uuid.UUID
	for i := 0; i < 20; i++ {
		id, _ := shInvite(t, h, token)
		if i == 0 {
			first = id
		}
	}
	reject := func() draftFlowResponse { return h.do(t, "POST", shInvitationsPath, "", token, nil) }
	shRejected(t, h, []uuid.UUID{company.companyID}, reject, 422, "invitation_limit_reached", "too many pending invitations")
	// Expired and revoked invitations no longer count.
	if _, err := h.pool.Exec(t.Context(), `UPDATE stakeholder_invitations SET created_at=now()-interval '8 days', expires_at=now()-interval '1 day' WHERE id=$1`, first); err != nil {
		t.Fatal(err)
	}
	second, _ := shInvite(t, h, token)
	shRejected(t, h, []uuid.UUID{company.companyID}, reject, 422, "invitation_limit_reached", "too many pending invitations")
	if d := h.do(t, "DELETE", shInvitationsPath+"/"+second.String(), "", token, nil); d.status != 204 {
		t.Fatal(d.status)
	}
	shInvite(t, h, token)
}

func TestStakeholderInvitations_RevokeIsIdempotent(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	other, _, otherOwnerSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign, _ := shInvite(t, h, h.signer.validToken(t, otherOwnerSub))
	id, urlToken := shInvite(t, h, token)
	if d := h.do(t, "DELETE", shInvitationsPath+"/"+id.String(), "", token, nil); d.status != 204 || len(d.body) != 0 {
		t.Fatalf("revoke %d %s", d.status, d.body)
	}
	rows := auditRowsOf(t, h.pool, company.companyID, "StakeholderInvitationRevoked")
	if len(rows) != 1 {
		t.Fatalf("rows %d", len(rows))
	}
	assertAuditRow(t, rows[0], wantAuditRow{actor: ownerID, eventType: "StakeholderInvitationRevoked", entityType: "stakeholder_invitation", entityID: id, company: company.companyID, metadata: map[string]any{"invitation_id": id.String()}})
	if draftFlowCount(t, h.pool, `SELECT count(*) FROM stakeholder_invitations WHERE id=$1 AND revoked_at IS NOT NULL`, id) != 1 {
		t.Fatal("not revoked")
	}
	// A revoked token no longer joins anyone.
	_, inviteeSub := shFreeUser(t, company)
	invitee := h.signer.validToken(t, inviteeSub)
	shRejected(t, h, []uuid.UUID{company.companyID}, func() draftFlowResponse { return shAccept(t, h, invitee, urlToken) }, 404, "invitation_invalid", "invitation is invalid or expired")

	usedID, used := shInvite(t, h, token)
	if a := shAccept(t, h, invitee, used); a.status != 200 {
		t.Fatalf("accept %d %s", a.status, a.body)
	}
	expired, _ := shInvite(t, h, token)
	if _, err := h.pool.Exec(t.Context(), `UPDATE stakeholder_invitations SET created_at=now()-interval '8 days', expires_at=now()-interval '1 day' WHERE id=$1`, expired); err != nil {
		t.Fatal(err)
	}
	// Revoked again, used, expired, unknown and foreign: 204 and nothing written.
	for _, target := range []uuid.UUID{id, usedID, expired, uuid.New(), foreign} {
		before, beforeOther := shInvitationState(t, h, company.companyID), shInvitationState(t, h, other.companyID)
		d := h.do(t, "DELETE", shInvitationsPath+"/"+target.String(), "", token, nil)
		if d.status != 204 || len(d.body) != 0 {
			t.Fatalf("%s: %d %s", target, d.status, d.body)
		}
		if shInvitationState(t, h, company.companyID) != before || shInvitationState(t, h, other.companyID) != beforeOther {
			t.Fatalf("%s: idempotent revoke wrote", target)
		}
	}
	shRejected(t, h, []uuid.UUID{company.companyID}, func() draftFlowResponse {
		return h.do(t, "DELETE", shInvitationsPath+"/not-a-uuid", "", token, nil)
	}, 400, "invalid_request", "invalid invitation id")
}

func TestStakeholderInvitations_OwnerOnly(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	id, _ := shInvite(t, h, h.signer.validToken(t, ownerSub))
	_, recruiterSub := company.addUser(t, "recruiter")
	_, stakeholderSub := company.addUser(t, "stakeholder")
	for _, sub := range []string{recruiterSub, stakeholderSub} {
		token := h.signer.validToken(t, sub)
		for _, tc := range []struct{ method, path string }{{"POST", shInvitationsPath}, {"GET", shInvitationsPath}, {"DELETE", shInvitationsPath + "/" + id.String()}} {
			shRejected(t, h, []uuid.UUID{company.companyID}, func() draftFlowResponse { return h.do(t, tc.method, tc.path, "", token, nil) }, 403, "forbidden", "insufficient role")
		}
	}
	shRejected(t, h, []uuid.UUID{company.companyID}, func() draftFlowResponse { return h.do(t, "POST", shInvitationsPath, "", "", nil) }, 401, "unauthenticated", "unauthorized")
}

func TestStakeholderInvitations_AcceptAndReplay(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	shReadableCompany(t, h, company.companyID)
	id, urlToken := shInvite(t, h, h.signer.validToken(t, ownerSub))
	inviteeID, inviteeSub := shFreeUser(t, company)
	invitee := h.signer.validToken(t, inviteeSub)
	r := shAccept(t, h, invitee, urlToken)
	if r.status != 200 || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("accept %d %s", r.status, r.body)
	}
	member := memberGuardID(t, h.pool, inviteeID)
	want := map[string]any{"company_id": company.companyID.String(), "member_id": member.String(), "role": "stakeholder"}
	shAssertBody(t, r, 200, want)
	if membersRole(t, h, member) != "stakeholder" {
		t.Fatal("membership role")
	}
	if draftFlowCount(t, h.pool, `SELECT count(*) FROM stakeholder_invitations WHERE id=$1 AND used_at IS NOT NULL AND used_by=$2 AND member_id=$3 AND revoked_at IS NULL`, id, inviteeID, member) != 1 {
		t.Fatal("invitation not marked used")
	}
	accepted := auditRowsOf(t, h.pool, company.companyID, "StakeholderInvitationAccepted")
	added := auditRowsOf(t, h.pool, company.companyID, "CompanyMemberAdded")
	if len(accepted) != 1 || len(added) != 1 {
		t.Fatalf("audit rows accepted=%d added=%d", len(accepted), len(added))
	}
	assertAuditRow(t, accepted[0], wantAuditRow{actor: inviteeID, eventType: "StakeholderInvitationAccepted", entityType: "stakeholder_invitation", entityID: id, company: company.companyID, metadata: map[string]any{"invitation_id": id.String(), "member_user_id": inviteeID.String()}})
	assertAuditRow(t, added[0], wantAuditRow{actor: inviteeID, eventType: "CompanyMemberAdded", entityType: "company_member", entityID: member, company: company.companyID, metadata: map[string]any{"member_user_id": inviteeID.String(), "role": "stakeholder"}})

	// Replay (F2): same body, nothing written again.
	before := shInvitationState(t, h, company.companyID)
	shAssertBody(t, shAccept(t, h, invitee, urlToken), 200, want)
	if shInvitationState(t, h, company.companyID) != before {
		t.Fatal("replay wrote")
	}
	// The new stakeholder now reads its company shell.
	if me := h.do(t, "GET", "/me/company", "", invitee, nil); me.status != 200 || draftFlowObject(t, me.body)["role"] != "stakeholder" {
		t.Fatalf("me/company %d %s", me.status, me.body)
	}

	// Once the membership is removed, the used token is just invalid.
	if d := h.do(t, "DELETE", "/me/company/members/"+member.String(), "", h.signer.validToken(t, ownerSub), nil); d.status != 204 {
		t.Fatalf("remove %d %s", d.status, d.body)
	}
	shRejected(t, h, []uuid.UUID{company.companyID}, func() draftFlowResponse { return shAccept(t, h, invitee, urlToken) }, 404, "invitation_invalid", "invitation is invalid or expired")
}

func TestStakeholderInvitations_AcceptRejections(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	ownerToken := h.signer.validToken(t, ownerSub)
	other, _, _ := draftFlowNewPrincipal(t, h.pool, "active")
	companies := []uuid.UUID{company.companyID, other.companyID}
	_, pending := shInvite(t, h, ownerToken)
	expiredID, expired := shInvite(t, h, ownerToken)
	if _, err := h.pool.Exec(t.Context(), `UPDATE stakeholder_invitations SET created_at=now()-interval '8 days', expires_at=now()-interval '1 second' WHERE id=$1`, expiredID); err != nil {
		t.Fatal(err)
	}
	_, used := shInvite(t, h, ownerToken)
	_, firstSub := shFreeUser(t, company)
	if a := shAccept(t, h, h.signer.validToken(t, firstSub), used); a.status != 200 {
		t.Fatalf("accept %d %s", a.status, a.body)
	}
	_, freeSub := shFreeUser(t, company)
	free := h.signer.validToken(t, freeSub)
	_, candidateSub := sessionInsertUser(t, h, "candidate")
	_, foreignRecruiterSub := other.addUser(t, "recruiter")
	invalid := func(token, urlToken string) func() draftFlowResponse {
		return func() draftFlowResponse { return shAccept(t, h, token, urlToken) }
	}
	const invalidMsg = "invitation is invalid or expired"
	for name, urlToken := range map[string]string{
		"unknown":         base64.RawURLEncoding.EncodeToString(make([]byte, 32)),
		"not base64":      "!!!",
		"wrong length":    base64.RawURLEncoding.EncodeToString([]byte("short")),
		"expired":         expired,
		"used by another": used,
	} {
		t.Run(name, func(t *testing.T) {
			shRejected(t, h, companies, invalid(free, urlToken), 404, "invitation_invalid", invalidMsg)
		})
	}
	shRejected(t, h, companies, invalid(h.signer.validToken(t, candidateSub), pending), 403, "candidate_account", "candidate accounts cannot join a company")
	shRejected(t, h, companies, invalid(h.signer.validToken(t, foreignRecruiterSub), pending), 409, "already_company_member", "user already belongs to a company")
	shRejected(t, h, companies, invalid(ownerToken, pending), 409, "already_company_member", "user already belongs to a company")
	for _, body := range []string{`{}`, `{"token":""}`, `{"token":1}`, `not json`} {
		shRejected(t, h, companies, func() draftFlowResponse {
			return h.do(t, "POST", shAcceptPath, body, free, map[string]string{"Content-Type": "application/json"})
		}, 400, "invalid_request", "invalid request")
	}
	shRejected(t, h, companies, invalid("", pending), 401, "unauthenticated", "unauthorized")
	// The pending invitation is still usable after every rejection.
	if a := shAccept(t, h, free, pending); a.status != 200 {
		t.Fatalf("accept %d %s", a.status, a.body)
	}
	_ = ownerID
}

// Two accepts of one token race on FOR UPDATE: exactly one member.
func TestStakeholderInvitations_ConcurrentAccept(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	_, urlToken := shInvite(t, h, h.signer.validToken(t, ownerSub))
	tokens := make([]string, 4)
	for i := range tokens {
		_, sub := shFreeUser(t, company)
		tokens[i] = h.signer.validToken(t, sub)
	}
	results := make(chan draftFlowCall, len(tokens))
	var wg sync.WaitGroup
	for _, token := range tokens {
		wg.Add(1)
		go func(token string) {
			defer wg.Done()
			resp, err := h.roundTrip("POST", shAcceptPath, fmt.Sprintf(`{"token":%q}`, urlToken), token, map[string]string{"Content-Type": "application/json"})
			results <- draftFlowCall{resp: resp, err: err}
		}(token)
	}
	wg.Wait()
	close(results)
	ok, invalid := 0, 0
	for call := range results {
		if call.err != nil {
			t.Fatal(call.err)
		}
		switch {
		case call.resp.status == 200:
			ok++
		case call.resp.status == 404 && draftFlowCatalogCode(t, call.resp.body) == "invitation_invalid":
			invalid++
		default:
			t.Fatalf("unexpected %d %s", call.resp.status, call.resp.body)
		}
	}
	if ok != 1 || invalid != len(tokens)-1 {
		t.Fatalf("ok=%d invalid=%d", ok, invalid)
	}
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_members WHERE company_id=$1 AND role='stakeholder'`, company.companyID); n != 1 {
		t.Fatalf("stakeholders %d", n)
	}
	if n := len(auditRowsOf(t, h.pool, company.companyID, "StakeholderInvitationAccepted")); n != 1 {
		t.Fatalf("accepted rows %d", n)
	}
}
