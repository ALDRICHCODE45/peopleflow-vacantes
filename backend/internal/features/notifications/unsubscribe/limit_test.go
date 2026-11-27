package unsubscribe

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
	"github.com/google/uuid"
)

// metaRequest returns the request as the production router hands it to the
// handler: requestmeta has already resolved the client.
func metaRequest(cfg requestmeta.Config, remote string, headers ...string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/v2/notifications/unsubscribe?token=x", nil)
	req.RemoteAddr = remote
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	var out *http.Request
	requestmeta.Middleware(cfg)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { out = r })).ServeHTTP(httptest.NewRecorder(), req)
	return out
}

func ipRequest(remote string) *http.Request { return metaRequest(requestmeta.Config{}, remote) }

func TestDefaultLimitsMatchTheContract(t *testing.T) {
	if l := DefaultLimits(); l.PerIP != 60 || l.PerToken != 10 || l.Window != 10*time.Minute || l.MaxKeys <= 0 {
		t.Fatalf("%+v: contract says 60 invalid requests / 10 min per IP and 10 / 10 min per token, per instance", l)
	}
}

func TestInvalidRequestsArePerIPFixedWindow(t *testing.T) {
	now := t0
	l := NewLimiter(Limits{PerIP: 3, PerToken: 1, Window: 10 * time.Minute, MaxKeys: 100}, clock(&now))
	for i := 0; i < 3; i++ {
		if wait := l.AdmitInvalid(ipRequest("198.51.100.7:1000")); wait != 0 {
			t.Fatalf("request %d: wait %v", i, wait)
		}
	}
	now = t0.Add(4 * time.Minute)
	if wait := l.AdmitInvalid(ipRequest("198.51.100.7:2000")); wait != 6*time.Minute {
		t.Fatalf("over the limit: wait %v, want the rest of the window", wait)
	}
	if wait := l.AdmitInvalid(ipRequest("198.51.100.8:1000")); wait != 0 {
		t.Fatalf("other ip: %v", wait)
	}
	// Rejections consume nothing: the window still ends at t0+10m.
	for i := 0; i < 5; i++ {
		l.AdmitInvalid(ipRequest("198.51.100.7:1000"))
	}
	now = t0.Add(10 * time.Minute)
	if wait := l.AdmitInvalid(ipRequest("198.51.100.7:1000")); wait != 0 {
		t.Fatalf("new window: %v", wait)
	}
}

// Valid tokens never touch the IP budget: they are limited per preference key,
// so a mail provider or the BFF relaying many people's one-clicks from one IP
// never loses a legitimate unsubscribe.
func TestValidRequestsArePerTokenNotPerIP(t *testing.T) {
	now := t0
	l := NewLimiter(Limits{PerIP: 1, PerToken: 2, Window: time.Minute, MaxKeys: 1000}, clock(&now))
	if wait := l.AdmitInvalid(ipRequest("198.51.100.1:1")); wait != 0 {
		t.Fatal(wait)
	}
	if wait := l.AdmitInvalid(ipRequest("198.51.100.1:1")); wait == 0 {
		t.Fatal("the IP's invalid budget is spent")
	}
	for i := 0; i < 200; i++ {
		if wait := l.AdmitValid(memberKey()); wait != 0 {
			t.Fatalf("distinct valid key %d: %v", i, wait)
		}
	}
	k := candidateKey()
	for i := 0; i < 2; i++ {
		if wait := l.AdmitValid(k); wait != 0 {
			t.Fatalf("same key %d: %v", i, wait)
		}
	}
	if wait := l.AdmitValid(k); wait != time.Minute {
		t.Fatalf("same key over its budget: %v", wait)
	}
	// The key, not the token text: another token of the same key shares it.
	if wait := l.AdmitValid(domain.PreferenceKey{User: k.User, Company: k.Company, Type: k.Type}); wait == 0 {
		t.Fatal("same preference key must share the budget")
	}
}

func TestInvalidBucketsIPv6By64(t *testing.T) {
	now := t0
	l := NewLimiter(Limits{PerIP: 1, PerToken: 1, Window: time.Minute, MaxKeys: 100}, clock(&now))
	if wait := l.AdmitInvalid(ipRequest("[2001:db8:1:2::1]:1")); wait != 0 {
		t.Fatal(wait)
	}
	if wait := l.AdmitInvalid(ipRequest("[2001:db8:1:2:ffff::9]:1")); wait == 0 {
		t.Fatal("same /64 must share the budget")
	}
	if wait := l.AdmitInvalid(ipRequest("[2001:db8:1:3::1]:1")); wait != 0 {
		t.Fatalf("another /64: %v", wait)
	}
}

