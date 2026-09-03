package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

func jwksKey(t *testing.T, kid string, alg jwa.SignatureAlgorithm) jwk.Key {
	key, err := jwk.FromRaw(testKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	if kid != "" {
		key.Set(jwk.KeyIDKey, kid)
	}
	if alg != "" {
		key.Set(jwk.AlgorithmKey, alg)
	}
	return key
}

func jwksBytes(t *testing.T, keys ...jwk.Key) []byte {
	set := jwk.NewSet()
	for _, key := range keys {
		if err := set.AddKey(key); err != nil {
			t.Fatal(err)
		}
	}
	body, err := json.Marshal(set)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func newTestJWKSVerifier(t *testing.T, h http.HandlerFunc) *JWKSVerifier {
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	v, err := NewJWKSVerifier(JWKSVerifierConfig{
		JWKSURL: srv.URL, Issuer: testIssuer, Audience: testAud, TokenUse: "access",
		CacheTTL: time.Second, FetchTimeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	jv := v.(*JWKSVerifier)
	jv.client = srv.Client()
	t.Cleanup(jv.Close)
	return jv
}

func waitJWKSJoin(t *testing.T, ch <-chan struct{}, n int) {
	for range n {
		select {
		case <-ch:
		case <-time.After(time.Second):
			t.Fatalf("waited for %d refresh waiters, got fewer", n)
		}
	}
}

type jwksTokenSpec struct {
	key               *rsa.PrivateKey // nil -> testKey
	kid               string
	alg               jwa.SignatureAlgorithm
	issuer, audience  string
	tokenUse, subject string
	iat, nbf, exp     time.Time
}

func validJWKSTokenSpec() jwksTokenSpec {
	now := time.Now()
	return jwksTokenSpec{
		alg: jwa.RS256, kid: "kid-a", issuer: testIssuer, audience: testAud,
		tokenUse: "access", subject: "user-1", iat: now, nbf: now, exp: now.Add(time.Hour),
	}
}

func (s jwksTokenSpec) with(f func(*jwksTokenSpec)) jwksTokenSpec {
	f(&s)
	return s
}

func must(t *testing.T, err error, what string) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: %v", what, err)
	}
}

func signJWKSToken(t *testing.T, s jwksTokenSpec) string {
	t.Helper()
	b := jwt.NewBuilder().Issuer(s.issuer).Audience([]string{s.audience}).Subject(s.subject).
		IssuedAt(s.iat).NotBefore(s.nbf).Claim("token_use", s.tokenUse).
		Claim("cognito:groups", []string{"recruiter"})
	if !s.exp.IsZero() {
		b.Expiration(s.exp)
	}
	tok, err := b.Build()
	must(t, err, "build token")
	var signKey jwk.Key
	if s.alg == jwa.RS256 {
		priv := s.key
		if priv == nil {
			priv = testKey
		}
		signKey, err = jwk.FromRaw(priv)
	} else { // alg-confusion attack shape: HMAC-signed with attacker secret
		signKey, err = jwk.FromRaw([]byte("attacker-hmac-secret"))
	}
	must(t, err, "jwk.FromRaw")
	if s.kid != "" {
		must(t, signKey.Set(jwk.KeyIDKey, s.kid), "set kid")
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(s.alg, signKey))
	must(t, err, "sign")
	return string(signed)
}

func mustVerify(t *testing.T, v *JWKSVerifier, s jwksTokenSpec) security.Claims {
	t.Helper()
	claims, err := v.Verify(t.Context(), signJWKSToken(t, s))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	return claims
}

func mustErr(t *testing.T, v *JWKSVerifier, s jwksTokenSpec) error {
	t.Helper()
	_, err := v.Verify(t.Context(), signJWKSToken(t, s))
	if err == nil {
		t.Fatal("Verify must fail closed")
	}
	return err
}

func kidSetHandler(t *testing.T, requests, mode *atomic.Int32) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		if requests != nil {
			requests.Add(1)
		}
		kid := "kid-a"
		if mode != nil && mode.Load() == 1 {
			kid = "kid-b"
		}
		_, _ = w.Write(jwksBytes(t, jwksKey(t, kid, jwa.RS256)))
	}
}

func TestJWKSVerifier_Verify_KnownKidReturnsClaims(t *testing.T) {
	var requests atomic.Int32
	v := newTestJWKSVerifier(t, kidSetHandler(t, &requests, nil))
	claims := mustVerify(t, v, validJWKSTokenSpec())
	if claims.Subject != "user-1" || len(claims.Groups) != 1 || claims.Groups[0] != "recruiter" {
		t.Fatalf("claims = %+v, want subject user-1 with groups [recruiter]", claims)
	}
}

