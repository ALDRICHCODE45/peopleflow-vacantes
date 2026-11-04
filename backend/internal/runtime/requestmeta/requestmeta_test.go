package requestmeta_test

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
)

const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// capture runs one request through the middleware and returns the metadata the
// downstream handler saw.
func capture(t *testing.T, cfg requestmeta.Config, remote string, headers map[string][]string) (requestmeta.Meta, *httptest.ResponseRecorder) {
	t.Helper()
	var got requestmeta.Meta
	var ok bool
	h := requestmeta.Middleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok = requestmeta.FromContext(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = remote
	req.Header.Del("User-Agent")
	for k, vs := range headers {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !ok {
		t.Fatal("no metadata in the request context")
	}
	return got, rec
}

func one(v string) []string { return []string{v} }

func ipString(m requestmeta.Meta) string {
	if m.IP == nil {
		return "<nil>"
	}
	return m.IP.String()
}

func uaString(m requestmeta.Meta) string {
	if m.UserAgent == nil {
		return "<nil>"
	}
	return *m.UserAgent
}

func TestMatchingSecretTrustsClientHeaders(t *testing.T) {
	m, _ := capture(t, requestmeta.Config{ProxySecret: secret}, "203.0.113.5:443", map[string][]string{
		"X-PF-Proxy-Secret":      one(secret),
		"X-PF-Client-IP":         one("201.141.12.7"),
		"X-PF-Client-User-Agent": one("Mozilla/5.0 (browser)"),
		"User-Agent":             one("node-fetch"),
	})
	if m.IPSource != requestmeta.SourceBFF || ipString(m) != "201.141.12.7" || uaString(m) != "Mozilla/5.0 (browser)" {
		t.Fatalf("got %s %s %s", m.IPSource, ipString(m), uaString(m))
	}
}

func TestMatchingSecretNormalisesTheClientIP(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{" 201.141.12.7 ", "201.141.12.7"},
		{"::ffff:201.141.12.7", "201.141.12.7"},
		{"2001:db8::7", "2001:db8::7"},
		{"fe80::1%eth0", "fe80::1"},
	} {
		m, _ := capture(t, requestmeta.Config{ProxySecret: secret}, "203.0.113.5:443", map[string][]string{
			"X-PF-Proxy-Secret": one(secret), "X-PF-Client-IP": one(tc.in),
		})
		if m.IPSource != requestmeta.SourceBFF || ipString(m) != tc.want {
			t.Errorf("%q: got %s %s, want bff %s", tc.in, m.IPSource, ipString(m), tc.want)
		}
	}
}

func TestMatchingSecretWithInvalidOrMissingIPKeepsBFFWithNilIP(t *testing.T) {
	for _, headers := range []map[string][]string{
		{"X-PF-Proxy-Secret": one(secret), "X-PF-Client-IP": one("not-an-ip")},
		{"X-PF-Proxy-Secret": one(secret), "X-PF-Client-IP": one("1.2.3.4, 5.6.7.8")},
		{"X-PF-Proxy-Secret": one(secret), "X-PF-Client-IP": one("")},
		{"X-PF-Proxy-Secret": one(secret)},
	} {
		m, _ := capture(t, requestmeta.Config{ProxySecret: secret}, "203.0.113.5:443", headers)
		if m.IPSource != requestmeta.SourceBFF || m.IP != nil {
			t.Errorf("%v: got %s %s, want bff <nil>", headers, m.IPSource, ipString(m))
		}
	}
}

func TestWrongSecretIgnoresForgedClientHeaders(t *testing.T) {
	for name, headers := range map[string]map[string][]string{
		"wrong secret": {"X-PF-Proxy-Secret": one(secret + "x"), "X-PF-Client-IP": one("6.6.6.6"), "X-PF-Client-User-Agent": one("forged"), "User-Agent": one("real-agent")},
		"prefix":       {"X-PF-Proxy-Secret": one(secret[:10]), "X-PF-Client-IP": one("6.6.6.6"), "X-PF-Client-User-Agent": one("forged"), "User-Agent": one("real-agent")},
		"absent":       {"X-PF-Client-IP": one("6.6.6.6"), "X-PF-Client-User-Agent": one("forged"), "User-Agent": one("real-agent")},
		"empty":        {"X-PF-Proxy-Secret": one(""), "X-PF-Client-IP": one("6.6.6.6"), "X-PF-Client-User-Agent": one("forged"), "User-Agent": one("real-agent")},
	} {
		m, _ := capture(t, requestmeta.Config{ProxySecret: secret}, "203.0.113.5:443", headers)
		if m.IPSource != requestmeta.SourcePeer || ipString(m) != "203.0.113.5" || uaString(m) != "real-agent" {
			t.Errorf("%s: got %s %s %s, want peer 203.0.113.5 real-agent", name, m.IPSource, ipString(m), uaString(m))
		}
	}
}

func TestUnsetSecretNeverTrustsAnyHeader(t *testing.T) {
	for _, cfg := range []requestmeta.Config{{}, {ProxySecret: ""}} {
		for _, sent := range []string{"", "anything", secret} {
			m, _ := capture(t, cfg, "203.0.113.5:443", map[string][]string{
				"X-PF-Proxy-Secret": one(sent), "X-PF-Client-IP": one("6.6.6.6"), "X-PF-Client-User-Agent": one("forged"), "User-Agent": one("real-agent"),
			})
			if m.IPSource != requestmeta.SourcePeer || ipString(m) != "203.0.113.5" || uaString(m) != "real-agent" {
				t.Errorf("sent %q: got %s %s %s", sent, m.IPSource, ipString(m), uaString(m))
			}
		}
	}
}

func TestPeerPathUsesTrustedProxyChain(t *testing.T) {
	cfg := requestmeta.Config{ProxySecret: secret, TrustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}}
	m, _ := capture(t, cfg, "10.0.0.5:1", map[string][]string{"X-Forwarded-For": one("1.1.1.1, 198.51.100.1, 10.0.0.9")})
	if m.IPSource != requestmeta.SourcePeer || ipString(m) != "198.51.100.1" {
		t.Fatalf("trusted proxy: got %s %s", m.IPSource, ipString(m))
	}
	m, _ = capture(t, cfg, "192.0.2.50:1", map[string][]string{"X-Forwarded-For": one("198.51.100.3")})
	if ipString(m) != "192.0.2.50" {
		t.Fatalf("untrusted peer chose its identity: %s", ipString(m))
	}
	// X-Forwarded-For is never read on the bff path: the forwarded header decides.
	m, _ = capture(t, cfg, "10.0.0.5:1", map[string][]string{"X-PF-Proxy-Secret": one(secret), "X-PF-Client-IP": one("201.141.12.7"), "X-Forwarded-For": one("198.51.100.1")})
	if m.IPSource != requestmeta.SourceBFF || ipString(m) != "201.141.12.7" {
		t.Fatalf("bff: got %s %s", m.IPSource, ipString(m))
	}
}

