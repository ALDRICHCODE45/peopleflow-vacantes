//go:build integration

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	applicationsusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/usecases"
	applicationshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http"
	applicationspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	candidatesusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/usecases"
	candidateshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/http"
	candidatespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/postgres"
	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	identityusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/userinfo"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Uses the existing isolated loopback/draft_test guard; never DATABASE_URL.
func identityFlowHarness(t *testing.T, provider identityusecases.UserInfoProvider, audit auditrepositories.AuditEventRepository) *draftFlowHarness {
	t.Helper()
	pool := requireDraftFlowPool(t)
	signer := newDraftFlowSigner(t)
	q := db.New(pool)
	users := identitypostgres.NewUserRepository(q)
	members := companiespostgres.NewCompanyMemberRepository(q)
	companies := companiespostgres.NewCompanyRepository(pool, audit)
	r := newRouter(routerDeps{
		requireAuth: identityhttp.RequireAuth(signer.verifier), requireCandidate: identityhttp.RequireCandidateRole(users),
		requireRecruiter:   identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.RecruiterRole),
		requireOwner:       identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.OwnerRole),
		identityHandler:    identityhttp.NewCandidateIdentityHandler(identityusecases.NewCandidateIdentity(identitypostgres.NewCandidateAccountStore(pool, audit), provider)),
		candidateHandler:   candidateshttp.NewCandidateHandler(candidatesusecases.NewCandidateService(candidatespostgres.NewCandidateRepository(pool), users)),
		applicationHandler: applicationshttp.NewApplicationHandler(applicationsusecases.NewApplicationService(applicationspostgres.NewApplicationRepository(pool, audit), users)),
	})
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return &draftFlowHarness{pool: pool, server: server, client: server.Client(), signer: signer}
}
func identityCounts(t *testing.T, h *draftFlowHarness, sub string) (int, int) {
	t.Helper()
	var users, audits int
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE cognito_sub=$1`, sub).Scan(&users); err != nil {
		t.Fatal("count users failed")
	}
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE event_type='CandidateAccountCreated' AND entity_id IN (SELECT id FROM users WHERE cognito_sub=$1)`, sub).Scan(&audits); err != nil {
		t.Fatal("count audits failed")
	}
	return users, audits
}

