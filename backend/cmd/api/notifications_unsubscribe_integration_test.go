//go:build integration

// Notifications v2 public unsubscribe (docs/contracts/notifications-v2.md D15–D17,
// §Unsubscribe, §Limits) through the production router: GET reports what would be
// turned off and never writes; POST upserts email = false (source 'unsubscribe') for
// the token's (user, company, type), idempotently; every invalid token — malformed,
// bad MAC, unknown kid, expired, mandatory or wrong-tree type, user or company gone,
// user of the other tree — answers the same 422 unsubscribe_link_invalid bytes and
// writes nothing; the per-IP limit keys on requestmeta's trusted client IP. No
// session is read. Same disposable draft_test_mig_* harness as the other
// notifications tests.
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/unsubscribe"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	notifUnsubPath    = "/v2/notifications/unsubscribe"
	notifUnsubInvalid = `{"error":"unsubscribe link invalid","code":"unsubscribe_link_invalid"}` + "\n"
	notifUnsubBFF     = "unsub-bff-proxy-value"
)

var notifUnsubKey = bytes.Repeat([]byte{0x5A}, 32)

// unsubWorld adds an unsubscribe server (signer with kid "k1", optional limiter)
// to the notifications world.
type unsubWorld struct {
	*notifWorld
	signer *unsubscribe.Signer
	unsub  *httptest.Server
	now    time.Time
}

func newUnsubWorld(t *testing.T, limits unsubscribe.Limits) *unsubWorld {
	t.Helper()
	w := &unsubWorld{notifWorld: newNotifWorld(t), now: time.Now()}
	signer, err := newNotificationUnsubscribeSigner(unsubKeysConfig(), func() time.Time { return w.now })
	if err != nil {
		t.Fatal(err)
	}
	w.signer = signer
	w.unsub = newUnsubServer(t, w.pool, w.notifWorld.signer, signer, limits)
	return w
}

// newUnsubServer is the production router with the real gates (as newNotifServer)
// plus the unsubscribe handler, its limiter and requestmeta with a BFF secret.
func newUnsubServer(t *testing.T, pool *pgxpool.Pool, sessions *draftFlowSigner, signer *unsubscribe.Signer, limits unsubscribe.Limits) *httptest.Server {
	t.Helper()
	queries := db.New(pool)
	users := identitypostgres.NewUserRepository(queries)
	members := companiespostgres.NewCompanyMemberRepository(pool, auditpostgres.NewAuditEventRepository())
	companies := companiespostgres.NewCompanyRepository(pool, auditpostgres.NewAuditEventRepository())
	router := newRouter(routerDeps{
		requireAuth:                    identityhttp.RequireAuth(sessions.verifier),
		requireCandidate:               identityhttp.RequireCandidateRole(users),
		requireRecruiter:               identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.RecruiterRole),
		requireOwner:                   identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.OwnerRole),
		requireDocumentReader:          identityhttp.RequireDocumentReader(users, members, companies),
		notificationUnsubscribeHandler: newNotificationUnsubscribeHandler(pool, signer),
		notificationUnsubscribeLimit:   unsubscribe.NewLimiter(limits, nil).Middleware,
		requestMeta:                    requestmeta.Middleware(requestmeta.Config{ProxySecret: notifUnsubBFF}),
		queries:                        queries,
		pool:                           pool,
		readinessTimeout:               2 * time.Second,
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return server
}

func unsubKeysConfig() runtimeconfig.NotificationsEmailConfig {
	return runtimeconfig.NotificationsEmailConfig{Mailer: runtimeconfig.MailerLog,
		UnsubscribeKeys: runtimeconfig.UnsubscribeKeys{{ID: "k1", Secret: notifUnsubKey}}}
}

