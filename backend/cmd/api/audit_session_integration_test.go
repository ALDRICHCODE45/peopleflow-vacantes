//go:build integration

package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
	"github.com/google/uuid"
)

// Sessions (audit-log-v1 §3): the BFF reports a sign-in and a clicked sign-out;
// only users with a company membership are recorded.

const sessionProxySecret = "session-test-secret-0123456789abcdef0123456789"

var sessionEvents = []struct{ path, eventType string }{
	{"/v2/me/session/start", "SessionStarted"},
	{"/v2/me/session/end", "SessionEnded"},
}

func newSessionHarness(t *testing.T) *draftFlowHarness {
	t.Helper()
	pool := requireDraftFlowPool(t)
	signer := newDraftFlowSigner(t)
	open := func(next http.Handler) http.Handler { return next }
	router := newRouter(routerDeps{
		requireAuth:      identityhttp.RequireAuth(signer.verifier),
		requireCandidate: open, requireRecruiter: open, requireOwner: open,
		requestMeta: requestmeta.Middleware(requestmeta.Config{ProxySecret: sessionProxySecret}),
		queries:     db.New(pool), pool: pool,
		sessionHandler: newSessionHandler(pool, auditpostgres.NewAuditEventRepository()),
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return &draftFlowHarness{pool: pool, server: server, client: server.Client(), signer: signer}
}

func sessionCount(t *testing.T, h *draftFlowHarness) int {
	t.Helper()
	return draftFlowCount(t, h.pool, `SELECT count(*) FROM audit_events WHERE event_type IN ('SessionStarted','SessionEnded')`)
}

func sessionInsertUser(t *testing.T, h *draftFlowHarness, userType string) (uuid.UUID, string) {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	sub := "session-" + id.String()
	if _, err := h.pool.Exec(context.Background(), `INSERT INTO users (id, cognito_sub, email, full_name, user_type) VALUES ($1,$2,$3,'Session User',$4)`, id, sub, sub+"@example.test", userType); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := auditDeleteActor(h.pool, id); err != nil {
			t.Error(err)
		}
		if _, err := h.pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, id); err != nil {
			t.Error(err)
		}
	})
	return id, sub
}

func TestAuditSession_StartAndEndRecordMembers(t *testing.T) {
	h := newSessionHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	for _, member := range []struct {
		role string
		id   uuid.UUID
		sub  string
	}{{"owner", ownerID, ownerSub}, {"recruiter", recruiterID, recruiterSub}} {
		for _, tc := range sessionEvents {
			t.Run(member.role+" "+tc.eventType, func(t *testing.T) {
				before := len(auditRowsOf(t, h.pool, company.companyID, tc.eventType))
				r := h.do(t, http.MethodPost, tc.path, "", h.signer.validToken(t, member.sub), map[string]string{"User-Agent": "T5-Test/1.0"})
				if r.status != http.StatusNoContent || len(r.body) != 0 {
					t.Fatalf("status %d body %q, want 204 and no body", r.status, r.body)
				}
				draftFlowAssertNoStore(t, r)
				rows := auditRowsOf(t, h.pool, company.companyID, tc.eventType)
				if len(rows) != before+1 {
					t.Fatalf("rows = %d, want %d", len(rows), before+1)
				}
				got := rows[before]
				assertAuditRow(t, got, wantAuditRow{actor: member.id, eventType: tc.eventType, entityType: "user", entityID: member.id, company: company.companyID, metadata: map[string]any{}})
				if got.IPSource == nil || *got.IPSource != "peer" || got.IP == nil || *got.IP != "127.0.0.1" || got.UserAgent == nil || *got.UserAgent != "T5-Test/1.0" {
					t.Errorf("request meta = %v %v %v, want peer 127.0.0.1 T5-Test/1.0", got.IPSource, got.IP, got.UserAgent)
				}
			})
		}
	}
}

func TestAuditSession_ClientDataComesFromTheBFFOnlyWithTheSecret(t *testing.T) {
	h := newSessionHarness(t)
	company, _, sub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, sub)
	forged := map[string]string{"X-PF-Client-IP": "6.6.6.6", "X-PF-Client-User-Agent": "Forged/1.0", "User-Agent": "Real/2.0"}
	trusted := map[string]string{"X-PF-Proxy-Secret": sessionProxySecret, "X-PF-Client-IP": "201.141.12.7", "X-PF-Client-User-Agent": "Mozilla/5.0 T5", "User-Agent": "node"}
	for _, headers := range []map[string]string{forged, trusted} {
		if r := h.do(t, http.MethodPost, "/v2/me/session/start", "", token, headers); r.status != http.StatusNoContent {
			t.Fatalf("status %d", r.status)
		}
	}
	rows := auditRowsOf(t, h.pool, company.companyID, "SessionStarted")
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	if *rows[0].IPSource != "peer" || *rows[0].IP != "127.0.0.1" || *rows[0].UserAgent != "Real/2.0" {
		t.Errorf("forged headers were trusted: %v %v %v", *rows[0].IPSource, *rows[0].IP, *rows[0].UserAgent)
	}
	if *rows[1].IPSource != "bff" || *rows[1].IP != "201.141.12.7" || *rows[1].UserAgent != "Mozilla/5.0 T5" {
		t.Errorf("bff headers were not used: %v %v %v", *rows[1].IPSource, *rows[1].IP, *rows[1].UserAgent)
	}
}

