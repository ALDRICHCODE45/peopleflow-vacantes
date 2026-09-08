package http

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth"
	rtmiddleware "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

// catalogEnvelope helper: parses rec.Body into an ErrorEnvelope and fails
// the test if decoding fails or any assertion misses.
func assertCatalogEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantCode httpjson.Code, wantStatus int) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("status: want %d, got %d: %s", wantStatus, rec.Code, rec.Body.String())
	}
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode catalog envelope: %v; body: %s", err, rec.Body.String())
	}
	if env.Code != wantCode {
		t.Errorf("code: want %q, got %q", wantCode, env.Code)
	}
	if env.Error == "" {
		t.Error("error field: want non-empty, got empty")
	}
	if env.Data != nil {
		t.Errorf("data: want nil for non-conflict envelope, got %v", env.Data)
	}
}

var (
	mwTestKey    *rsa.PrivateKey
	mwTestIssuer = "https://cognito-idp.test.local"
	mwTestAud    = "test-client-id"
)

func TestMain(m *testing.M) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic("cannot generate RSA key: " + err.Error())
	}
	mwTestKey = key
	m.Run()
}

func mwPublicJWK(t *testing.T) jwk.Key {
	t.Helper()
	pub, err := jwk.FromRaw(&mwTestKey.PublicKey)
	if err != nil {
		t.Fatalf("jwk.FromRaw: %v", err)
	}
	if err := pub.Set(jwk.KeyIDKey, "test-kid"); err != nil {
		t.Fatalf("set kid: %v", err)
	}
	if err := pub.Set(jwk.AlgorithmKey, jwa.RS256); err != nil {
		t.Fatalf("set alg: %v", err)
	}
	return pub
}

func mwSignToken(t *testing.T, sub string, groups []string) string {
	t.Helper()
	tok, err := jwt.NewBuilder().
		Issuer(mwTestIssuer).
		Audience([]string{mwTestAud}).
		Subject(sub).
		IssuedAt(time.Now()).
		Expiration(time.Now().Add(time.Hour)).
		Claim("cognito:groups", groups).
		Build()
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	priv, _ := jwk.FromRaw(mwTestKey)
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, priv))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return string(signed)
}

func newTestVerifier(t *testing.T) security.Verifier {
	t.Helper()
	v, err := auth.NewRSAVerifier(mwPublicJWK(t), mwTestIssuer, mwTestAud)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}
	return v
}