func TestJWKSVerifier_Verify_FailClosed(t *testing.T) {
	now := time.Now()
	rogue, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	validBody := jwksBytes(t, jwksKey(t, "kid-a", jwa.RS256))
	valid := validJWKSTokenSpec()
	cases := []struct {
		name    string
		status  int
		body    []byte
		token   string
		fetches int32
	}{
		{"alg confusion hs256", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.alg = jwa.HS256 })), 0},
		{"missing kid", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.kid = "" })), 0},
		{"garbage token", 200, validBody, "not-a-token", 0},
		{"rogue signature", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.key = rogue })), 1},
		{"wrong issuer", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.issuer = "https://evil.example" })), 1},
		{"wrong audience", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.audience = "other-client" })), 1},
		{"wrong token_use", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.tokenUse = "login" })), 1},
		{"empty subject", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.subject = "" })), 1},
		{"missing exp", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.exp = time.Time{} })), 1},
		{"expired beyond skew", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.exp = now.Add(-jwksClockSkew - time.Minute) })), 1},
		{"nbf future", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.nbf = now.Add(time.Hour); s.exp = now.Add(2 * time.Hour) })), 1},
		{"iat future beyond skew", 200, validBody, signJWKSToken(t, valid.with(func(s *jwksTokenSpec) { s.iat = now.Add(jwksClockSkew + time.Minute) })), 1},
		{"server error", http.StatusServiceUnavailable, []byte("{}"), signJWKSToken(t, valid), 1},
		{"malformed jwks", 200, []byte("<bad>"), signJWKSToken(t, valid), 1},
		{"pem jwks body", 200, []byte("-----BEGIN PUBLIC KEY-----"), signJWKSToken(t, valid), 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var requests atomic.Int32
			v := newTestJWKSVerifier(t, func(w http.ResponseWriter, _ *http.Request) {
				requests.Add(1)
				w.WriteHeader(tc.status)
				_, _ = w.Write(tc.body)
			})
			claims, err := v.Verify(t.Context(), tc.token)
			if err == nil || claims.Subject != "" || len(claims.Groups) != 0 {
				t.Fatalf("Verify = (%+v, %v), want fail-closed error", claims, err)
			}
			if requests.Load() != tc.fetches {
				t.Fatalf("fetches = %d, want %d", requests.Load(), tc.fetches)
			}
		})
	}
}