func (w *unsubWorld) token(t *testing.T, user, company uuid.UUID, typ domain.Type) string {
	t.Helper()
	tok, err := w.signer.Sign(domain.PreferenceKey{User: user, Company: company, Type: typ})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// forgeUnsub builds a token with a valid MAC for an arbitrary payload (contract
// formula), to reach the checks after the MAC.
func forgeUnsub(secret []byte, kid, payload string) string {
	p := base64.RawURLEncoding.EncodeToString([]byte(payload))
	h := hmac.New(sha256.New, secret)
	h.Write([]byte("pf-notif-unsub:v1:" + kid + "." + p))
	return kid + "." + p + "." + base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

type unsubCall struct {
	method, query, contentType, body string
	headers                          map[string]string
}

func (w *unsubWorld) call(t *testing.T, c unsubCall) notifResponse {
	t.Helper()
	req, err := http.NewRequest(c.method, w.unsub.URL+notifUnsubPath+c.query, strings.NewReader(c.body))
	if err != nil {
		t.Fatal(err)
	}
	if c.contentType != "" {
		req.Header.Set("Content-Type", c.contentType)
	}
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	resp, err := w.unsub.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return notifResponse{status: resp.StatusCode, header: resp.Header.Clone(), body: raw}
}

func (w *unsubWorld) getUnsub(t *testing.T, token string) notifResponse {
	return w.call(t, unsubCall{method: http.MethodGet, query: "?token=" + url.QueryEscape(token)})
}

// postUnsub sends the RFC 8058 one-click body, as the frontend route forwards it.
func (w *unsubWorld) postUnsub(t *testing.T, token string) notifResponse {
	return w.call(t, unsubCall{method: http.MethodPost, query: "?token=" + url.QueryEscape(token),
		contentType: "application/x-www-form-urlencoded", body: "List-Unsubscribe=One-Click"})
}

func wantUnsub(t *testing.T, what string, r notifResponse, status int, body string) {
	t.Helper()
	if r.status != status || string(r.body) != body {
		t.Fatalf("%s: %d %s\nwant %d %s", what, r.status, r.body, status, body)
	}
	if r.header.Get("Cache-Control") != "no-store" || r.header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("%s: privacy headers %v", what, r.header)
	}
	if r.header.Get("Set-Cookie") != "" {
		t.Fatalf("%s: a public endpoint set a cookie", what)
	}
}

func unsubBody(typ string, enabled bool, company *uuid.UUID, name string) string {
	c := "null"
	if company != nil {
		c = fmt.Sprintf(`{"id":%q,"name":%q}`, company.String(), name)
	}
	return fmt.Sprintf(`{"type":%q,"channel":"email","enabled":%t,"company":%s}`, typ, enabled, c) + "\n"
}

func TestNotificationsUnsubscribe_MemberGetNeverWritesPostTurnsEmailOffIdempotently(t *testing.T) {
	w := newUnsubWorld(t, unsubscribe.DefaultLimits())
	tok := w.token(t, w.owner.id, w.company, domain.TypeApplicationReceived)

	// GET: the default (member operational email off), nothing written, no session.
	r := w.getUnsub(t, tok)
	t.Logf("GET %s (member, no row) → %d %s", notifUnsubPath, r.status, r.body)
	wantUnsub(t, "GET default", r, 200, unsubBody("application_received", false, &w.company, "Notif Read"))
	if n := w.prefCount(t); n != 0 {
		t.Fatalf("GET wrote %d rows", n)
	}
	// The person had turned email on in settings: GET reports it and changes nothing.
	wantPrefs(t, "PUT on", w.put(t, w.owner, notifPrefsMemberPath, `{"preferences":[{"type":"application_received","channel":"email","enabled":true},{"type":"application_received","channel":"in_app","enabled":false}]}`),
		prefWant(true, prefMemberTable, map[string]bool{"application_received/email": true, "application_received/in_app": false}))
	before := w.prefRows(t, w.owner.id)
	for i := 0; i < 3; i++ {
		r = w.getUnsub(t, tok)
		wantUnsub(t, "GET on", r, 200, unsubBody("application_received", true, &w.company, "Notif Read"))
	}
	t.Logf("GET %s (member, email on) → %d %s", notifUnsubPath, r.status, r.body)
	if got := w.prefRows(t, w.owner.id); fmt.Sprint(got) != fmt.Sprint(before) {
		t.Fatalf("GET changed rows:\n%v\n%v", before, got)
	}

	// POST with the one-click body, carrying someone else's session: the token decides.
	r = w.call(t, unsubCall{method: http.MethodPost, query: "?token=" + tok, contentType: "application/x-www-form-urlencoded",
		body: "List-Unsubscribe=One-Click", headers: map[string]string{"Authorization": "Bearer " + w.notifWorld.signer.validToken(t, w.colleague.sub)}})
	t.Logf("POST %s (member, one-click) → %d %s", notifUnsubPath, r.status, r.body)
	wantUnsub(t, "POST", r, 200, unsubBody("application_received", false, &w.company, "Notif Read"))
	rows := w.prefRows(t, w.owner.id)
	if len(rows) != 2 || rows[0].typ != "application_received" || rows[0].channel != "email" || rows[0].enabled || rows[0].source != "unsubscribe" ||
		rows[0].company != w.company.String() || rows[1].channel != "in_app" || rows[1].enabled || rows[1].source != "settings" || !rows[1].updated.Equal(before[1].updated) {
		t.Fatalf("after POST: %+v", rows)
	}
	if got := w.prefRows(t, w.colleague.id); len(got) != 0 {
		t.Fatalf("the session's user was touched: %+v", got)
	}
	// Idempotent: the same POST (and the landing's empty / {} bodies) change nothing.
	for _, c := range []unsubCall{
		{method: http.MethodPost, query: "?token=" + tok, contentType: "application/x-www-form-urlencoded", body: "List-Unsubscribe=One-Click"},
		{method: http.MethodPost, query: "?token=" + tok},
		{method: http.MethodPost, query: "?token=" + tok, contentType: "application/json", body: "{}"},
	} {
		wantUnsub(t, "POST again", w.call(t, c), 200, unsubBody("application_received", false, &w.company, "Notif Read"))
	}
	if got := w.prefRows(t, w.owner.id); fmt.Sprint(got) != fmt.Sprint(rows) {
		t.Fatalf("repeat POST changed rows:\n%v\n%v", rows, got)
	}
	wantUnsub(t, "GET after", w.getUnsub(t, tok), 200, unsubBody("application_received", false, &w.company, "Notif Read"))
	// The preferences screen shows it; a settings PUT can turn it back on (source settings).
	wantPrefs(t, "catalog after", w.get(t, w.owner, notifPrefsMemberPath),
		prefWant(true, prefMemberTable, map[string]bool{"application_received/email": false, "application_received/in_app": false}))

	// A row already off from settings stays a settings row (nothing to change).
	tok2 := w.token(t, w.owner.id, w.company, domain.TypePsychometricPending)
	w.put(t, w.owner, notifPrefsMemberPath, `{"preferences":[{"type":"psychometric_pending","channel":"email","enabled":false}]}`)
	settings := w.prefRows(t, w.owner.id)
	wantUnsub(t, "POST on a settings-off row", w.postUnsub(t, tok2), 200, unsubBody("psychometric_pending", false, &w.company, "Notif Read"))
	if got := w.prefRows(t, w.owner.id); fmt.Sprint(got) != fmt.Sprint(settings) {
		t.Fatalf("settings-off row rewritten:\n%v\n%v", settings, got)
	}
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0 (D5)", n)
	}
}

