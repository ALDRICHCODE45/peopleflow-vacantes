package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
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
	v, err := NewJWKSVerifier(JWKSVerifierConfig{JWKSURL: srv.URL, CacheTTL: time.Second, FetchTimeout: time.Second})
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

func TestJWKSVerifier_VerifyStub(t *testing.T) {
	v := newTestJWKSVerifier(t, func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected fetch") })
	if _, err := v.Verify(t.Context(), "token"); !errors.Is(err, errJWKSVerifyNotImplemented) {
		t.Fatalf("Verify error = %v, want not implemented", err)
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