func TestJWKSFetch_BoundsAndValidation(t *testing.T) {
	many := make([]jwk.Key, maxJWKSKeys+1)
	for i := range many {
		many[i] = jwksKey(t, "kid-"+string(rune('a'+i)), jwa.RS256)
	}
	cases := []struct {
		name   string
		status int
		body   []byte
		want   string
	}{
		{"valid", http.StatusOK, jwksBytes(t, jwksKey(t, "kid-a", jwa.RS256)), ""},
		{"server", http.StatusServiceUnavailable, []byte("{}"), "unexpected status"},
		{"malformed", http.StatusOK, []byte("<bad>"), "parse"},
		{"bytes", http.StatusOK, bytes.Repeat([]byte("a"), maxJWKSResponseBytes+1), "byte limit"},
		{"count", http.StatusOK, jwksBytes(t, many...), "key count"},
		{"kid", http.StatusOK, jwksBytes(t, jwksKey(t, "", jwa.RS256)), "kid"},
		{"rsa", http.StatusOK, []byte(`{"keys":[{"kty":"oct","kid":"sym","k":"c2VjcmV0"}]}`), "RSA"},
		{"alg", http.StatusOK, jwksBytes(t, jwksKey(t, "kid-a", jwa.HS256)), "RS256"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			set, err := newTestJWKSVerifier(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write(tc.body)
			}).fetch(t.Context())
			if tc.want == "" && (err != nil || set.Len() != 1) {
				t.Fatalf("fetch = (%v, %v), want one key", set, err)
			}
			if tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Fatalf("fetch err = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestJWKSRefresh_CacheTTLReplacementAndFailure(t *testing.T) {
	mode := atomic.Int32{}
	v := newTestJWKSVerifier(t, func(w http.ResponseWriter, _ *http.Request) {
		if mode.Load() == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		kid := "kid-a"
		if mode.Load() == 2 {
			kid = "kid-b"
		}
		_, _ = w.Write(jwksBytes(t, jwksKey(t, kid, jwa.RS256)))
	})
	now := time.Unix(0, 1_700_000_000_000_000_000)
	v.now = func() time.Time { return now }
	if err := v.refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	set, ok := v.cachedSet()
	if !ok || set.Len() != 1 {
		t.Fatal("cache not published")
	}
	key, _ := set.Key(0)
	_ = key.Set(jwk.KeyIDKey, "mutated")
	set, ok = v.cachedSet()
	key, _ = set.Key(0)
	if !ok || key.KeyID() != "kid-a" {
		t.Fatal("cachedSet exposed mutable key")
	}
	now = now.Add(minJWKSCacheTTL)
	mode.Store(1)
	if err := v.refresh(t.Context()); err == nil {
		t.Fatal("failed refresh succeeded")
	}
	if _, ok := v.cachedSet(); ok {
		t.Fatal("failed refresh extended expiry")
	}
	mode.Store(2)
	if err := v.refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	set, _ = v.cachedSet()
	key, _ = set.Key(0)
	if key.KeyID() != "kid-b" {
		t.Fatalf("whole-set replacement kid = %q", key.KeyID())
	}
}

func TestJWKSRefresh_SingleFlightWaiterCancelAndClose(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	var requests atomic.Int32
	v := newTestJWKSVerifier(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		select {
		case <-release:
			_, _ = w.Write(jwksBytes(t, jwksKey(t, "kid-a", jwa.RS256)))
		case <-r.Context().Done():
		}
	})
	joined := make(chan struct{}, 3)
	v.onJoin = func() { joined <- struct{}{} }
	ctx, cancel := context.WithCancel(t.Context())
	errA, errB := make(chan error, 1), make(chan error, 1)
	go func() { errA <- v.refresh(ctx) }()
	go func() { errB <- v.refresh(t.Context()) }()
	waitJWKSJoin(t, joined, 2)
	cancel()
	if err := <-errA; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled waiter err = %v", err)
	}
	once.Do(func() { close(release) })
	if err := <-errB; err != nil {
		t.Fatalf("shared waiter err = %v", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("requests = %d, want one shared fetch", requests.Load())
	}
	if _, ok := v.cachedSet(); !ok {
		t.Fatal("shared refresh did not publish")
	}

	v2 := newTestJWKSVerifier(t, func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	joined2 := make(chan struct{}, 1)
	v2.onJoin = func() { joined2 <- struct{}{} }
	done := make(chan struct{})
	go func() { _ = v2.refresh(t.Context()) }()
	waitJWKSJoin(t, joined2, 1)
	go func() { v2.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Close did not cancel the verifier-owned fetch")
	}
	if err := v2.refresh(t.Context()); !errors.Is(err, errJWKSClosed) {
		t.Fatalf("refresh after Close = %v", err)
	}
	v3 := newTestJWKSVerifier(t, func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	v3.cfg.FetchTimeout = time.Millisecond
	if err := v3.refresh(t.Context()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("fetch deadline err = %v", err)
	}
}

func TestJWKSVerifier_Verify_StarterCancelSharedRefresh(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	var requests atomic.Int32
	v := newTestJWKSVerifier(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		select {
		case <-release:
			_, _ = w.Write(jwksBytes(t, jwksKey(t, "kid-a", jwa.RS256)))
		case <-r.Context().Done():
		}
	})
	joined := make(chan struct{}, 2)
	v.onJoin = func() { joined <- struct{}{} }
	ctxA, cancelA := context.WithCancel(t.Context())
	errA, claimsB := make(chan error, 1), make(chan security.Claims, 1)
	token := signJWKSToken(t, validJWKSTokenSpec())
	go func() { _, err := v.Verify(ctxA, token); errA <- err }()
	waitJWKSJoin(t, joined, 1) // A deterministically starts the shared refresh.
	go func() { c, _ := v.Verify(t.Context(), token); claimsB <- c }()
	waitJWKSJoin(t, joined, 1)
	cancelA() // starter cancels; the shared fetch must NOT be cancelled
	if err := <-errA; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled starter err = %v, want context.Canceled", err)
	}
	once.Do(func() { close(release) })
	var b security.Claims
	select {
	case b = <-claimsB:
	case <-time.After(time.Second):
		t.Fatal("other waiter did not succeed from the shared refresh")
	}
	if b.Subject != "user-1" {
		t.Fatalf("waiter subject = %q", b.Subject)
	}
	if requests.Load() != 1 {
		t.Fatalf("requests = %d, want one shared fetch", requests.Load())
	}
}

func TestJWKSVerifier_Verify_CloseBoundedAndIdempotent(t *testing.T) {
	v := newTestJWKSVerifier(t, func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	joined := make(chan struct{}, 1)
	v.onJoin = func() { joined <- struct{}{} }
	errC := make(chan error, 1)
	go func() {
		_, err := v.Verify(t.Context(), signJWKSToken(t, validJWKSTokenSpec()))
		errC <- err
	}()
	waitJWKSJoin(t, joined, 1)
	closed := make(chan struct{})
	go func() { v.Close(); v.Close(); close(closed) }() // idempotent, bounded
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("double Close did not return boundedly")
	}
	if err := <-errC; err == nil {
		t.Fatal("in-flight Verify must fail once the verifier closes")
	}
	if _, err := v.Verify(t.Context(), signJWKSToken(t, validJWKSTokenSpec())); !errors.Is(err, errJWKSClosed) {
		t.Fatalf("Verify after Close = %v, want errJWKSClosed", err)
	}
	cached := newTestJWKSVerifier(t, kidSetHandler(t, nil, nil))
	mustVerify(t, cached, validJWKSTokenSpec())
	cached.Close()
	if _, err := cached.Verify(t.Context(), signJWKSToken(t, validJWKSTokenSpec())); !errors.Is(err, errJWKSClosed) {
		t.Fatalf("cached Verify after Close = %v, want errJWKSClosed", err)
	}
}

func TestJWKSVerifier_Verify_FetchDeadlineOwnedByVerifier(t *testing.T) {
	reached := make(chan struct{})
	mode := atomic.Int32{}
	v := newTestJWKSVerifier(t, func(w http.ResponseWriter, r *http.Request) {
		if mode.Load() == 0 { // first request warms the connection and primes the cache
			_, _ = w.Write(jwksBytes(t, jwksKey(t, "kid-a", jwa.RS256)))
			return
		}
		close(reached)
		<-r.Context().Done() // stall until the verifier-owned deadline fires
	})
	if _, err := v.Verify(t.Context(), signJWKSToken(t, validJWKSTokenSpec())); err != nil {
		t.Fatalf("prime Verify: %v", err)
	}
	mode.Store(1)
	v.cfg.FetchTimeout = 100 * time.Millisecond
	unknown := validJWKSTokenSpec().with(func(s *jwksTokenSpec) { s.kid = "kid-b" })
	_, err := v.Verify(t.Context(), signJWKSToken(t, unknown))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Verify err = %v, want DeadlineExceeded", err)
	}
	select {
	case <-reached:
	case <-time.After(time.Second):
		t.Fatal("verifier-owned deadline never reached the stalled server")
	}
}

