//go:build integration

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	companiesusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/http"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	geopostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/postgres"
	identityusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/userinfo"
	"github.com/google/uuid"
)

// employerFlowHarness is the real router over DRAFT_TEST_DATABASE_URL (via
// requireDraftFlowPool; never DATABASE_URL) with both onboardings and the
// unchanged company creation/membership routes.
func employerFlowHarness(t *testing.T, provider identityusecases.UserInfoProvider, audit auditrepositories.AuditEventRepository) *draftFlowHarness {
	t.Helper()
	pool := requireDraftFlowPool(t)
	signer := newDraftFlowSigner(t)
	q := db.New(pool)
	users := identitypostgres.NewUserRepository(q)
	members := companiespostgres.NewCompanyMemberRepository(pool, auditpostgres.NewAuditEventRepository())
	companies := companiespostgres.NewCompanyRepository(pool, auditpostgres.NewAuditEventRepository())
	r := newRouter(routerDeps{
		requireAuth: identityhttp.RequireAuth(signer.verifier), requireCandidate: identityhttp.RequireCandidateRole(users),
		requireRecruiter: identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.RecruiterRole),
		requireOwner:     identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.OwnerRole),
		identityHandler:  identityhttp.NewCandidateIdentityHandler(identityusecases.NewCandidateIdentity(identitypostgres.NewCandidateAccountStore(pool, audit), provider)),
		// Production wiring of POST /companies (main.go NewCompanyServiceWithBootstrap).
		companyHandler: companieshttp.NewCompanyHandler(companiesusecases.NewCompanyServiceWithBootstrap(companies, users, companiespostgres.NewCompanyBootstrapRepository(pool), geopostgres.NewReader(q))),
		memberHandler:  companieshttp.NewMemberHandler(companiesusecases.NewCompanyMemberService(members, users, companies, geopostgres.NewReader(q))),
	})
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return &draftFlowHarness{pool: pool, server: server, client: server.Client(), signer: signer}
}

