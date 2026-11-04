package config

import "testing"

func TestLoadAuditProxySecret(t *testing.T) {
	get := func(v string) func(string) string {
		return func(k string) string {
			if k == "AUDIT_PROXY_SECRET" {
				return v
			}
			return "unrelated"
		}
	}
	for _, tc := range []struct{ value, want string }{
		{"", ""},
		{"   ", ""},
		{"abc123", "abc123"},
		{"  abc123\n", "abc123"},
	} {
		if got := LoadAuditProxySecret(get(tc.value)); got != tc.want {
			t.Errorf("%q: got %q, want %q", tc.value, got, tc.want)
		}
	}
}