func TestNotificationsUnsubscribe_CandidateTokenUsesCompanyNull(t *testing.T) {
	w := newUnsubWorld(t, unsubscribe.DefaultLimits())
	tok := w.token(t, w.candidate.id, uuid.Nil, domain.TypeCandidateMessageReceived)
	r := w.getUnsub(t, tok)
	t.Logf("GET %s (candidate) → %d %s", notifUnsubPath, r.status, r.body)
	wantUnsub(t, "GET candidate default on (Q1)", r, 200, unsubBody("candidate_message_received", true, nil, ""))
	if n := w.prefCount(t); n != 0 {
		t.Fatalf("GET wrote %d rows", n)
	}
	r = w.postUnsub(t, tok)
	t.Logf("POST %s (candidate) → %d %s", notifUnsubPath, r.status, r.body)
	wantUnsub(t, "POST candidate", r, 200, unsubBody("candidate_message_received", false, nil, ""))
	rows := w.prefRows(t, w.candidate.id)
	if len(rows) != 1 || rows[0].company != "" || rows[0].typ != "candidate_message_received" || rows[0].channel != "email" || rows[0].enabled || rows[0].source != "unsubscribe" {
		t.Fatalf("candidate rows %+v", rows)
	}
	wantPrefs(t, "candidate catalog", w.get(t, w.candidate, notifPrefsCandidatePath),
		prefWant(true, prefCandidateTable, map[string]bool{"candidate_message_received/email": false}))
}