// employerAuditCount counts one event type; global counts also catch orphans
// (audit_events has no FK).
func employerAuditCount(t *testing.T, h *draftFlowHarness, eventType string) int {
	t.Helper()
	var n int
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE event_type=$1`, eventType).Scan(&n); err != nil {
		t.Fatal("count audits failed")
	}
	return n
}

func employerCounts(t *testing.T, h *draftFlowHarness, sub string) (users, audits int) {
	t.Helper()
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE cognito_sub=$1`, sub).Scan(&users); err != nil {
		t.Fatal("count users failed")
	}
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE event_type IN ('EmployerAccountCreated','CandidateAccountCreated') AND entity_id IN (SELECT id FROM users WHERE cognito_sub=$1)`, sub).Scan(&audits); err != nil {
		t.Fatal("count audits failed")
	}
	return users, audits
}

func employerAssertCounts(t *testing.T, h *draftFlowHarness, sub string, wantUsers, wantAudits int) {
	t.Helper()
	if u, a := employerCounts(t, h, sub); u != wantUsers || a != wantAudits {
		t.Fatalf("effects users/audits=%d/%d want %d/%d", u, a, wantUsers, wantAudits)
	}
}

// verifiedProvider answers a verified identity for sub/email and counts calls.
func verifiedProvider(t *testing.T, sub, email string, hits *atomic.Int32) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"sub": sub, "email": email, "email_verified": true})
	}))
	t.Cleanup(s.Close)
	return s
}

func employerRFC() string {
	return "E" + strings.ToUpper(strings.ReplaceAll(uuid.NewString(), "-", ""))[:11]
}

// embedded-auth-v1 D1–D4: every rejection writes nothing; the 201 writes one
// recruiter row and one EmployerAccountCreated in the same transaction; an
// audit failure rolls the insert back; a retry is a read-only 200.
func TestEmployerIdentityFlowOutcomes(t *testing.T) {
	requireDraftFlowPool(t)
	for _, tc := range []struct {
		name, body, provider  string
		status                int
		code                  string
		noProvider, failAudit bool
	}{
		{name: "created", body: `{"full_name":" Laura Gómez "}`, status: 201},
		{name: "invalid name", body: `{"full_name":"界"}`, status: 400, code: "validation_error"},
		{name: "unknown key", body: `{"full_name":"Laura","role":"recruiter"}`, status: 400, code: "invalid_request"},
		{name: "duplicate key", body: `{"full_name":"Laura","full_name":"Other"}`, status: 400, code: "invalid_request"},
		{name: "unverified", body: `{"full_name":"Laura"}`, provider: "unverified", status: 422, code: "email_not_verified"},
		{name: "mismatch", body: `{"full_name":"Laura"}`, provider: "mismatch", status: 422, code: "email_not_verified"},
		{name: "malformed", body: `{"full_name":"Laura"}`, provider: "malformed", status: 503, code: "identity_unavailable"},
		{name: "unreachable", body: `{"full_name":"Laura"}`, provider: "unreachable", status: 503, code: "identity_unavailable"},
		{name: "unconfigured", body: `{"full_name":"Laura"}`, noProvider: true, status: 503, code: "identity_unavailable"},
		{name: "audit failure rolls back", body: `{"full_name":"Laura"}`, failAudit: true, status: 500, code: "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sub := "employer-flow-" + uuid.NewString()
			email := sub + "@example.test"
			var hits atomic.Int32
			var token string
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits.Add(1)
				if r.Header.Get("Authorization") != "Bearer "+token {
					t.Error("not caller access token")
				}
				subject, verified := sub, true
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
			h := employerFlowHarness(t, client, audit)
			token = h.signer.validToken(t, sub)
			before := employerAuditCount(t, h, "EmployerAccountCreated")
			resp := h.do(t, "POST", "/v2/me/employer-account", tc.body, token, nil)
			identityAssertResponse(t, resp, tc.status, tc.code)
			if tc.status != 201 {
				employerAssertCounts(t, h, sub, 0, 0)
				if n := employerAuditCount(t, h, "EmployerAccountCreated"); n != before {
					t.Fatalf("audit count %d want %d", n, before)
				}
				return
			}
			employerAssertCounts(t, h, sub, 1, 1)
			var id, actorID, entityID uuid.UUID
			var role, actorType, entityType, metadata string
			var companyNull, vacancyNull bool
			err := h.pool.QueryRow(context.Background(), `SELECT u.id,u.user_type,a.actor_type,a.actor_id,a.entity_type,a.entity_id,a.metadata::text,a.company_id IS NULL,a.vacancy_id IS NULL
				FROM users u JOIN audit_events a ON a.entity_id=u.id AND a.event_type='EmployerAccountCreated' WHERE u.cognito_sub=$1`, sub).
				Scan(&id, &role, &actorType, &actorID, &entityType, &entityID, &metadata, &companyNull, &vacancyNull)
			if err != nil || role != "recruiter" || actorType != "user" || actorID != id || entityType != "user" || entityID != id || metadata != "{}" || !companyNull || !vacancyNull {
				t.Fatalf("incorrect row/audit: %v %s %s %s %s", err, role, actorType, entityType, metadata)
			}
			want, _ := json.Marshal(map[string]any{"role": "recruiter", "user": map[string]any{"id": id.String(), "email": email, "full_name": "Laura Gómez"}})
			if !identityJSONEqual(resp.body, want) {
				t.Fatalf("wrong exact body %s", resp.body)
			}
			get := h.do(t, "GET", "/v2/me", "", token, nil)
			identityAssertResponse(t, get, 200, "")
			if !identityJSONEqual(get.body, resp.body) {
				t.Fatal("GET /v2/me differs from the 201 body")
			}
			callsBefore := hits.Load()
			retry := h.do(t, "POST", "/v2/me/employer-account", `{"full_name":"Changed Name"}`, token, nil)
			identityAssertResponse(t, retry, 200, "")
			if !identityJSONEqual(retry.body, resp.body) || hits.Load() != callsBefore {
				t.Fatal("retry changed the account or called the provider")
			}
			employerAssertCounts(t, h, sub, 1, 1)
			if n := employerAuditCount(t, h, "EmployerAccountCreated"); n != before+1 {
				t.Fatalf("audit count %d want %d", n, before+1)
			}
		})
	}
}

// D2: same-subject candidate → 409 account_exists (both directions); an
// existing recruiter → 200 without a provider call; another account's email →
// 409 email_in_use. None writes a row or an audit.
func TestEmployerIdentityFlowConflicts(t *testing.T) {
	pool := requireDraftFlowPool(t)
	recruiterID, recruiterSub := draftFlowInsertUser(t, pool)
	var recruiterEmail, recruiterName string
	if err := pool.QueryRow(context.Background(), `SELECT email,full_name FROM users WHERE id=$1`, recruiterID).Scan(&recruiterEmail, &recruiterName); err != nil {
		t.Fatal(err)
	}
	candidateID := uuid.New()
	candidateSub := "employer-conflict-candidate-" + candidateID.String()
	if _, err := pool.Exec(context.Background(), `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate')`, candidateID, candidateSub, candidateSub+"@example.test"); err != nil {
		t.Fatal(err)
	}
	newSub := "employer-conflict-new-" + uuid.NewString()
	var hits atomic.Int32
	provider := verifiedProvider(t, newSub, recruiterEmail, &hits)
	h := employerFlowHarness(t, userinfo.NewClient(provider.URL, time.Second), auditpostgres.NewAuditEventRepository())
	beforeEmployer, beforeCandidate := employerAuditCount(t, h, "EmployerAccountCreated"), employerAuditCount(t, h, "CandidateAccountCreated")

	resp := h.do(t, "POST", "/v2/me/employer-account", `{"full_name":"Laura"}`, h.signer.validToken(t, candidateSub), nil)
	identityAssertResponse(t, resp, 409, "account_exists")
	resp = h.do(t, "POST", "/v2/me/candidate-account", `{"full_name":"Laura"}`, h.signer.validToken(t, recruiterSub), nil)
	identityAssertResponse(t, resp, 409, "account_exists")
	resp = h.do(t, "POST", "/v2/me/employer-account", `{"full_name":"Renamed"}`, h.signer.validToken(t, recruiterSub), nil)
	identityAssertResponse(t, resp, 200, "")
	want, _ := json.Marshal(map[string]any{"role": "recruiter", "user": map[string]any{"id": recruiterID.String(), "email": recruiterEmail, "full_name": recruiterName}})
	if !identityJSONEqual(resp.body, want) {
		t.Fatalf("existing recruiter body %s", resp.body)
	}
	if hits.Load() != 0 {
		t.Fatal("existing accounts called the provider")
	}
	resp = h.do(t, "POST", "/v2/me/employer-account", `{"full_name":"Laura"}`, h.signer.validToken(t, newSub), nil)
	identityAssertResponse(t, resp, 409, "email_in_use")
	if hits.Load() != 1 {
		t.Fatalf("provider calls %d want 1", hits.Load())
	}
	employerAssertCounts(t, h, newSub, 0, 0)
	employerAssertCounts(t, h, recruiterSub, 1, 0)
	employerAssertCounts(t, h, candidateSub, 1, 0)
	var name, role string
	if err := pool.QueryRow(context.Background(), `SELECT full_name,user_type FROM users WHERE id=$1`, recruiterID).Scan(&name, &role); err != nil || name != recruiterName || role != "recruiter" {
		t.Fatal("recruiter mutated")
	}
	if employerAuditCount(t, h, "EmployerAccountCreated") != beforeEmployer || employerAuditCount(t, h, "CandidateAccountCreated") != beforeCandidate {
		t.Fatal("conflicts wrote audits")
	}
}