// Global event counts also detect orphan audits (audit_events has no FK).
func identityAuditCount(t *testing.T, h *draftFlowHarness) int {
	t.Helper()
	var n int
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE event_type='CandidateAccountCreated'`).Scan(&n); err != nil {
		t.Fatal("count all identity audits failed")
	}
	return n
}
func identityAssertAuditCount(t *testing.T, h *draftFlowHarness, want int) {
	t.Helper()
	if n := identityAuditCount(t, h); n != want {
		t.Fatalf("identity audit count=%d want %d", n, want)
	}
}
func identityAssertCounts(t *testing.T, h *draftFlowHarness, sub string, wantUsers, wantAudits int) {
	t.Helper()
	users, audits := identityCounts(t, h, sub)
	if users != wantUsers || audits != wantAudits {
		t.Fatalf("effects users/audits=%d/%d want %d/%d", users, audits, wantUsers, wantAudits)
	}
}
func identityAssertResponse(t *testing.T, r draftFlowResponse, status int, code string) {
	t.Helper()
	if r.status != status || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("status/headers=%d %v body %s", r.status, r.header, r.body)
	}
	if code != "" {
		var b map[string]any
		if json.Unmarshal(r.body, &b) != nil || len(b) != 2 || b["code"] != code || b["error"] == nil {
			t.Fatalf("bad envelope %s", r.body)
		}
	}
}

// §11.2–11.3: every rejection has zero users and zero audits; retries cannot rename.
func TestCandidateIdentityFlowOutcomes(t *testing.T) {
	requireDraftFlowPool(t)
	for _, tc := range []struct {
		name, body, provider  string
		status                int
		code                  string
		noProvider, failAudit bool
	}{
		{name: "created", body: `{"full_name":" Ana Pérez "}`, status: 201},
		{name: "invalid name", body: `{"full_name":"界"}`, status: 400, code: "validation_error"},
		{name: "unknown key", body: `{"full_name":"Ana","email":"a@example.com"}`, status: 400, code: "invalid_request"},
		{name: "duplicate key", body: `{"full_name":"Ana","full_name":"Other"}`, status: 400, code: "invalid_request"},
		{name: "unverified", body: `{"full_name":"Ana"}`, provider: "unverified", status: 422, code: "email_not_verified"},
		{name: "mismatch", body: `{"full_name":"Ana"}`, provider: "mismatch", status: 422, code: "email_not_verified"},
		{name: "malformed", body: `{"full_name":"Ana"}`, provider: "malformed", status: 503, code: "identity_unavailable"},
		{name: "unreachable", body: `{"full_name":"Ana"}`, provider: "unreachable", status: 503, code: "identity_unavailable"},
		{name: "unconfigured", body: `{"full_name":"Ana"}`, noProvider: true, status: 503, code: "identity_unavailable"},
		{name: "audit failure", body: `{"full_name":"Ana"}`, failAudit: true, status: 500, code: "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sub := "candidate-flow-" + uuid.NewString()
			email := sub + "@example.test"
			var token string
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer "+token {
					t.Error("not caller access token")
				}
				subject := sub
				verified := true
				if tc.provider == "mismatch" {
					subject = "other"
				}
				if tc.provider == "unverified" {
					verified = false
				}
				if tc.provider == "malformed" {
					_, _ = w.Write([]byte(`{`))
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"sub": subject, "email": email, "email_verified": verified})
			}))
			defer provider.Close()
			if tc.provider == "unreachable" {
				provider.Close()
			}
			var client identityusecases.UserInfoProvider = userinfo.NewClient(provider.URL, time.Second)
			if tc.noProvider {
				client = nil
			}
			var audit auditrepositories.AuditEventRepository = auditpostgres.NewAuditEventRepository()
			if tc.failAudit {
				audit = identityFailAudit{}
			}
			h := identityFlowHarness(t, client, audit)
			token = h.signer.validToken(t, sub)
			beforeAudits := identityAuditCount(t, h)
			resp := h.do(t, "POST", "/v2/me/candidate-account", tc.body, token, nil)
			identityAssertResponse(t, resp, tc.status, tc.code)
			if tc.status != 201 {
				identityAssertCounts(t, h, sub, 0, 0)
				identityAssertAuditCount(t, h, beforeAudits)
				return
			}
			identityAssertCounts(t, h, sub, 1, 1)
			var id uuid.UUID
			var actorType, eventType, entityType, metadata string
			var actorID, entityID uuid.UUID
			err := h.pool.QueryRow(context.Background(), `SELECT u.id,a.actor_type,a.actor_id,a.event_type,a.entity_type,a.entity_id,a.metadata::text FROM users u JOIN audit_events a ON a.entity_id=u.id WHERE u.cognito_sub=$1`, sub).Scan(&id, &actorType, &actorID, &eventType, &entityType, &entityID, &metadata)
			if err != nil || actorType != "user" || actorID != id || entityID != id || eventType != "CandidateAccountCreated" || entityType != "user" || metadata != "{}" {
				t.Fatal("incorrect audit")
			}
			var want map[string]any = map[string]any{"role": "candidate", "user": map[string]any{"id": id.String(), "email": email, "full_name": "Ana Pérez"}}
			b, _ := json.Marshal(want)
			if !identityJSONEqual(resp.body, b) {
				t.Fatalf("wrong exact body %s", resp.body)
			}
			get := h.do(t, "GET", "/v2/me", "", token, nil)
			identityAssertResponse(t, get, 200, "")
			if !identityJSONEqual(get.body, resp.body) {
				t.Fatal("GET differs")
			}
			retry := h.do(t, "POST", "/v2/me/candidate-account", `{"full_name":"Changed Name"}`, token, nil)
			identityAssertResponse(t, retry, 200, "")
			if !identityJSONEqual(retry.body, resp.body) {
				t.Fatal("retry changed account")
			}
			identityAssertCounts(t, h, sub, 1, 1)
			identityAssertAuditCount(t, h, beforeAudits+1)
		})
	}
}
func identityJSONEqual(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	aa, _ := json.Marshal(x)
	bb, _ := json.Marshal(y)
	return string(aa) == string(bb)
}

type identityFailAudit struct{}

func (identityFailAudit) Append(context.Context, pgx.Tx, auditentities.AuditEvent) error {
	return errors.New("test audit unavailable")
}

func TestCandidateIdentityFlowEmailAndRoleConflicts(t *testing.T) {
	pool := requireDraftFlowPool(t)
	id, existingSub := draftFlowInsertUser(t, pool)
	var email string
	if err := pool.QueryRow(context.Background(), `SELECT email FROM users WHERE id=$1`, id).Scan(&email); err != nil {
		t.Fatal(err)
	}
	sub := "candidate-flow-" + uuid.NewString()
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"sub": sub, "email": email, "email_verified": true})
	}))
	defer provider.Close()
	h := identityFlowHarness(t, userinfo.NewClient(provider.URL, time.Second), auditpostgres.NewAuditEventRepository())
	beforeAudits := identityAuditCount(t, h)
	get := h.do(t, "GET", "/v2/me", "", h.signer.validToken(t, sub), nil)
	identityAssertResponse(t, get, 200, "")
	if !identityJSONEqual(get.body, []byte(`{"role":null,"user":null}`)) {
		t.Fatal("unknown body")
	}
	resp := h.do(t, "POST", "/v2/me/candidate-account", `{"full_name":"Ana"}`, h.signer.validToken(t, sub), nil)
	identityAssertResponse(t, resp, 409, "email_in_use")
	identityAssertCounts(t, h, sub, 0, 0)
	identityAssertCounts(t, h, existingSub, 1, 0)
	resp = h.do(t, "POST", "/v2/me/candidate-account", `{"full_name":"Ana"}`, h.signer.validToken(t, existingSub), nil)
	identityAssertResponse(t, resp, 409, "account_exists")
	identityAssertCounts(t, h, existingSub, 1, 0)
	var name, role string
	if err := pool.QueryRow(context.Background(), `SELECT full_name,user_type FROM users WHERE id=$1`, id).Scan(&name, &role); err != nil || name != "Draft Flow" || role != "recruiter" {
		t.Fatal("recruiter mutated")
	}
	get = h.do(t, "GET", "/v2/me", "", h.signer.validToken(t, existingSub), nil)
	b, _ := json.Marshal(map[string]any{"role": "recruiter", "user": map[string]any{"id": id.String(), "email": email, "full_name": name}})
	identityAssertResponse(t, get, 200, "")
	if !identityJSONEqual(get.body, b) {
		t.Fatal("recruiter body")
	}
	identityAssertAuditCount(t, h, beforeAudits)
}

// Synchronize provider responses so all requests observe no account before
// insertion. Exactly one 201; all concurrent losers are read-only 200 retries.
func TestCandidateIdentityFlowConcurrentOnboarding(t *testing.T) {
	requireDraftFlowPool(t)
	sub := "candidate-race-" + uuid.NewString()
	const n = 8
	var arrived atomic.Int32
	release := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if arrived.Add(1) == n {
			close(release)
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"sub": sub, "email": sub + "@example.test", "email_verified": true})
	}))
	defer provider.Close()
	h := identityFlowHarness(t, userinfo.NewClient(provider.URL, 5*time.Second), auditpostgres.NewAuditEventRepository())
	token := h.signer.validToken(t, sub)
	beforeAudits := identityAuditCount(t, h)
	out := make(chan draftFlowCall, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			r, e := h.roundTrip("POST", "/v2/me/candidate-account", fmt.Sprintf(`{"full_name":"Candidate %d"}`, i), token, nil)
			out <- draftFlowCall{resp: r, err: e}
		}(i)
	}
	created := 0
	var first []byte
	for i := 0; i < n; i++ {
		result := <-out
		if result.err != nil {
			t.Fatal(result.err)
		}
		r := result.resp
		if r.status == 201 {
			created++
		} else if r.status != 200 {
			t.Fatalf("loser=%d %s", r.status, r.body)
		}
		identityAssertResponse(t, r, r.status, "")
		if first == nil {
			first = r.body
		} else if !identityJSONEqual(first, r.body) {
			t.Fatal("race produced different accounts")
		}
	}
	if created != 1 {
		t.Fatalf("created=%d", created)
	}
	identityAssertCounts(t, h, sub, 1, 1)
	identityAssertAuditCount(t, h, beforeAudits+1)
}

// §11.2/S21 and agreement notes: every legacy candidate route is gated;
// candidate requests retain previous behavior, company authorization unchanged.
func TestCandidateIdentityFlowLegacyAndCompanyGates(t *testing.T) {
	pool := requireDraftFlowPool(t)
	h := identityFlowHarness(t, nil, auditpostgres.NewAuditEventRepository())
	candidateID := uuid.New()
	candidateSub := "candidate-gate-" + candidateID.String()
	_, err := pool.Exec(context.Background(), `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate')`, candidateID, candidateSub, candidateSub+"@example.test")
	if err != nil {
		t.Fatal(err)
	}
	_, recruiterSub := draftFlowInsertUser(t, pool)
	unknownSub := "unknown-" + uuid.NewString()
	paths := []struct {
		method, path, body string
		candidateStatus    int
	}{
		{"GET", "/me/profile/", "", 404}, {"PUT", "/me/profile/", `{}`, 200},
		{"GET", "/me/profile/languages/", "", 200}, {"PUT", "/me/profile/languages/", `{"languages":[]}`, 200},
		{"GET", "/me/applications", "", 200}, {"POST", "/jobs/not-a-uuid/applications", `{}`, 400},
	}
	for _, actor := range []struct{ name, sub, code string }{{"recruiter", recruiterSub, "wrong_role"}, {"unknown", unknownSub, "account_required"}, {"candidate", candidateSub, ""}} {
		for _, route := range paths {
			t.Run(actor.name+route.method+route.path, func(t *testing.T) {
				r := h.do(t, route.method, route.path, route.body, h.signer.validToken(t, actor.sub), nil)
				status := 403
				if actor.code == "" {
					status = route.candidateStatus
				}
				identityAssertResponse(t, r, status, actor.code)
			})
		}
	}
	identityAssertCounts(t, h, recruiterSub, 1, 0)
	identityAssertCounts(t, h, unknownSub, 0, 0)
	identityAssertCounts(t, h, candidateSub, 1, 0)
	// These company routes fail in the unchanged membership gate before a handler.
	for _, path := range []string{"/me/company/members", "/v2/me/company/job-drafts"} {
		for _, actor := range []struct {
			sub, code string
			status    int
		}{{unknownSub, "unauthenticated", 401}, {candidateSub, "forbidden", 403}, {recruiterSub, "forbidden", 403}} {
			r := h.do(t, "GET", path, "", h.signer.validToken(t, actor.sub), nil)
			var body map[string]any
			_ = json.Unmarshal(r.body, &body)
			if r.status != actor.status || len(body) != 2 || body["code"] != actor.code {
				t.Fatalf("company gate changed: %d %s", r.status, r.body)
			}
		}
	}
	// Soft-deleted candidates are no live account, not a role from a token.
	if _, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at=now() WHERE id=$1`, candidateID); err != nil {
		t.Fatal(err)
	}
	r := h.do(t, "GET", "/v2/me", "", h.signer.validToken(t, candidateSub), nil)
	if !identityJSONEqual(r.body, []byte(`{"role":null,"user":null}`)) {
		t.Fatal("tombstone exposed")
	}
	r = h.do(t, "GET", "/me/applications", "", h.signer.validToken(t, candidateSub), nil)
	identityAssertResponse(t, r, 403, "account_required")
}
