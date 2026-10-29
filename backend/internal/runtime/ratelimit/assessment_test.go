package ratelimit_test

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/ratelimit"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

const unknownToken = "unknown"

// harness mounts the limiter like the production public group: the handler
// answers assessment_unavailable for unknownToken and 200 otherwise.
func harness(l ratelimit.Limits, trusted []netip.Prefix) (http.Handler, *clock, *atomic.Int64) {
	c := &clock{t: time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)}
	calls := new(atomic.Int64)
	lim := ratelimit.NewAssessment(l, trusted, c.now)
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(lim.Middleware)
		r.Get("/v2/assessments/{token}", func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			if chi.URLParam(r, "token") == unknownToken {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeAssessmentUnavailable))
				return
			}
			w.WriteHeader(http.StatusOK)
		})
	})
	return r, c, calls
}

func do(h http.Handler, token, remote, xff string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/v2/assessments/"+token, nil)
	req.RemoteAddr = remote
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func assertLimited(t *testing.T, rec *httptest.ResponseRecorder, retry string) {
	t.Helper()
	if rec.Code != 429 || rec.Header().Get("Retry-After") != retry || rec.Body.String() != "{\"error\":\"too many requests\",\"code\":\"rate_limited\"}\n" {
		t.Fatalf("want 429 Retry-After %s, got %d %q %q", retry, rec.Code, rec.Header().Get("Retry-After"), rec.Body.String())
	}
}

func TestDefaultLimitsMatchContract(t *testing.T) {
	l := ratelimit.DefaultLimits()
	if l.PerToken != 300 || l.PerIP != 600 || l.UnknownPerIP != 30 || l.Window != 10*time.Minute || l.MaxKeys != 100000 {
		t.Fatalf("%+v", l)
	}
}

func TestPerTokenLimitAcrossIPsAndWindowReset(t *testing.T) {
	h, c, calls := harness(ratelimit.Limits{PerToken: 3, PerIP: 100, UnknownPerIP: 100, Window: 10 * time.Minute, MaxKeys: 100}, nil)
	for i := 0; i < 3; i++ {
		if rec := do(h, "tok", "192.0.2."+strconv.Itoa(i+1)+":1000", ""); rec.Code != 200 {
			t.Fatal(i, rec.Code)
		}
	}
	c.add(4 * time.Minute)
	assertLimited(t, do(h, "tok", "192.0.2.9:1000", ""), "360")
	if calls.Load() != 3 {
		t.Fatal("limited request reached the handler", calls.Load())
	}
	if rec := do(h, "other", "192.0.2.9:1000", ""); rec.Code != 200 {
		t.Fatal("other token limited", rec.Code)
	}
	c.add(6 * time.Minute)
	if rec := do(h, "tok", "192.0.2.9:1000", ""); rec.Code != 200 {
		t.Fatal("window did not reset", rec.Code)
	}
}

func TestPerIPLimitAcrossTokens(t *testing.T) {
	h, _, _ := harness(ratelimit.Limits{PerToken: 100, PerIP: 2, UnknownPerIP: 100, Window: time.Minute, MaxKeys: 100}, nil)
	for _, tok := range []string{"a", "b"} {
		if rec := do(h, tok, "198.51.100.7:1", ""); rec.Code != 200 {
			t.Fatal(rec.Code)
		}
	}
	assertLimited(t, do(h, "c", "198.51.100.7:2", ""), "60")
	if rec := do(h, "c", "198.51.100.8:1", ""); rec.Code != 200 {
		t.Fatal("other IP limited", rec.Code)
	}
}

func TestUnknownLookupsBlockTheIP(t *testing.T) {
	h, _, calls := harness(ratelimit.Limits{PerToken: 100, PerIP: 100, UnknownPerIP: 2, Window: time.Minute, MaxKeys: 100}, nil)
	for i := 0; i < 2; i++ {
		if rec := do(h, unknownToken, "203.0.113.5:1", ""); rec.Code != 404 {
			t.Fatal(rec.Code)
		}
	}
	// Known tokens still pass until the unknown budget is exhausted; then the
	// whole IP is blocked because the limiter cannot tell tokens apart up front.
	assertLimited(t, do(h, "known", "203.0.113.5:1", ""), "60")
	assertLimited(t, do(h, unknownToken, "203.0.113.5:1", ""), "60")
	if calls.Load() != 2 {
		t.Fatal(calls.Load())
	}
	if rec := do(h, "known", "203.0.113.6:1", ""); rec.Code != 200 {
		t.Fatal("other IP blocked", rec.Code)
	}
}

func TestKnownTokensDoNotConsumeUnknownBudget(t *testing.T) {
	h, _, _ := harness(ratelimit.Limits{PerToken: 100, PerIP: 100, UnknownPerIP: 1, Window: time.Minute, MaxKeys: 100}, nil)
	for i := 0; i < 5; i++ {
		if rec := do(h, "known", "203.0.113.5:1", ""); rec.Code != 200 {
			t.Fatal(i, rec.Code)
		}
	}
}

func TestRetryAfterIsTheLongestExceededWait(t *testing.T) {
	h, c, _ := harness(ratelimit.Limits{PerToken: 1, PerIP: 2, UnknownPerIP: 100, Window: 10 * time.Minute, MaxKeys: 100}, nil)
	do(h, "a", "192.0.2.1:1", "")
	c.add(5 * time.Minute)
	do(h, "b", "192.0.2.2:1", "") // IP .2 window starts 5 min later
	do(h, "c", "192.0.2.2:1", "")
	c.add(time.Minute)
	// token "a" window ends in 4 min, IP .2 window in 9 min.
	assertLimited(t, do(h, "a", "192.0.2.2:1", ""), "540")
}

func TestClientIPWithoutTrustedProxiesIgnoresForwardedFor(t *testing.T) {
	h, _, _ := harness(ratelimit.Limits{PerToken: 100, PerIP: 1, UnknownPerIP: 100, Window: time.Minute, MaxKeys: 100}, nil)
	do(h, "a", "192.0.2.1:1", "198.51.100.1")
	assertLimited(t, do(h, "b", "192.0.2.1:1", "198.51.100.2"), "60")
}

func TestClientIPBehindTrustedProxy(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	h, _, _ := harness(ratelimit.Limits{PerToken: 100, PerIP: 1, UnknownPerIP: 100, Window: time.Minute, MaxKeys: 100}, trusted)
	// The rightmost untrusted hop is the client; a spoofed left entry is ignored.
	if rec := do(h, "a", "10.0.0.5:1", "1.1.1.1, 198.51.100.1, 10.0.0.9"); rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	assertLimited(t, do(h, "b", "10.0.0.6:1", "9.9.9.9, 198.51.100.1"), "60")
	if rec := do(h, "c", "10.0.0.6:1", "198.51.100.2"); rec.Code != 200 {
		t.Fatal("different client limited", rec.Code)
	}
	// An untrusted peer cannot choose its identity through the header.
	if rec := do(h, "d", "192.0.2.50:1", "198.51.100.3"); rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	assertLimited(t, do(h, "e", "192.0.2.50:1", "198.51.100.4"), "60")
	// A malformed header from a trusted proxy falls back to the proxy address.
	if rec := do(h, "f", "10.0.0.7:1", "not-an-ip"); rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	assertLimited(t, do(h, "g", "10.0.0.7:1", "garbage"), "60")
}

func TestIPv6ClientsShareTheirSlash64(t *testing.T) {
	h, _, _ := harness(ratelimit.Limits{PerToken: 100, PerIP: 1, UnknownPerIP: 100, Window: time.Minute, MaxKeys: 100}, nil)
	do(h, "a", "[2001:db8:1:2::1]:1", "")
	assertLimited(t, do(h, "b", "[2001:db8:1:2:ffff::9]:1", ""), "60")
	if rec := do(h, "c", "[2001:db8:1:3::1]:1", ""); rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	// IPv4-mapped IPv6 is the same IPv4 client.
	do(h, "d", "192.0.2.77:1", "")
	assertLimited(t, do(h, "e", "[::ffff:192.0.2.77]:1", ""), "60")
}

func TestMaxKeysFailsClosedAndExpiredKeysAreReclaimed(t *testing.T) {
	// Each request creates a token key and an IP key.
	h, c, _ := harness(ratelimit.Limits{PerToken: 100, PerIP: 100, UnknownPerIP: 100, Window: time.Minute, MaxKeys: 4}, nil)
	do(h, "a", "192.0.2.1:1", "")
	do(h, "b", "192.0.2.2:1", "")
	assertLimited(t, do(h, "c", "192.0.2.3:1", ""), "60")
	if rec := do(h, "a", "192.0.2.1:1", ""); rec.Code != 200 {
		t.Fatal("existing keys must keep working", rec.Code)
	}
	c.add(time.Minute)
	if rec := do(h, "c", "192.0.2.3:1", ""); rec.Code != 200 {
		t.Fatal("expired keys not reclaimed", rec.Code)
	}
}

func TestConcurrentRequestsNeverExceedTheLimit(t *testing.T) {
	h, _, _ := harness(ratelimit.Limits{PerToken: 50, PerIP: 1000, UnknownPerIP: 1000, Window: time.Minute, MaxKeys: 1000}, nil)
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if do(h, "tok", "192.0.2."+strconv.Itoa(i%250)+":1", "").Code == 200 {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if ok != 50 {
		t.Fatal(ok)
	}
}

func TestCatalogCodeStillReachesOuterRecorder(t *testing.T) {
	h, _, _ := harness(ratelimit.DefaultLimits(), nil)
	req := httptest.NewRequest(http.MethodGet, "/v2/assessments/"+unknownToken, nil)
	req.RemoteAddr = "192.0.2.1:1"
	rec := &outer{ResponseRecorder: httptest.NewRecorder()}
	h.ServeHTTP(rec, req)
	if rec.code != string(httpjson.CodeAssessmentUnavailable) {
		t.Fatalf("%q", rec.code)
	}
}

type outer struct {
	*httptest.ResponseRecorder
	code string
}

func (o *outer) RecordCatalogCode(code string) { o.code = code }

// Unknown lookups are reserved at admission, so a concurrent burst cannot
// exceed the budget while earlier requests are still in flight.
func TestConcurrentUnknownBurstNeverExceedsBudget(t *testing.T) {
	l := ratelimit.NewAssessment(ratelimit.DefaultLimits(), nil, nil)
	gate := make(chan struct{})
	var entered atomic.Int64
	h := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entered.Add(1)
		<-gate
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeAssessmentUnavailable))
	}))
	var wg sync.WaitGroup
	limited := new(atomic.Int64)
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = "192.0.2.1:1"
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)
			if rec.Code == 429 {
				limited.Add(1)
			}
		}()
	}
	deadline := time.Now().Add(time.Second)
	for entered.Load()+limited.Load() < 60 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	close(gate)
	wg.Wait()
	if n := entered.Load(); n != 30 || limited.Load() != 30 {
		t.Fatalf("admitted=%d limited=%d, want 30/30", n, limited.Load())
	}
}