// TestRequireAuth_ValidToken populate claims: the spec scenario "valid
// token populates claims" — the downstream handler reads sub and
// cognito:groups from the request context.
func TestRequireAuth_ValidToken(t *testing.T) {
	verifier := newTestVerifier(t)
	got := make(chan security.Claims, 1)
	handler := RequireAuth(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got <- security.ClaimsFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	tok := mwSignToken(t, "sub-abc", []string{"candidates", "recruiters"})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	select {
	case claims := <-got:
		if claims.Subject != "sub-abc" {
			t.Errorf("Subject: want sub-abc, got %q", claims.Subject)
		}
		if len(claims.Groups) != 2 {
			t.Errorf("Groups: want 2, got %v", claims.Groups)
		}
	case <-time.After(time.Second):
		t.Fatal("downstream handler not invoked")
	}
}

// TestRequireAuth_MissingHeader rejects requests with no Authorization
// header.
func TestRequireAuth_MissingHeader(t *testing.T) {
	verifier := newTestVerifier(t)
	invoked := false
	handler := RequireAuth(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		invoked = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
	if rec.Header().Get("WWW-Authenticate") == "" {
		t.Error("WWW-Authenticate header: want non-empty, got empty")
	}
	if invoked {
		t.Error("downstream handler should not be invoked")
	}
}

// TestRequireAuth_InvalidBearerScheme rejects non-Bearer auth schemes.
func TestRequireAuth_InvalidBearerScheme(t *testing.T) {
	verifier := newTestVerifier(t)
	invoked := false
	handler := RequireAuth(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		invoked = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
	if rec.Header().Get("WWW-Authenticate") == "" {
		t.Error("WWW-Authenticate header: want non-empty, got empty")
	}
	if invoked {
		t.Error("downstream handler should not be invoked")
	}
}

// TestRequireAuth_InvalidToken proves the spec scenario "invalid cases
// return 401". The verifier failure detail must NOT leak to the client.
func TestRequireAuth_InvalidToken(t *testing.T) {
	verifier := newTestVerifier(t)
	invoked := false
	handler := RequireAuth(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		invoked = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
	if rec.Header().Get("WWW-Authenticate") == "" {
		t.Error("WWW-Authenticate header: want non-empty, got empty")
	}
	// No verifier detail in body — safe generic message only.
	if strings.Contains(rec.Body.String(), "token") || strings.Contains(rec.Body.String(), "verify") || strings.Contains(rec.Body.String(), "signature") {
		t.Errorf("body must not leak verifier detail: %s", rec.Body.String())
	}
	if invoked {
		t.Error("downstream handler should not be invoked")
	}
}

// TestRequireAuth_EmptyBearerToken rejects "Bearer " with nothing after.
func TestRequireAuth_EmptyBearerToken(t *testing.T) {
	verifier := newTestVerifier(t)
	invoked := false
	handler := RequireAuth(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		invoked = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer ")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
	if rec.Header().Get("WWW-Authenticate") == "" {
		t.Error("WWW-Authenticate header: want non-empty, got empty")
	}
	if invoked {
		t.Error("downstream handler should not be invoked")
	}
}

// TestRequireAuth_HeadersAreCaseInsensitive is a sanity check: net/http
// normalizes header names, so the middleware should still pick up
// "authorization" in any case.
func TestRequireAuth_HeadersAreCaseInsensitive(t *testing.T) {
	verifier := newTestVerifier(t)
	handler := RequireAuth(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	tok := mwSignToken(t, "sub-abc", nil)
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("AUTHORIZATION", "Bearer "+tok)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

// TestRequireAuth_PreservesContextForDownstream verifies that the
// downstream handler can read claims from the context.
func TestRequireAuth_PreservesContextForDownstream(t *testing.T) {
	verifier := newTestVerifier(t)
	var seenContext context.Context
	handler := RequireAuth(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenContext = r.Context()
		w.WriteHeader(http.StatusOK)
	}))

	tok := mwSignToken(t, "sub-ctx", []string{"recruiters"})
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if seenContext == nil {
		t.Fatal("downstream context was nil")
	}
	claims := security.ClaimsFromContext(seenContext)
	if claims.Subject != "sub-ctx" {
		t.Errorf("Subject: want sub-ctx, got %q", claims.Subject)
	}
}

// mwJWKS is a TLS JWKS endpoint (factory requires HTTPS) with a rotatable, failable single-kid key set.
type mwJWKS struct {
	srv  *httptest.Server
	mu   sync.Mutex
	body []byte
	fail bool
	hits int
}

func mwJWKSBody(t *testing.T, kid string) []byte {
	t.Helper()
	key := mwPublicJWK(t)
	_ = key.Set(jwk.KeyIDKey, kid)
	set := jwk.NewSet()
	if err := set.AddKey(key); err != nil {
		t.Fatalf("add jwk: %v", err)
	}
	body, err := json.Marshal(set)
	if err != nil {
		t.Fatalf("marshal jwks: %v", err)
	}
	return body
}

func mwStartJWKS(t *testing.T, kid string) *mwJWKS {
	t.Helper()
	s := &mwJWKS{body: mwJWKSBody(t, kid)}
	s.srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		s.hits++
		body, fail := s.body, s.fail
		s.mu.Unlock()
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(s.srv.Close)
	// The verifier resolves http.DefaultTransport per request; swap in the test client's transport.
	orig := http.DefaultTransport
	http.DefaultTransport = s.srv.Client().Transport
	t.Cleanup(func() { http.DefaultTransport = orig })
	return s
}

func (s *mwJWKS) rotate(t *testing.T, kid string) {
	t.Helper()
	s.mu.Lock()
	s.body = mwJWKSBody(t, kid)
	s.mu.Unlock()
}

func (s *mwJWKS) setFail(fail bool) { s.mu.Lock(); s.fail = fail; s.mu.Unlock() }
func (s *mwJWKS) hitCount() int     { s.mu.Lock(); defer s.mu.Unlock(); return s.hits }

// mwFactoryVerifier builds the verifier exactly as the composition root.
func mwFactoryVerifier(t *testing.T, env map[string]string) security.Verifier {
	t.Helper()
	v, err := auth.NewVerifierConfigFromEnv(func(k string) string { return env[k] }, auth.NewJWKSVerifier)
	if err != nil {
		t.Fatalf("NewVerifierConfigFromEnv: %v", err)
	}
	if c, ok := v.(interface{ Close() }); ok {
		t.Cleanup(c.Close)
	}
	return v
}

func mwJWKSEnv(issuerURL string) map[string]string {
	return map[string]string{
		"APP_ENV": "local", "IDENTITY_JWT_MODE": "jwks",
		"IDENTITY_JWT_ISSUER": issuerURL, "IDENTITY_JWT_AUDIENCE": mwTestAud,
		"IDENTITY_JWT_TOKEN_USE": "access", "IDENTITY_JWT_CACHE_TTL": "1m",
		"IDENTITY_JWT_FETCH_TIMEOUT": "2s",
	}
}

// mwSignJWKS signs a token for the JWKS server (issuer=URL, kid header, token_use=access).
func mwSignJWKS(t *testing.T, issuerURL, kid, sub string) string {
	t.Helper()
	priv, _ := jwk.FromRaw(mwTestKey) // cannot fail for *rsa.PrivateKey
	_ = priv.Set(jwk.KeyIDKey, kid)
	tok, err := jwt.NewBuilder().
		Issuer(issuerURL).Audience([]string{mwTestAud}).Subject(sub).
		IssuedAt(time.Now()).Expiration(time.Now().Add(time.Hour)).
		Claim("token_use", "access").Build()
	if err != nil {
		t.Fatalf("build token: %v", err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, priv))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return string(signed)
}

// TestRequireAuth_JWKS_KnownKidAndRotation: a factory-built verifier accepts the cached kid,
// and an unknown kid after rotation forces exactly one bounded refresh (2 fetches).
func TestRequireAuth_JWKS_KnownKidAndRotation(t *testing.T) {
	s := mwStartJWKS(t, "kid-old")
	handler := RequireAuth(mwFactoryVerifier(t, mwJWKSEnv(s.srv.URL)))(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if claims := security.ClaimsFromContext(r.Context()); claims.Subject != "sub-rot" {
				t.Errorf("Subject: want sub-rot, got %q", claims.Subject)
			}
		}))
	do := func(kid string) int {
		req := httptest.NewRequest(http.MethodGet, "/me/profile", nil)
		req.Header.Set("Authorization", "Bearer "+mwSignJWKS(t, s.srv.URL, kid, "sub-rot"))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := do("kid-old"); code != http.StatusOK {
		t.Fatalf("known kid: want 200, got %d", code)
	}
	s.rotate(t, "kid-new")
	if code := do("kid-new"); code != http.StatusOK {
		t.Fatalf("unknown kid after rotation: want 200, got %d", code)
	}
	if got := s.hitCount(); got != 2 {
		t.Fatalf("JWKS fetches: want exactly 2 (initial fetch + forced rotation refresh), got %d", got)
	}
}

// TestRequireAuth_JWKS_FailClosed: a failing JWKS fetch and a closed verifier (no fallback)
// both map to a catalog unauthenticated 401 with no verifier detail leaked, no downstream call.
func TestRequireAuth_JWKS_FailClosed(t *testing.T) {
	s := mwStartJWKS(t, "kid-x")
	verifier := mwFactoryVerifier(t, mwJWKSEnv(s.srv.URL))
	invoked := false
	handler := RequireAuth(verifier)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }))
	send := func() *httptest.ResponseRecorder {
		invoked = false
		req := httptest.NewRequest(http.MethodGet, "/me/profile", nil)
		req.Header.Set("Authorization", "Bearer "+mwSignJWKS(t, s.srv.URL, "kid-x", "sub-x"))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	s.setFail(true)
	rec := send()
	assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
	if invoked {
		t.Error("downstream handler should not be invoked")
	}
	for _, leak := range []string{"jwks", "fetch", "refresh", "500", "signature"} {
		if strings.Contains(rec.Body.String(), leak) {
			t.Errorf("body must not leak verifier detail %q: %s", leak, rec.Body.String())
		}
	}

	// Scenario: no fallback after verifier Close. The endpoint is healthy again, so an
	// ineffective Close would re-fetch the live key set and admit this token with 200.
	s.setFail(false)
	verifier.(interface{ Close() }).Close() // Close is idempotent
	rec = send()
	assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
	if invoked {
		t.Error("downstream handler should not be invoked after verifier Close")
	}
	if s := rec.Body.String(); strings.Contains(s, "closed") {
		t.Errorf("body leaks close internals: %s", s)
	}
}

// TestRequireAuth_PEMMode_ExplicitSelection: an explicit local pem selection built through
// the factory verifies a good token and fails closed on bad.
func TestRequireAuth_PEMMode_ExplicitSelection(t *testing.T) {
	der, err := x509.MarshalPKIXPublicKey(&mwTestKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal pkix: %v", err)
	}
	verifier := mwFactoryVerifier(t, map[string]string{
		"APP_ENV": "local", "IDENTITY_JWT_MODE": "pem",
		"IDENTITY_JWT_PUBLIC_KEY_PEM": string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})),
		"IDENTITY_JWT_ISSUER":         mwTestIssuer, "IDENTITY_JWT_AUDIENCE": mwTestAud,
	})
	handler := RequireAuth(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if claims := security.ClaimsFromContext(r.Context()); claims.Subject != "sub-pem" {
			t.Errorf("Subject: want sub-pem, got %q", claims.Subject)
		}
	}))
	good := httptest.NewRequest(http.MethodGet, "/me/profile", nil)
	good.Header.Set("Authorization", "Bearer "+mwSignToken(t, "sub-pem", nil))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, good)
	if rec.Code != http.StatusOK {
		t.Fatalf("good token: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	bad := httptest.NewRequest(http.MethodGet, "/me/profile", nil)
	bad.Header.Set("Authorization", "Bearer not-a-real-token")
	recBad := httptest.NewRecorder()
	handler.ServeHTTP(recBad, bad)
	assertCatalogEnvelope(t, recBad, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
}

// --- WS6C: RequireAuth verifier-failure auxiliary log redaction & correlation

// mwAuxTokenMarker is the synthetic bearer-token marker. The chain below
// sends it as the actual Authorization credential, so any leak of the
// supplied token fails the forbidden-marker assertion.
var mwAuxTokenMarker = "tok-synthetic-ws6c-0f3a9c"

// mwAuxMarkers carries one synthetic marker per forbidden class: bearer
// token, DSN, email, CV key, signature detail, raw driver error. None of
// them may ever appear in captured logs or on the wire.
var mwAuxMarkers = []string{
	mwAuxTokenMarker,
	"postgres://svc:hunter2@db.internal:5432/peopleflow",
	"candidate.personal@example.com",
	"resumes/cv-synthetic-ws6c-key.pdf",
	"signature=SYNTHETIC-MAC-DIGEST",
	`pq: signature verify: crypto/rsa: verification error`,
}

// mwLeakyVerifier is a security.Verifier stub whose failure error carries
// every synthetic high-risk marker — exactly the kind of raw verifier error
// the RequireAuth auxiliary record must never echo.
type mwLeakyVerifier struct{}

func (mwLeakyVerifier) Verify(_ context.Context, _ string) (security.Claims, error) {
	return security.Claims{}, fmt.Errorf("verify: %s", strings.Join(mwAuxMarkers, "; "))
}

// mwServeAuthChain mounts the production-shaped chain chi RequestID → runtime
// RequestObservability → RequireAuth(mwLeakyVerifier) on the route
// GET /protected and serves one request, returning the response recorder
// and whether the downstream handler was invoked. Call only after installing
// the captured DEBUG-level default logger. When requestIDHeader is non-empty
// it is sent as X-Request-Id so chi's RequestID middleware adopts the caller
// value; otherwise chi generates one. The sent bearer credential is exactly
// mwAuxTokenMarker so a token leak trips the marker assertion.
func mwServeAuthChain(t *testing.T, requestIDHeader string) (*httptest.ResponseRecorder, bool) {
	t.Helper()

	invoked := false
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(rtmiddleware.RequestObservability(nil, nil))
	r.Method(http.MethodGet, "/protected", RequireAuth(mwLeakyVerifier{})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		invoked = true
	})))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+mwAuxTokenMarker)
	if requestIDHeader != "" {
		req.Header.Set("X-Request-Id", requestIDHeader)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec, invoked
}

