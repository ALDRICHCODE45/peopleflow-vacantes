package requestmeta_test

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
)

// Regression probes from the independent 2a verification (audit-log-v1 §4).

func probe(t *testing.T, cfg requestmeta.Config, mutate func(*http.Request)) requestmeta.Meta {
	t.Helper()
	var got requestmeta.Meta
	var ok bool
	h := requestmeta.Middleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got, ok = requestmeta.FromContext(r.Context()) }))
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.RemoteAddr = "203.0.113.9:4444"
	r.Header.Set("User-Agent", "real-ua")
	mutate(r)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if !ok {
		t.Fatal("no meta in context")
	}
	if rec.Header().Get("X-PF-Proxy-Secret") != "" || rec.Body.Len() != 0 {
		t.Fatal("middleware wrote to the response")
	}
	return got
}

const probeSecret = "0123456789abcdef0123456789abcdef"

func TestVerifyProbe_ForgeryVariantsStayPeer(t *testing.T) {
	cases := map[string]func(*http.Request){
		"prefix":    func(r *http.Request) { r.Header.Set("X-PF-Proxy-Secret", probeSecret[:31]) },
		"extended":  func(r *http.Request) { r.Header.Set("X-PF-Proxy-Secret", probeSecret+"x") },
		"empty":     func(r *http.Request) { r.Header.Set("X-PF-Proxy-Secret", "") },
		"uppercase": func(r *http.Request) { r.Header.Set("X-PF-Proxy-Secret", "0123456789ABCDEF0123456789ABCDEF") },
		"second value": func(r *http.Request) {
			r.Header.Add("X-PF-Proxy-Secret", "nope")
			r.Header.Add("X-PF-Proxy-Secret", probeSecret)
		},
		"absent+xff": func(r *http.Request) { r.Header.Set("X-Forwarded-For", "1.2.3.4") },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			got := probe(t, requestmeta.Config{ProxySecret: probeSecret}, func(r *http.Request) {
				r.Header.Set("X-PF-Client-IP", "8.8.8.8")
				r.Header.Set("X-PF-Client-User-Agent", "forged-ua")
				mutate(r)
			})
			if got.IPSource != "peer" || got.IP == nil || *got.IP != netip.MustParseAddr("203.0.113.9") || got.UserAgent == nil || *got.UserAgent != "real-ua" {
				t.Fatalf("forged headers trusted: %+v ip=%v ua=%v", got, got.IP, got.UserAgent)
			}
		})
	}
}

func TestVerifyProbe_EmptySecretConfigNeverTrustsEmptyHeader(t *testing.T) {
	got := probe(t, requestmeta.Config{ProxySecret: ""}, func(r *http.Request) {
		r.Header["X-Pf-Proxy-Secret"] = []string{""}
		r.Header.Set("X-PF-Client-IP", "8.8.8.8")
	})
	if got.IPSource != "peer" {
		t.Fatalf("empty probeSecret trusted: %+v", got)
	}
}

func TestVerifyProbe_MatchUsesClientHeadersAndIgnoresOwnUA(t *testing.T) {
	got := probe(t, requestmeta.Config{ProxySecret: probeSecret}, func(r *http.Request) {
		r.Header.Set("x-pf-proxy-secret", probeSecret)
		r.Header.Set("X-PF-Client-IP", "::ffff:198.51.100.7")
	})
	if got.IPSource != "bff" || got.IP == nil || got.IP.String() != "198.51.100.7" || got.UserAgent != nil {
		t.Fatalf("bff path: %+v ip=%v ua=%v", got, got.IP, got.UserAgent)
	}
}

func TestVerifyProbe_UntrustedPeerCannotUseXFF(t *testing.T) {
	got := probe(t, requestmeta.Config{TrustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}}, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "1.2.3.4")
	})
	if got.IP.String() != "203.0.113.9" {
		t.Fatalf("xff from untrusted peer used: %v", got.IP)
	}
	got = probe(t, requestmeta.Config{TrustedProxies: []netip.Prefix{netip.MustParsePrefix("203.0.113.0/24")}}, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "1.2.3.4, 203.0.113.5")
	})
	if got.IP.String() != "1.2.3.4" {
		t.Fatalf("trusted chain: %v", got.IP)
	}
}