// In-flight reservations of requests that turn out to be known are refunded,
// and a block caused only by in-flight reservations asks for a 1 s retry.
func TestInFlightReservationsAreRefundedAndRetrySoon(t *testing.T) {
	c := &clock{t: time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)}
	l := ratelimit.NewAssessment(ratelimit.Limits{PerToken: 100, PerIP: 100, UnknownPerIP: 1, Window: 10 * time.Minute, MaxKeys: 100}, nil, c.now)
	release := make(chan struct{})
	started := make(chan struct{})
	h := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/slow" {
			close(started)
			<-release
		}
		w.WriteHeader(http.StatusOK)
	}))
	send := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		r.RemoteAddr = "192.0.2.1:1"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}
	done := make(chan struct{})
	go func() { send("/slow"); close(done) }()
	<-started
	if rec := send("/fast"); rec.Code != 429 || rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("in-flight block: %d %q", rec.Code, rec.Header().Get("Retry-After"))
	}
	close(release)
	<-done
	for i := 0; i < 3; i++ {
		if rec := send("/fast"); rec.Code != 200 {
			t.Fatal("known request reservation not refunded", i, rec.Code)
		}
	}
}

// A panicking handler must not leak its reservation.
func TestPanicReleasesReservation(t *testing.T) {
	l := ratelimit.NewAssessment(ratelimit.Limits{PerToken: 100, PerIP: 100, UnknownPerIP: 1, Window: time.Minute, MaxKeys: 100}, nil, nil)
	h := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/panic" {
			panic("boom")
		}
		w.WriteHeader(http.StatusOK)
	}))
	send := func(path string) (code int) {
		defer func() { _ = recover() }()
		r := httptest.NewRequest("GET", path, nil)
		r.RemoteAddr = "192.0.2.1:1"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec.Code
	}
	send("/panic")
	if code := send("/ok"); code != 200 {
		t.Fatal("reservation leaked after panic", code)
	}
}