// Project convention for body-less POST actions (psychometric revoke/link,
// site unpublish): the body is not read, so a client that sends one is served.
func TestAuditSession_BodyIsIgnored(t *testing.T) {
	h := newSessionHarness(t)
	company, _, sub := draftFlowNewPrincipal(t, h.pool, "active")
	r := h.do(t, http.MethodPost, "/v2/me/session/start", `{"unexpected":true}`, h.signer.validToken(t, sub), map[string]string{"Content-Type": "application/json"})
	if r.status != http.StatusNoContent || len(r.body) != 0 {
		t.Fatalf("status %d body %q", r.status, r.body)
	}
	if n := len(auditRowsOf(t, h.pool, company.companyID, "SessionStarted")); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
}

func TestAuditSession_NoMembershipRecordsNothing(t *testing.T) {
	h := newSessionHarness(t)
	candidateID, candidateSub := sessionInsertUser(t, h, "candidate")
	// A recruiter user without a membership, and a deleted member, are not recorded either.
	loneID, loneSub := sessionInsertUser(t, h, "recruiter")
	company, _, _ := draftFlowNewPrincipal(t, h.pool, "active")
	deletedID, deletedSub := company.addUser(t, "recruiter")
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET deleted_at=now() WHERE id=$1`, deletedID); err != nil {
		t.Fatal(err)
	}
	subs := map[string]string{
		"candidate": candidateSub, "recruiter without membership": loneSub, "deleted user": deletedSub,
		"unknown user": "session-unknown-" + uuid.NewString(),
	}
	before := sessionCount(t, h)
	beforeActors := draftFlowCount(t, h.pool, `SELECT count(*) FROM audit_events WHERE actor_id = ANY($1)`, []uuid.UUID{candidateID, loneID, deletedID})
	for name, sub := range subs {
		for _, tc := range sessionEvents {
			t.Run(name+" "+tc.eventType, func(t *testing.T) {
				r := h.do(t, http.MethodPost, tc.path, "", h.signer.validToken(t, sub), nil)
				if r.status != http.StatusNoContent || len(r.body) != 0 {
					t.Fatalf("status %d body %q, want 204 and no body", r.status, r.body)
				}
				draftFlowAssertNoStore(t, r)
			})
		}
	}
	if got := sessionCount(t, h); got != before {
		t.Fatalf("session rows changed by %d, want 0", got-before)
	}
	if got := draftFlowCount(t, h.pool, `SELECT count(*) FROM audit_events WHERE actor_id = ANY($1)`, []uuid.UUID{candidateID, loneID, deletedID}); got != beforeActors {
		t.Fatalf("rows for users without a membership: %d", got-beforeActors)
	}
}

func TestAuditSession_Rejections(t *testing.T) {
	h := newSessionHarness(t)
	company, _, sub := draftFlowNewPrincipal(t, h.pool, "active")
	before := auditCompanyCount(t, h.pool, company.companyID)
	for _, tc := range sessionEvents {
		t.Run(tc.eventType, func(t *testing.T) {
			draftFlowAssertError(t, h.do(t, http.MethodPost, tc.path, "", "", nil), 401, "unauthenticated")
			draftFlowAssertError(t, h.do(t, http.MethodPost, tc.path, "", h.signer.expiredToken(t, sub), nil), 401, "unauthenticated")
			for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete, http.MethodPatch} {
				if r := h.do(t, method, tc.path, "", h.signer.validToken(t, sub), nil); r.status != http.StatusMethodNotAllowed {
					t.Errorf("%s: status %d, want 405", method, r.status)
				}
			}
		})
	}
	if got := auditCompanyCount(t, h.pool, company.companyID); got != before {
		t.Fatalf("rejected requests wrote %d rows", got-before)
	}
}

// A failing audit insert fails the call (the BFF logs it and goes on) and
// leaves no row.
func TestAuditSession_FailClosed(t *testing.T) {
	h := newSessionHarness(t)
	company, _, sub := draftFlowNewPrincipal(t, h.pool, "active")
	allow := auditBlock(t, h.pool, company.companyID, "SessionStarted", "SessionEnded")
	for _, tc := range sessionEvents {
		draftFlowAssertError(t, h.do(t, http.MethodPost, tc.path, "", h.signer.validToken(t, sub), nil), 500, "internal_error")
	}
	if n := auditCompanyCount(t, h.pool, company.companyID); n != 0 {
		t.Fatalf("rows = %d, want 0", n)
	}
	allow()
	for _, tc := range sessionEvents {
		if r := h.do(t, http.MethodPost, tc.path, "", h.signer.validToken(t, sub), nil); r.status != http.StatusNoContent {
			t.Fatalf("%s after unblocking: %d", tc.path, r.status)
		}
	}
}
