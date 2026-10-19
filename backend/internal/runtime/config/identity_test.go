package config

import "testing"

func TestIdentityUserInfoEndpoint(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		valid     bool
	}{
		{"absent", "", true}, {"https", "https://pool.example.com/oauth2/userInfo", true},
		{"http", "http://pool.example.com/oauth2/userInfo", false}, {"credentials", "https://user:pass@pool.example.com/oauth2/userInfo", false},
		{"query", "https://pool.example.com/oauth2/userInfo?x=y", false}, {"fragment", "https://pool.example.com/oauth2/userInfo#x", false},
		{"wrong path", "https://pool.example.com/other", false}, {"relative", "/oauth2/userInfo", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := LoadIdentityConfig(func(key string) string {
				if key != "IDENTITY_USERINFO_ENDPOINT" {
					t.Fatalf("unexpected setting %s", key)
				}
				return tc.raw
			})
			if (err == nil) != tc.valid {
				t.Fatalf("error = %v", err)
			}
			if err != nil && cfg.UserInfoEndpoint != "" {
				t.Fatal("invalid endpoint retained")
			}
			if err == nil && cfg.UserInfoEndpoint != tc.raw {
				t.Fatal("endpoint changed")
			}
		})
	}
}