// Idempotency under concurrency: n first calls of one subject create one row
// and one audit; every loser is a 200 with the winner's body.
func TestEmployerIdentityFlowConcurrentOnboarding(t *testing.T) {
	requireDraftFlowPool(t)
	sub := "employer-race-" + uuid.NewString()
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
	h := employerFlowHarness(t, userinfo.NewClient(provider.URL, 5*time.Second), auditpostgres.NewAuditEventRepository())
	token := h.signer.validToken(t, sub)
	before := employerAuditCount(t, h, "EmployerAccountCreated")
	out := make(chan draftFlowCall, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			r, e := h.roundTrip("POST", "/v2/me/employer-account", fmt.Sprintf(`{"full_name":"Employer %d"}`, i), token, nil)
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
		switch r.status {
		case 201:
			created++
		case 200:
		default:
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
	employerAssertCounts(t, h, sub, 1, 1)
	if got := employerAuditCount(t, h, "EmployerAccountCreated"); got != before+1 {
		t.Fatalf("audits %d want %d", got, before+1)
	}
}

// A concurrent candidate and employer onboarding of one subject: exactly one
// wins (201 with its own audit), the other is 409 account_exists.
func TestEmployerIdentityFlowCrossRoleRace(t *testing.T) {
	requireDraftFlowPool(t)
	sub := "cross-race-" + uuid.NewString()
	var arrived atomic.Int32
	release := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if arrived.Add(1) == 2 {
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
	h := employerFlowHarness(t, userinfo.NewClient(provider.URL, 5*time.Second), auditpostgres.NewAuditEventRepository())
	token := h.signer.validToken(t, sub)
	out := make(chan struct {
		path string
		call draftFlowCall
	}, 2)
	for _, path := range []string{"/v2/me/employer-account", "/v2/me/candidate-account"} {
		go func(path string) {
			r, e := h.roundTrip("POST", path, `{"full_name":"Racer"}`, token, nil)
			out <- struct {
				path string
				call draftFlowCall
			}{path, draftFlowCall{resp: r, err: e}}
		}(path)
	}
	statuses := map[int]string{}
	for i := 0; i < 2; i++ {
		res := <-out
		if res.call.err != nil {
			t.Fatal(res.call.err)
		}
		statuses[res.call.resp.status] = res.path
		if res.call.resp.status == 409 {
			identityAssertResponse(t, res.call.resp, 409, "account_exists")
		}
	}
	winner, ok := statuses[201]
	if _, lost := statuses[409]; !ok || !lost {
		t.Fatalf("statuses %v", statuses)
	}
	wantRole, wantEvent := "recruiter", "EmployerAccountCreated"
	if winner == "/v2/me/candidate-account" {
		wantRole, wantEvent = "candidate", "CandidateAccountCreated"
	}
	var role, event string
	if err := h.pool.QueryRow(context.Background(), `SELECT u.user_type,a.event_type FROM users u JOIN audit_events a ON a.entity_id=u.id WHERE u.cognito_sub=$1`, sub).Scan(&role, &event); err != nil || role != wantRole || event != wantEvent {
		t.Fatalf("winner %s: role %s event %s err %v", winner, role, event, err)
	}
	employerAssertCounts(t, h, sub, 1, 1)
}

// The store-level race re-check (candidateAccountStore email branch): a
// same-subject row committed while the insert waits beats its own email
// collision → existing row, created=false, no audit; another subject's email
// is ErrEmailTaken with nothing written.
func TestEmployerAccountStoreSameSubjectRaceRecheck(t *testing.T) {
	pool := requireDraftFlowPool(t)
	ctx := context.Background()
	audit := auditpostgres.NewAuditEventRepository()
	store := identitypostgres.NewCandidateAccountStore(pool, audit)
	sub := "store-race-" + uuid.NewString()
	emailStr := sub + "@example.test"
	email, _ := valueobjects.NewEmail(emailStr)
	name, _ := valueobjects.NewFullName("Store Race")
	winnerID := uuid.New()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Winner','recruiter')`, winnerID, sub, emailStr); err != nil {
		t.Fatal(err)
	}
	loser, _ := entities.NewUser(sub, email, name, valueobjects.UserRecruiter)
	type result struct {
		u       *entities.User
		created bool
		err     error
	}
	done := make(chan result, 1)
	go func() {
		u, created, err := store.CreateAccount(ctx, loser)
		done <- result{u, created, err}
	}()
	time.Sleep(200 * time.Millisecond) // let the insert block on the uncommitted winner
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	res := <-done
	if res.err != nil || res.created || res.u == nil || res.u.ID != winnerID {
		t.Fatalf("race loser: %+v", res)
	}
	var audits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1`, winnerID).Scan(&audits); err != nil || audits != 0 {
		t.Fatalf("loser wrote audit: %d %v", audits, err)
	}

	otherSub := "store-email-" + uuid.NewString()
	other, _ := entities.NewUser(otherSub, email, name, valueobjects.UserRecruiter)
	if _, _, err := store.CreateAccount(ctx, other); !errors.Is(err, entities.ErrEmailTaken) {
		t.Fatalf("email taken: %v", err)
	}
	var users int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE cognito_sub=$1`, otherSub).Scan(&users); err != nil || users != 0 {
		t.Fatal("email collision wrote a row")
	}
}

// D3: the employer account is only the user row; POST /companies stays
// unchanged and now succeeds for the new employer, who becomes owner.
func TestEmployerIdentityFlowThenCreateCompany(t *testing.T) {
	requireDraftFlowPool(t)
	sub := "employer-company-" + uuid.NewString()
	email := sub + "@example.test"
	var hits atomic.Int32
	provider := verifiedProvider(t, sub, email, &hits)
	h := employerFlowHarness(t, userinfo.NewClient(provider.URL, time.Second), auditpostgres.NewAuditEventRepository())
	token := h.signer.validToken(t, sub)
	company := fmt.Sprintf(`{"name":"Empresa Embedded","rfc":%q,"industry_id":"technology"}`, employerRFC())

	before := h.do(t, "POST", "/companies", company, token, nil)
	if before.status != 401 {
		t.Fatalf("POST /companies before onboarding: %d %s", before.status, before.body)
	}
	onboard := h.do(t, "POST", "/v2/me/employer-account", `{"full_name":"Laura Gómez"}`, token, nil)
	identityAssertResponse(t, onboard, 201, "")
	if r := h.do(t, "GET", "/me/company", "", token, nil); r.status != 404 {
		t.Fatalf("GET /me/company before company: %d %s", r.status, r.body)
	}
	created := h.do(t, "POST", "/companies", company, token, nil)
	if created.status != 201 {
		t.Fatalf("POST /companies after onboarding: %d %s", created.status, created.body)
	}
	var c struct{ ID string }
	if err := json.Unmarshal(created.body, &c); err != nil || c.ID == "" {
		t.Fatalf("company body %s", created.body)
	}
	var memberRole string
	if err := h.pool.QueryRow(context.Background(), `SELECT m.role FROM company_members m JOIN users u ON u.id=m.user_id WHERE u.cognito_sub=$1 AND m.company_id=$2`, sub, c.ID).Scan(&memberRole); err != nil || memberRole != "owner" {
		t.Fatalf("membership %q %v", memberRole, err)
	}
	if r := h.do(t, "GET", "/me/company", "", token, nil); r.status != 200 {
		t.Fatalf("GET /me/company after company: %d %s", r.status, r.body)
	}
	me := h.do(t, "GET", "/v2/me", "", token, nil)
	if !identityJSONEqual(me.body, onboard.body) {
		t.Fatalf("/v2/me changed after POST /companies: %s", me.body)
	}

	candidateSub := "candidate-company-" + uuid.NewString()
	cp := verifiedProvider(t, candidateSub, candidateSub+"@example.test", &hits)
	hc := employerFlowHarness(t, userinfo.NewClient(cp.URL, time.Second), auditpostgres.NewAuditEventRepository())
	ct := hc.signer.validToken(t, candidateSub)
	identityAssertResponse(t, hc.do(t, "POST", "/v2/me/candidate-account", `{"full_name":"Ana"}`, ct, nil), 201, "")
	if r := hc.do(t, "POST", "/companies", fmt.Sprintf(`{"name":"No","rfc":%q,"industry_id":"technology"}`, employerRFC()), ct, nil); r.status != 403 {
		t.Fatalf("candidate POST /companies: %d %s", r.status, r.body)
	}
}