// Member keys are company-scoped: a token of another company only writes that
// company's row (membership is not re-checked; the token was issued for mail of
// that company, D1). The caller's own company keeps its preference.
func TestNotificationsUnsubscribe_ForeignCompanyStaysInItsOwnKey(t *testing.T) {
	w := newUnsubWorld(t, unsubscribe.DefaultLimits())
	w.put(t, w.owner, notifPrefsMemberPath, `{"preferences":[{"type":"application_received","channel":"email","enabled":true}]}`)
	tok := w.token(t, w.owner.id, w.other, domain.TypeApplicationReceived)
	wantUnsub(t, "GET other company", w.getUnsub(t, tok), 200, unsubBody("application_received", false, &w.other, "Notif Read"))
	wantUnsub(t, "POST other company", w.postUnsub(t, tok), 200, unsubBody("application_received", false, &w.other, "Notif Read"))
	rows := w.prefRows(t, w.owner.id)
	byCompany := map[string]bool{}
	for _, r := range rows {
		byCompany[r.company] = r.enabled
	}
	if len(rows) != 2 || byCompany[w.company.String()] != true || byCompany[w.other.String()] != false {
		t.Fatalf("rows %+v", rows)
	}
	wantPrefs(t, "own company untouched", w.get(t, w.owner, notifPrefsMemberPath),
		prefWant(true, prefMemberTable, map[string]bool{"application_received/email": true}))
}

// Every invalid cause, on both methods, answers the same bytes and writes nothing.
func TestNotificationsUnsubscribe_EveryInvalidTokenAnswersTheSameBytes(t *testing.T) {
	w := newUnsubWorld(t, unsubscribe.DefaultLimits())
	valid := w.token(t, w.owner.id, w.company, domain.TypeApplicationReceived)
	parts := strings.Split(valid, ".")
	exp := time.Now().Add(time.Hour).Unix()
	forged := func(user uuid.UUID, company string, typ string) string {
		return forgeUnsub(notifUnsubKey, "k1", fmt.Sprintf(`{"v":1,"u":%q,"c":%s,"t":%q,"x":%d}`, user, company, typ, exp))
	}
	w.now = time.Now().Add(-366 * 24 * time.Hour)
	expired := w.token(t, w.owner.id, w.company, domain.TypeApplicationReceived)
	w.now = time.Now()
	gone := w.user(t, "Gina Gone", "recruiter")
	w.exec(t, `INSERT INTO company_members(id,user_id,company_id,role) VALUES($1,$2,$3,'recruiter')`, uuid.New(), gone.id, w.company)
	goneTok := w.token(t, gone.id, w.company, domain.TypeApplicationReceived)
	w.exec(t, `UPDATE users SET deleted_at=now() WHERE id=$1`, gone.id)
	deletedCompany := uuid.New()
	w.exec(t, `INSERT INTO companies(id,name,rfc,industry_id,status,deleted_at) VALUES($1,'Borrada',$2,'technology','active',now())`, deletedCompany, uuid.NewString())

	causes := map[string]string{
		"missing token":             "",
		"empty token":               "?token=",
		"two tokens":                "?token=" + valid + "&token=" + valid,
		"malformed":                 "?token=hola",
		"over 512 chars":            "?token=" + strings.Repeat("A", 513),
		"bad mac":                   "?token=" + parts[0] + "." + parts[1] + "." + strings.Repeat("A", len(parts[2])),
		"unknown kid":               "?token=" + forgeUnsub(notifUnsubKey, "k9", string(mustB64(t, parts[1]))),
		"other key":                 "?token=" + forgeUnsub(bytes.Repeat([]byte{1}, 32), "k1", string(mustB64(t, parts[1]))),
		"expired":                   "?token=" + expired,
		"mandatory type":            "?token=" + forged(w.owner.id, `"`+w.company.String()+`"`, "delivery_overdue"),
		"mandatory reassigned":      "?token=" + forged(w.recruiter.id, `"`+w.company.String()+`"`, "vacancy_reassigned"),
		"member type, null company": "?token=" + forged(w.owner.id, "null", "application_received"),
		"candidate type, company":   "?token=" + forged(w.candidate.id, `"`+w.company.String()+`"`, "candidate_status_changed"),
		"unknown user":              "?token=" + w.token(t, uuid.New(), w.company, domain.TypeApplicationReceived),
		"soft-deleted user":         "?token=" + goneTok,
		"member token, candidate":   "?token=" + w.token(t, w.candidate.id, w.company, domain.TypeApplicationReceived),
		"candidate token, member":   "?token=" + w.token(t, w.owner.id, uuid.Nil, domain.TypeCandidateStatusChanged),
		"unknown company":           "?token=" + w.token(t, w.owner.id, uuid.New(), domain.TypeApplicationReceived),
		"soft-deleted company":      "?token=" + w.token(t, w.owner.id, deletedCompany, domain.TypeApplicationReceived),
	}
	for name, q := range causes {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			r := w.call(t, unsubCall{method: method, query: q, contentType: "application/x-www-form-urlencoded", body: "List-Unsubscribe=One-Click"})
			if name == "mandatory type" && method == http.MethodPost {
				t.Logf("POST %s (mandatory token) → %d %s", notifUnsubPath, r.status, r.body)
			}
			wantUnsub(t, method+" "+name, r, http.StatusUnprocessableEntity, notifUnsubInvalid)
		}
	}
	if n := w.prefCount(t); n != 0 {
		t.Fatalf("invalid tokens wrote %d rows", n)
	}
	// The valid control still works after all of that.
	wantUnsub(t, "control", w.getUnsub(t, valid), 200, unsubBody("application_received", false, &w.company, "Notif Read"))

	// Body over 1 KiB: 413 before anything else; other methods are not routes.
	r := w.call(t, unsubCall{method: http.MethodPost, query: "?token=" + valid, contentType: "text/plain", body: strings.Repeat("a", 1025)})
	if r.status != http.StatusRequestEntityTooLarge || string(r.body) != `{"error":"payload too large","code":"payload_too_large"}`+"\n" {
		t.Fatalf("oversized body: %d %s", r.status, r.body)
	}
	for _, m := range []string{http.MethodPut, http.MethodDelete, http.MethodPatch} {
		if r := w.call(t, unsubCall{method: m, query: "?token=" + valid}); r.status != http.StatusMethodNotAllowed {
			t.Fatalf("%s: %d", m, r.status)
		}
	}
	if n := w.prefCount(t); n != 0 {
		t.Fatalf("rows written: %d", n)
	}
}

