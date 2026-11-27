package unsubscribe

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
)

const rateLimitedBody = `{"error":"too many requests","code":"rate_limited"}` + "\n"

// limited serves ok behind the limiter, with requestmeta in front exactly as
// the production router composes it (requestmeta runs first, globally).
func limited(l *Limiter, meta requestmeta.Config) http.Handler {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	return requestmeta.Middleware(meta)(l.Middleware(ok))
}

func hit(h http.Handler, remote string, headers ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v2/notifications/unsubscribe?token=x", nil)
	req.RemoteAddr = remote
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestDefaultLimitsMatchTheContract(t *testing.T) {
	if l := DefaultLimits(); l.PerIP != 60 || l.Window != 10*time.Minute || l.MaxKeys <= 0 {
		t.Fatalf("%+v: contract says 60 requests / 10 min per IP per instance", l)
	}
}

func TestLimiterPerIPFixedWindow(t *testing.T) {
	now := t0
	h := limited(NewLimiter(Limits{PerIP: 3, Window: 10 * time.Minute, MaxKeys: 100}, clock(&now)), requestmeta.Config{})
	for i := 0; i < 3; i++ {
		if rec := hit(h, "198.51.100.7:1000"); rec.Code != http.StatusTeapot {
			t.Fatalf("request %d: %d", i, rec.Code)
		}
	}
	now = t0.Add(4 * time.Minute)
	rec := hit(h, "198.51.100.7:2000")
	if rec.Code != http.StatusTooManyRequests || rec.Body.String() != rateLimitedBody || rec.Header().Get("Retry-After") != "360" {
		t.Fatalf("over the limit: %d %q retry=%q", rec.Code, rec.Body.String(), rec.Header().Get("Retry-After"))
	}
	// Another address has its own budget.
	if rec := hit(h, "198.51.100.8:1000"); rec.Code != http.StatusTeapot {
		t.Fatalf("other ip: %d", rec.Code)
	}
	// Rejections consume nothing: the window still ends at t0+10m.
	for i := 0; i < 5; i++ {
		hit(h, "198.51.100.7:1000")
	}
	now = t0.Add(10 * time.Minute)
	if rec := hit(h, "198.51.100.7:1000"); rec.Code != http.StatusTeapot {
		t.Fatalf("new window: %d", rec.Code)
	}
}

func TestLimiterBucketsIPv6By64(t *testing.T) {
	now := t0
	h := limited(NewLimiter(Limits{PerIP: 1, Window: time.Minute, MaxKeys: 100}, clock(&now)), requestmeta.Config{})
	if rec := hit(h, "[2001:db8:1:2::1]:1"); rec.Code != http.StatusTeapot {
		t.Fatal(rec.Code)
	}
	if rec := hit(h, "[2001:db8:1:2:ffff::9]:1"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("same /64 must share the budget: %d", rec.Code)
	}
	if rec := hit(h, "[2001:db8:1:3::1]:1"); rec.Code != http.StatusTeapot {
		t.Fatalf("another /64: %d", rec.Code)
	}
}

// L6: behind the frontend pass-through the limit keys on the trusted client IP
// that requestmeta resolved (BFF secret or TRUSTED_PROXY_CIDRS), never on a
// header an untrusted caller can set.
func TestLimiterUsesTheTrustedClientIP(t *testing.T) {
	now := t0
	cfg := requestmeta.Config{ProxySecret: "bff-secret", TrustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}}
	h := limited(NewLimiter(Limits{PerIP: 1, Window: time.Minute, MaxKeys: 100}, clock(&now)), cfg)
	next := "203.0.113.1"
	bff := func(client string) *httptest.ResponseRecorder {
		return hit(h, "10.1.2.3:443", "X-PF-Proxy-Secret", "bff-secret", "X-PF-Client-IP", client)
	}
	// Two clients behind the same Next server: separate budgets.
	if rec := bff("192.0.2.10"); rec.Code != http.StatusTeapot {
		t.Fatal(rec.Code)
	}
	if rec := bff("192.0.2.11"); rec.Code != http.StatusTeapot {
		t.Fatalf("second client through the BFF: %d", rec.Code)
	}
	if rec := bff("192.0.2.10"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("first client again: %d", rec.Code)
	}
	// A forged client header without the secret is ignored: the peer is the key.
	if rec := hit(h, next+":1", "X-PF-Client-IP", "192.0.2.99"); rec.Code != http.StatusTeapot {
		t.Fatal(rec.Code)
	}
	if rec := hit(h, next+":2", "X-PF-Client-IP", "192.0.2.98"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("forged header must not create a new budget: %d", rec.Code)
	}
	// X-Forwarded-For counts only from a trusted proxy.
	if rec := hit(h, "10.9.9.9:1", "X-Forwarded-For", "198.51.100.50"); rec.Code != http.StatusTeapot {
		t.Fatal(rec.Code)
	}
	if rec := hit(h, "10.9.9.9:1", "X-Forwarded-For", "198.51.100.51"); rec.Code != http.StatusTeapot {
		t.Fatalf("another forwarded client: %d", rec.Code)
	}
	if rec := hit(h, "198.51.100.60:1", "X-Forwarded-For", "198.51.100.61"); rec.Code != http.StatusTeapot {
		t.Fatal(rec.Code)
	}
	if rec := hit(h, "198.51.100.60:1", "X-Forwarded-For", "198.51.100.62"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("untrusted peer's XFF must be ignored: %d", rec.Code)
	}
}

// Without request metadata (or an unparseable client) every such request
// shares one bucket; a full key table fails closed.
func TestLimiterUnknownClientAndKeyCap(t *testing.T) {
	now := t0
	l := NewLimiter(Limits{PerIP: 1, Window: time.Minute, MaxKeys: 2}, clock(&now))
	bare := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) }))
	if rec := hit(bare, "198.51.100.1:1"); rec.Code != http.StatusTeapot {
		t.Fatal(rec.Code)
	}
	if rec := hit(bare, "198.51.100.2:1"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("no metadata shares one bucket: %d", rec.Code)
	}
	h := limited(l, requestmeta.Config{})
	if rec := hit(h, "198.51.100.3:1"); rec.Code != http.StatusTeapot {
		t.Fatal(rec.Code)
	}
	rec := hit(h, "198.51.100.4:1")
	if rec.Code != http.StatusTooManyRequests || rec.Body.String() != rateLimitedBody {
		t.Fatalf("key cap must fail closed: %d %s", rec.Code, rec.Body.String())
	}
	// Expired keys are reclaimed.
	now = t0.Add(time.Minute)
	if rec := hit(h, "198.51.100.4:1"); rec.Code != http.StatusTeapot {
		t.Fatalf("after the window: %d", rec.Code)
	}
	// A zero limit refuses everything instead of serving unlimited.
	zero := limited(NewLimiter(Limits{}, clock(&now)), requestmeta.Config{})
	if rec := hit(zero, "198.51.100.5:1"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("zero limits: %d", rec.Code)
	}
}
