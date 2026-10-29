package config

import (
	"net/netip"
	"reflect"
	"strings"
	"testing"
)

func TestLoadTrustedProxyCIDRs(t *testing.T) {
	get := func(v string) func(string) string {
		return func(k string) string {
			if k == "TRUSTED_PROXY_CIDRS" {
				return v
			}
			return ""
		}
	}
	for _, tc := range []struct {
		value string
		want  []netip.Prefix
	}{
		{"", nil},
		{"   ", nil},
		{"10.0.0.0/8", []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}},
		{" 10.0.0.0/8 , 172.16.0.0/12,fd00::/8 ", []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("172.16.0.0/12"), netip.MustParsePrefix("fd00::/8")}},
		{"10.1.2.3/8", []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}},
	} {
		got, err := LoadTrustedProxyCIDRs(get(tc.value))
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%q: %v %v", tc.value, got, err)
		}
	}
	for _, bad := range []string{"secret-host", "10.0.0.1", "10.0.0.0/33", "10.0.0.0/8,,172.16.0.0/12", "0.0.0.0/0", "::/0"} {
		got, err := LoadTrustedProxyCIDRs(get(bad))
		if err == nil || got != nil {
			t.Fatalf("%q accepted: %v", bad, got)
		}
		if strings.Contains(err.Error(), bad) || err.Error() != "TRUSTED_PROXY_CIDRS must be a comma-separated list of non-default CIDR prefixes" {
			t.Fatalf("%q: %v", bad, err)
		}
	}
}