func mustB64(t *testing.T, p string) []byte {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(p)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// §Unsubscribe: 60 requests / 10 min per IP per instance → 429 rate_limited. Behind
// the frontend pass-through the BFF-attested client IP is the key (L6), so another
// client through the same Next server keeps its own budget; a forged client header
// without the proxy secret does not.
func TestNotificationsUnsubscribe_PerIPLimit(t *testing.T) {
	w := newUnsubWorld(t, unsubscribe.DefaultLimits())
	tok := w.token(t, w.owner.id, w.company, domain.TypeApplicationReceived)
	bff := func(client string) map[string]string {
		return map[string]string{"X-PF-Proxy-Secret": notifUnsubBFF, "X-PF-Client-IP": client}
	}
	for i := 0; i < 60; i++ {
		method := http.MethodGet
		if i%2 == 1 {
			method = http.MethodPost
		}
		if r := w.call(t, unsubCall{method: method, query: "?token=" + tok, headers: bff("192.0.2.10")}); r.status != 200 {
			t.Fatalf("request %d: %d %s", i, r.status, r.body)
		}
	}
	r := w.call(t, unsubCall{method: http.MethodGet, query: "?token=" + tok, headers: bff("192.0.2.10")})
	t.Logf("GET %s (61st from one client) → %d Retry-After=%s %s", notifUnsubPath, r.status, r.header.Get("Retry-After"), r.body)
	wantUnsub(t, "61st", r, http.StatusTooManyRequests, `{"error":"too many requests","code":"rate_limited"}`+"\n")
	if r.header.Get("Retry-After") == "" {
		t.Fatal("Retry-After missing")
	}
	// Invalid tokens are limited the same (no oracle through the limiter).
	wantUnsub(t, "61st invalid", w.call(t, unsubCall{method: http.MethodPost, query: "?token=x", headers: bff("192.0.2.10")}),
		http.StatusTooManyRequests, `{"error":"too many requests","code":"rate_limited"}`+"\n")
	wantUnsub(t, "another client via the BFF", w.call(t, unsubCall{method: http.MethodGet, query: "?token=" + tok, headers: bff("192.0.2.11")}),
		200, unsubBody("application_received", false, &w.company, "Notif Read"))
	// Without the proxy secret the header is ignored: the peer (127.0.0.1) is the key.
	for i := 0; i < 60; i++ {
		w.call(t, unsubCall{method: http.MethodGet, query: "?token=" + tok, headers: map[string]string{"X-PF-Client-IP": fmt.Sprintf("198.51.100.%d", i)}})
	}
	wantUnsub(t, "forged client header", w.call(t, unsubCall{method: http.MethodGet, query: "?token=" + tok, headers: map[string]string{"X-PF-Client-IP": "198.51.100.200"}}),
		http.StatusTooManyRequests, `{"error":"too many requests","code":"rate_limited"}`+"\n")
}