// L6: the invalid budget keys on the client IP requestmeta resolved (BFF secret
// or TRUSTED_PROXY_CIDRS), never on a header an untrusted caller can set.
func TestInvalidUsesTheTrustedClientIP(t *testing.T) {
	now := t0
	cfg := requestmeta.Config{ProxySecret: "bff-secret", TrustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}}
	l := NewLimiter(Limits{PerIP: 1, PerToken: 1, Window: time.Minute, MaxKeys: 100}, clock(&now))
	admit := func(remote string, headers ...string) time.Duration {
		return l.AdmitInvalid(metaRequest(cfg, remote, headers...))
	}
	bff := func(client string) time.Duration {
		return admit("10.1.2.3:443", "X-PF-Proxy-Secret", "bff-secret", "X-PF-Client-IP", client)
	}
	if bff("192.0.2.10") != 0 || bff("192.0.2.11") != 0 {
		t.Fatal("two clients behind the same BFF have separate budgets")
	}
	if bff("192.0.2.10") == 0 {
		t.Fatal("first client again")
	}
	if admit("203.0.113.1:1", "X-PF-Client-IP", "192.0.2.99") != 0 {
		t.Fatal("first forged")
	}
	if admit("203.0.113.1:2", "X-PF-Client-IP", "192.0.2.98") == 0 {
		t.Fatal("a forged header without the secret must not create a new budget")
	}
	if admit("10.9.9.9:1", "X-Forwarded-For", "198.51.100.50") != 0 || admit("10.9.9.9:1", "X-Forwarded-For", "198.51.100.51") != 0 {
		t.Fatal("forwarded clients of a trusted proxy have their own budgets")
	}
	if admit("198.51.100.60:1", "X-Forwarded-For", "198.51.100.61") != 0 || admit("198.51.100.60:1", "X-Forwarded-For", "198.51.100.62") == 0 {
		t.Fatal("an untrusted peer's XFF must be ignored")
	}
	// No request metadata: one shared "unknown" bucket.
	bare := httptest.NewRequest(http.MethodPost, "/", nil)
	if l.AdmitInvalid(bare) != 0 || l.AdmitInvalid(httptest.NewRequest(http.MethodPost, "/", nil)) == 0 {
		t.Fatal("requests without metadata share one bucket")
	}
}

// A full key table never refuses a new client: a flood of distinct keys evicts
// one-request entries (oldest first), so a legitimate newcomer is admitted and
// a client that already spent its budget keeps it (no reset by flooding).
func TestKeyTableFloodEvictsInsteadOfFailingClosed(t *testing.T) {
	now := t0
	l := NewLimiter(Limits{PerIP: 3, PerToken: 3, Window: time.Minute, MaxKeys: 8}, clock(&now))
	heavy := "198.51.100.200:1"
	for i := 0; i < 3; i++ {
		if l.AdmitInvalid(ipRequest(heavy)) != 0 {
			t.Fatal("heavy client setup")
		}
	}
	half := "198.51.100.201:1"
	for i := 0; i < 2; i++ {
		l.AdmitInvalid(ipRequest(half))
	}
	for i := 0; i < 5000; i++ {
		if wait := l.AdmitInvalid(ipRequest(fmt.Sprintf("10.%d.%d.%d:1", i>>16&255, i>>8&255, i&255))); wait != 0 {
			t.Fatalf("flood key %d refused (%v): a full table must evict, not fail closed", i, wait)
		}
		if n := l.invalid.len(); n > 8 {
			t.Fatalf("table grew to %d over the cap", n)
		}
	}
	if wait := l.AdmitInvalid(ipRequest("192.0.2.77:1")); wait != 0 {
		t.Fatalf("legitimate new client refused after the flood: %v", wait)
	}
	if wait := l.AdmitInvalid(ipRequest(heavy)); wait == 0 {
		t.Fatal("the flood reset an exhausted client's budget")
	}
	if l.AdmitInvalid(ipRequest(half)) != 0 || l.AdmitInvalid(ipRequest(half)) == 0 {
		t.Fatal("the flood reset a partly spent client's budget")
	}
	// The same for valid-token keys.
	k := memberKey()
	for i := 0; i < 3; i++ {
		l.AdmitValid(k)
	}
	for i := 0; i < 5000; i++ {
		if wait := l.AdmitValid(domain.PreferenceKey{User: uuid.New(), Company: k.Company, Type: k.Type}); wait != 0 {
			t.Fatalf("valid flood key %d refused: %v", i, wait)
		}
	}
	if l.AdmitValid(k) == 0 {
		t.Fatal("the flood reset an exhausted token's budget")
	}
	// Windows end: expired entries are reclaimed and budgets restart.
	now = t0.Add(time.Minute)
	if l.AdmitInvalid(ipRequest(heavy)) != 0 || l.AdmitValid(k) != 0 {
		t.Fatal("budgets restart in the next window")
	}
}

// When every entry is a protected (multi-request) client, the oldest one goes:
// still no refusal for a newcomer.
func TestKeyTableFullOfHeavyClientsStillAdmits(t *testing.T) {
	now := t0
	l := NewLimiter(Limits{PerIP: 5, PerToken: 5, Window: time.Minute, MaxKeys: 3}, clock(&now))
	for _, ip := range []string{"192.0.2.1:1", "192.0.2.2:1", "192.0.2.3:1"} {
		l.AdmitInvalid(ipRequest(ip))
		l.AdmitInvalid(ipRequest(ip))
	}
	if wait := l.AdmitInvalid(ipRequest("192.0.2.4:1")); wait != 0 || l.invalid.len() != 3 {
		t.Fatalf("newcomer: %v len=%d", wait, l.invalid.len())
	}
}

// Zero limits refuse everything instead of serving unlimited.
func TestZeroLimitsRefuse(t *testing.T) {
	now := t0
	l := NewLimiter(Limits{}, clock(&now))
	if l.AdmitInvalid(ipRequest("198.51.100.5:1")) == 0 || l.AdmitValid(memberKey()) == 0 {
		t.Fatal("zero limits must refuse")
	}
}