func TestMalformedPeerHasNilIPAndStillPeer(t *testing.T) {
	m, _ := capture(t, requestmeta.Config{}, "garbage", nil)
	if m.IPSource != requestmeta.SourcePeer || m.IP != nil {
		t.Fatalf("got %s %s", m.IPSource, ipString(m))
	}
}

func TestUserAgentTruncationAndEmpty(t *testing.T) {
	cfg := requestmeta.Config{ProxySecret: secret}
	long := strings.Repeat("a", 600)
	// 511 ASCII bytes then a 2-byte rune that straddles byte 512: cut before it.
	straddle := strings.Repeat("a", 511) + "é" + "tail"
	exact := strings.Repeat("a", 512)
	for name, tc := range map[string]struct {
		in   string
		want string
	}{
		"long ascii":    {long, long[:512]},
		"straddle":      {straddle, strings.Repeat("a", 511)},
		"exact":         {exact, exact},
		"invalid utf-8": {"ok\xff\xfeend", "ok\uFFFD" + "end"},
		"empty":         {"", "<nil>"},
		"blank":         {"   ", "<nil>"},
	} {
		for path, headers := range map[string]map[string][]string{
			"peer": {"User-Agent": one(tc.in)},
			"bff":  {"X-PF-Proxy-Secret": one(secret), "X-PF-Client-User-Agent": one(tc.in)},
		} {
			m, _ := capture(t, cfg, "203.0.113.5:1", headers)
			got := uaString(m)
			if tc.want == "<nil>" && m.UserAgent != nil || got != tc.want {
				t.Errorf("%s/%s: got %q want %q", name, path, got, tc.want)
			}
			if m.UserAgent != nil && (len(*m.UserAgent) > 512 || !utf8.ValidString(*m.UserAgent)) {
				t.Errorf("%s/%s: not a valid <=512 byte string", name, path)
			}
		}
	}
}

func TestMissingUserAgentIsNil(t *testing.T) {
	m, _ := capture(t, requestmeta.Config{ProxySecret: secret}, "203.0.113.5:1", map[string][]string{"X-PF-Proxy-Secret": one(secret), "X-PF-Client-IP": one("1.2.3.4")})
	if m.UserAgent != nil {
		t.Fatalf("got %q", *m.UserAgent)
	}
}

func TestSecretNeverLoggedEchoedOrStored(t *testing.T) {
	var logs bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(old)
	for _, sent := range []string{secret, secret + "x"} {
		m, rec := capture(t, requestmeta.Config{ProxySecret: secret}, "203.0.113.5:1", map[string][]string{
			"X-PF-Proxy-Secret": one(sent), "X-PF-Client-IP": one("1.2.3.4"), "X-PF-Client-User-Agent": one("ua"),
		})
		if strings.Contains(rec.Body.String(), secret) || strings.Contains(strings.Join(rec.Header().Values("X-PF-Proxy-Secret"), ","), secret) || len(rec.Header()) != 0 {
			t.Fatalf("the middleware wrote to the response: %v %q", rec.Header(), rec.Body.String())
		}
		if strings.Contains(strings.ToLower(uaString(m)+ipString(m)+m.IPSource), secret) {
			t.Fatal("secret in metadata")
		}
	}
	if logs.Len() != 0 {
		t.Fatalf("the middleware logged: %q", logs.String())
	}
}

func TestFromContextWithoutMiddleware(t *testing.T) {
	if _, ok := requestmeta.FromContext(context.Background()); ok {
		t.Fatal("bare context must have no metadata")
	}
	want := requestmeta.Meta{IPSource: requestmeta.SourceBFF}
	got, ok := requestmeta.FromContext(requestmeta.NewContext(context.Background(), want))
	if !ok || got.IPSource != requestmeta.SourceBFF {
		t.Fatalf("got %+v %v", got, ok)
	}
}
