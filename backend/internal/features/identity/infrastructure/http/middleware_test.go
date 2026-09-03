package http

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
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
