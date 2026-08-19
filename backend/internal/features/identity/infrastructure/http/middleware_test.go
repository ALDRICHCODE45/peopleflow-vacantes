package http

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth"
	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

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

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
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

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if invoked {
		t.Error("downstream handler should not be invoked")
	}
}

// TestRequireAuth_InvalidToken proves the spec scenario "invalid cases
// return 401".
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

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
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

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
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