// TestRequireAuth_InvalidTokenLogIsRedactedAndCorrelated pins the WS6C
// bounded RequireAuth verifier-failure contract: the canonical 401
// unauthenticated envelope is unchanged and downstream is never invoked;
// the auxiliary DEBUG record carries exactly time/level/msg/code_class plus
// the correlated request_id shared with the runtime completion record
// (adopted from the caller's X-Request-Id when supplied, otherwise generated
// by chi's RequestID middleware), code_class is unauthenticated, the raw
// verifier error is never logged at any level, and no synthetic marker from
// the injected error reaches the logs or the wire.
func TestRequireAuth_InvalidTokenLogIsRedactedAndCorrelated(t *testing.T) {
	const suppliedID = "req-supplied-fixed-ws6c-auth"
	const auxMsg = "auth: token verification failed"
	const completionMsg = "http request completed"

	cases := []struct {
		name            string
		requestIDHeader string
	}{
		{name: "supplied_request_id_is_correlated", requestIDHeader: suppliedID},
		{name: "generated_request_id_when_header_absent", requestIDHeader: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Capture slog output FIRST at DEBUG level, then build the chain
			// so the runtime middleware and RequireAuth share the captured
			// handler. slog.Default is shared state: stay non-parallel.
			var logBuf bytes.Buffer
			prev := slog.Default().Handler()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelDebug})))
			t.Cleanup(func() { slog.SetDefault(slog.New(prev)) })

			rec, invoked := mwServeAuthChain(t, tc.requestIDHeader)

			// 1. Canonical 401 unauthenticated envelope + WWW-Authenticate.
			assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
			if rec.Header().Get("WWW-Authenticate") == "" {
				t.Error("WWW-Authenticate header: want non-empty, got empty")
			}
			if invoked {
				t.Error("downstream handler should not be invoked")
			}

			// 2. Exactly one auxiliary DEBUG record + one completion record.
			dec := json.NewDecoder(bytes.NewReader(logBuf.Bytes()))
			var records []map[string]any
			for {
				var recLine map[string]any
				if err := dec.Decode(&recLine); err != nil {
					if !errors.Is(err, io.EOF) {
						t.Fatalf("captured slog stream is not valid JSON: %v: %q", err, logBuf.String())
					}
					break
				}
				records = append(records, recLine)
			}
			var auxRecords, completions []map[string]any
			for _, record := range records {
				switch record["msg"] {
				case auxMsg:
					auxRecords = append(auxRecords, record)
				case completionMsg:
					completions = append(completions, record)
				}
			}
			if len(records) != 2 {
				t.Fatalf("captured records = %d, want exactly 2 (%s DEBUG + %s INFO): %v", len(records), auxMsg, completionMsg, records)
			}
			if len(auxRecords) != 1 || len(completions) != 1 {
				t.Fatalf("want exactly 1 %q DEBUG and 1 %q INFO, got %d aux / %d completion: %v", auxMsg, completionMsg, len(auxRecords), len(completions), records)
			}
			aux, completion := auxRecords[0], completions[0]

			// 3. Auxiliary record: exact bounded key set — no error attribute,
			// no method, path, body, or identity data.
			wantAux := map[string]bool{"time": true, "level": true, "msg": true, "code_class": true, "request_id": true}
			for k := range aux {
				if !wantAux[k] {
					t.Errorf("auxiliary record has unbounded key %q (record: %v)", k, aux)
				}
				delete(wantAux, k)
			}
			for k := range wantAux {
				t.Errorf("auxiliary record is missing required key %q (record: %v)", k, aux)
			}
			if got, _ := aux["level"].(string); got != slog.LevelDebug.String() {
				t.Errorf("aux level = %v, want %q", aux["level"], slog.LevelDebug.String())
			}
			if got, _ := aux["code_class"].(string); got != string(httpjson.CodeUnauthenticated) {
				t.Errorf("aux code_class = %v, want %q", aux["code_class"], httpjson.CodeUnauthenticated)
			}

			// 4. Same non-empty request ID in both records.
			auxID, _ := aux["request_id"].(string)
			completionID, _ := completion["request_id"].(string)
			if tc.requestIDHeader != "" && auxID != tc.requestIDHeader {
				t.Errorf("aux request_id = %q, want supplied header value %q", auxID, tc.requestIDHeader)
			}
			if auxID == "" || completionID == "" || auxID != completionID {
				t.Errorf("aux and completion records must share one nonempty request ID, got aux=%q completion=%q", auxID, completionID)
			}

			// 5. Completion record: matched route pattern, status 401, canonical code.
			if got, _ := completion["path"].(string); got != "/protected" {
				t.Errorf("completion path = %v, want matched route pattern %q", completion["path"], "/protected")
			}
			if got, _ := completion["status"].(float64); got != http.StatusUnauthorized {
				t.Errorf("completion status = %v, want %d", completion["status"], http.StatusUnauthorized)
			}
			if got, _ := completion["code_class"].(string); got != string(httpjson.CodeUnauthenticated) {
				t.Errorf("completion code_class = %v, want %q", completion["code_class"], httpjson.CodeUnauthenticated)
			}

			// 6. Synthetic markers absent from BOTH the log and the wire body.
			logOutput := logBuf.String()
			for _, marker := range mwAuxMarkers {
				if strings.Contains(logOutput, marker) {
					t.Errorf("captured logs must NOT contain synthetic marker %q", marker)
				}
				if strings.Contains(rec.Body.String(), marker) {
					t.Errorf("response body must NOT contain synthetic marker %q: %s", marker, rec.Body.String())
				}
			}
		})
	}
}
