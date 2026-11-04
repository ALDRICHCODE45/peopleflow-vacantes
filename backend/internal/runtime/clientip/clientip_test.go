package clientip_test

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/clientip"
)

func request(remote string, xff ...string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remote
	for _, v := range xff {
		r.Header.Add("X-Forwarded-For", v)
	}
	return r
}

func TestResolve(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("fd00::/8")}
	for _, tc := range []struct {
		name    string
		trusted []netip.Prefix
		req     *http.Request
		want    string // "" = invalid address
	}{
		{"peer without trusted proxies", nil, request("192.0.2.1:4000"), "192.0.2.1"},
		{"untrusted peer ignores the header", trusted, request("192.0.2.1:4000", "198.51.100.9"), "192.0.2.1"},
		{"trusted peer takes the rightmost untrusted hop", trusted, request("10.0.0.5:1", "1.1.1.1, 198.51.100.1, 10.0.0.9"), "198.51.100.1"},
		{"repeated header lines are one list", trusted, request("10.0.0.5:1", "1.1.1.1", "198.51.100.1, 10.0.0.9"), "198.51.100.1"},
		{"all hops trusted falls back to the peer", trusted, request("10.0.0.5:1", "10.0.0.8, 10.0.0.9"), "10.0.0.5"},
		{"malformed header falls back to the peer", trusted, request("10.0.0.7:1", "1.1.1.1, not-an-ip"), "10.0.0.7"},
		{"trusted peer without header is the peer", trusted, request("10.0.0.7:1"), "10.0.0.7"},
		{"ipv4-mapped peer is unmapped", nil, request("[::ffff:192.0.2.77]:1"), "192.0.2.77"},
		{"ipv4-mapped hop is unmapped", trusted, request("10.0.0.5:1", "::ffff:198.51.100.4"), "198.51.100.4"},
		{"ipv6 keeps the full address", nil, request("[2001:db8:1:2::1]:1"), "2001:db8:1:2::1"},
		{"ipv6 trusted peer", trusted, request("[fd00::1]:1", "2001:db8::7"), "2001:db8::7"},
		{"remote without port", nil, request("192.0.2.3"), "192.0.2.3"},
		{"malformed peer is invalid", trusted, request("not-an-ip:1", "198.51.100.1"), ""},
		{"empty peer is invalid", nil, request(""), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := clientip.Resolve(tc.req, tc.trusted)
			if tc.want == "" {
				if got.IsValid() {
					t.Fatalf("want invalid, got %s", got)
				}
				return
			}
			if !got.IsValid() || got.String() != tc.want {
				t.Fatalf("want %s, got %s", tc.want, got)
			}
		})
	}
}

func TestIsTrusted(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	if !clientip.IsTrusted(trusted, netip.MustParseAddr("10.1.2.3")) || clientip.IsTrusted(trusted, netip.MustParseAddr("11.0.0.1")) || clientip.IsTrusted(nil, netip.MustParseAddr("10.1.2.3")) {
		t.Fatal("trusted membership")
	}
}