func TestJWKSVerifier_Verify_InjectedClockControlsTTL(t *testing.T) {
	mode := atomic.Int32{}
	var requests atomic.Int32
	v := newTestJWKSVerifier(t, func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		kid := "kid-a"
		if mode.Load() == 1 {
			kid = "kid-b"
		}
		_, _ = w.Write(jwksBytes(t, jwksKey(t, kid, jwa.RS256)))
	})
	now := time.Now()
	v.now = func() time.Time { return now }
	tokenA := signJWKSToken(t, validJWKSTokenSpec())
	for range 2 { // second Verify must be served from cache
		claims, err := v.Verify(t.Context(), tokenA)
		if err != nil || claims.Subject != "user-1" {
			t.Fatalf("Verify: (%+v, %v)", claims, err)
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("requests = %d, want one fetch while cache is fresh", requests.Load())
	}
	mode.Store(1)
	tokenB := validJWKSTokenSpec().with(func(s *jwksTokenSpec) { s.kid = "kid-b" })
	mustVerify(t, v, tokenB)
	mustVerify(t, v, tokenB)
	if requests.Load() != 2 {
		t.Fatalf("requests = %d, want one forced rotation refresh", requests.Load())
	}
	mustErr(t, v, validJWKSTokenSpec())
	if requests.Load() != 3 {
		t.Fatalf("requests = %d, removed kid must get exactly one retry", requests.Load())
	}
	now = now.Add(2 * time.Minute)
	if claims := mustVerify(t, v, tokenB); claims.Subject != "user-1" {
		t.Fatalf("subject = %q after TTL refresh", claims.Subject)
	}
	if requests.Load() != 4 {
		t.Fatalf("requests = %d, want refresh after injected TTL expiry", requests.Load())
	}
}
