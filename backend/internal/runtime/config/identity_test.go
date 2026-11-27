package config

import (
	"strings"
	"testing"
)

func identityEnv(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

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
				if key == "IDENTITY_USERINFO_ENDPOINT" {
					return tc.raw
				}
				return ""
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
			// D8: unset IDENTITY_PROVIDER keeps the legacy selection.
			want := IdentityProviderNone
			if tc.raw != "" {
				want = IdentityProviderUserInfo
			}
			if err == nil && cfg.Provider != want {
				t.Fatalf("provider = %q, want %q", cfg.Provider, want)
			}
		})
	}
}

// embedded-auth-v1 D8, D14: provider selection, region and loopback override,
// mixed/partial refusals and the production issuer-region rule.
func TestIdentityProviderSelection(t *testing.T) {
	const (
		userInfo   = "https://pool.example.com/oauth2/userInfo"
		issuerEast = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE"
	)
	type env = map[string]string
	type providerCase struct {
		name     string
		env      env
		provider IdentityProvider
		endpoint string
		errKey   string // the key the startup error must name
	}
	ok := func(name string, e env, provider IdentityProvider, endpoint string) providerCase {
		return providerCase{name: name, env: e, provider: provider, endpoint: endpoint}
	}
	bad := func(name string, e env, errKey string) providerCase {
		return providerCase{name: name, env: e, errKey: errKey}
	}
	getuser := func(extra env) env {
		e := env{"IDENTITY_PROVIDER": "cognito_getuser", "IDENTITY_COGNITO_REGION": "us-east-1", "APP_ENV": "production"}
		for k, v := range extra {
			e[k] = v
		}
		return e
	}
	cases := []providerCase{
		ok("unset everything", env{}, IdentityProviderNone, ""),
		ok("unset with legacy userinfo", env{"IDENTITY_USERINFO_ENDPOINT": userInfo}, IdentityProviderUserInfo, ""),
		bad("unset with region", env{"IDENTITY_COGNITO_REGION": "us-east-1"}, "IDENTITY_COGNITO_REGION"),
		bad("unset with endpoint", env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599"}, "IDENTITY_COGNITO_ENDPOINT"),
		ok("explicit userinfo", env{"IDENTITY_PROVIDER": "userinfo", "IDENTITY_USERINFO_ENDPOINT": userInfo}, IdentityProviderUserInfo, ""),
		bad("userinfo without endpoint", env{"IDENTITY_PROVIDER": "userinfo"}, "IDENTITY_USERINFO_ENDPOINT"),
		bad("userinfo with region", env{"IDENTITY_PROVIDER": "userinfo", "IDENTITY_USERINFO_ENDPOINT": userInfo, "IDENTITY_COGNITO_REGION": "us-east-1"}, "IDENTITY_COGNITO_REGION"),
		bad("userinfo with cognito endpoint", env{"IDENTITY_PROVIDER": "userinfo", "IDENTITY_USERINFO_ENDPOINT": userInfo, "APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599"}, "IDENTITY_COGNITO_ENDPOINT"),
		bad("unknown provider", env{"IDENTITY_PROVIDER": "cognito"}, "IDENTITY_PROVIDER"),
		bad("provider not lowercase", env{"IDENTITY_PROVIDER": "Cognito_GetUser", "IDENTITY_COGNITO_REGION": "us-east-1"}, "IDENTITY_PROVIDER"),
		ok("getuser regional production", getuser(nil), IdentityProviderCognitoGetUser, "https://cognito-idp.us-east-1.amazonaws.com/"),
		ok("getuser trimmed provider", getuser(env{"IDENTITY_PROVIDER": "  cognito_getuser  "}), IdentityProviderCognitoGetUser, "https://cognito-idp.us-east-1.amazonaws.com/"),
		ok("getuser gov region", getuser(env{"IDENTITY_COGNITO_REGION": "us-gov-west-1"}), IdentityProviderCognitoGetUser, "https://cognito-idp.us-gov-west-1.amazonaws.com/"),
		bad("getuser without region", getuser(env{"IDENTITY_COGNITO_REGION": ""}), "IDENTITY_COGNITO_REGION"),
		bad("getuser with userinfo", getuser(env{"IDENTITY_USERINFO_ENDPOINT": userInfo}), "IDENTITY_USERINFO_ENDPOINT"),
		bad("region uppercase", getuser(env{"IDENTITY_COGNITO_REGION": "US-EAST-1"}), "IDENTITY_COGNITO_REGION"),
		bad("region no number", getuser(env{"IDENTITY_COGNITO_REGION": "us-east"}), "IDENTITY_COGNITO_REGION"),
		bad("region host injection", getuser(env{"IDENTITY_COGNITO_REGION": "us-east-1.evil.example"}), "IDENTITY_COGNITO_REGION"),
		bad("region path injection", getuser(env{"IDENTITY_COGNITO_REGION": "us-east-1/x"}), "IDENTITY_COGNITO_REGION"),
		bad("region underscore", getuser(env{"IDENTITY_COGNITO_REGION": "us_east_1"}), "IDENTITY_COGNITO_REGION"),
		ok("override test ipv4", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599"}), IdentityProviderCognitoGetUser, "http://127.0.0.1:4599/"),
		ok("override local localhost slash", getuser(env{"APP_ENV": "local", "IDENTITY_COGNITO_ENDPOINT": "http://localhost:4599/"}), IdentityProviderCognitoGetUser, "http://localhost:4599/"),
		ok("override loopback block https", getuser(env{"APP_ENV": " Test ", "IDENTITY_COGNITO_ENDPOINT": "https://127.8.9.10"}), IdentityProviderCognitoGetUser, "https://127.8.9.10/"),
		ok("override ipv6 loopback", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://[::1]:4599"}), IdentityProviderCognitoGetUser, "http://[::1]:4599/"),
		bad("override in production", getuser(env{"IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override without APP_ENV", getuser(env{"APP_ENV": "", "IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override non-loopback", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://cognito.example.com"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override private ip", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://10.0.0.1:4599"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override unspecified", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://0.0.0.0:4599"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override lookalike host", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://localhost.evil.example"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override path", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599/x"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override query", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599/?a=b"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override fragment", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599/#a"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override credentials", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http://u:p@127.0.0.1:4599"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override scheme", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "ftp://127.0.0.1:4599"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override opaque", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_ENDPOINT": "http:127.0.0.1"}), "IDENTITY_COGNITO_ENDPOINT"),
		bad("override still needs region", getuser(env{"APP_ENV": "test", "IDENTITY_COGNITO_REGION": "", "IDENTITY_COGNITO_ENDPOINT": "http://127.0.0.1:4599"}), "IDENTITY_COGNITO_REGION"),
		ok("D14 production jwks matching region", getuser(env{"IDENTITY_JWT_MODE": "jwks", "IDENTITY_JWT_ISSUER": issuerEast}), IdentityProviderCognitoGetUser, "https://cognito-idp.us-east-1.amazonaws.com/"),
		bad("D14 production jwks other region", getuser(env{"IDENTITY_JWT_MODE": " JWKS ", "IDENTITY_JWT_ISSUER": issuerEast, "IDENTITY_COGNITO_REGION": "us-west-2"}), "IDENTITY_COGNITO_REGION"),
		bad("D14 normalized APP_ENV", getuser(env{"APP_ENV": " Production ", "IDENTITY_JWT_MODE": "jwks", "IDENTITY_JWT_ISSUER": issuerEast, "IDENTITY_COGNITO_REGION": "eu-west-1"}), "IDENTITY_COGNITO_REGION"),
		ok("D14 non-cognito issuer not checked", getuser(env{"IDENTITY_JWT_MODE": "jwks", "IDENTITY_JWT_ISSUER": "https://auth.example.com/pool", "IDENTITY_COGNITO_REGION": "us-west-2"}), IdentityProviderCognitoGetUser, "https://cognito-idp.us-west-2.amazonaws.com/"),
		ok("D14 only in production", getuser(env{"APP_ENV": "local", "IDENTITY_JWT_MODE": "jwks", "IDENTITY_JWT_ISSUER": issuerEast, "IDENTITY_COGNITO_REGION": "us-west-2"}), IdentityProviderCognitoGetUser, "https://cognito-idp.us-west-2.amazonaws.com/"),
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := LoadIdentityConfig(identityEnv(tc.env))
			if tc.errKey != "" {
				if err == nil {
					t.Fatalf("want error naming %s, got %+v", tc.errKey, cfg)
				}
				if !strings.Contains(err.Error(), tc.errKey) {
					t.Fatalf("error %q does not name %s", err, tc.errKey)
				}
				// Operator-supplied URLs and regions never reach the message.
				for _, key := range []string{"IDENTITY_COGNITO_ENDPOINT", "IDENTITY_USERINFO_ENDPOINT", "IDENTITY_JWT_ISSUER", "IDENTITY_COGNITO_REGION"} {
					if v := strings.TrimSpace(tc.env[key]); v != "" && v != "us-east-1" && strings.Contains(err.Error(), v) {
						t.Fatalf("error echoes the value of %s: %q", key, err)
					}
				}
				if cfg != (IdentityConfig{}) {
					t.Fatalf("config retained on error: %+v", cfg)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.Provider != tc.provider || cfg.CognitoEndpoint != tc.endpoint {
				t.Fatalf("got provider %q endpoint %q, want %q %q", cfg.Provider, cfg.CognitoEndpoint, tc.provider, tc.endpoint)
			}
			if tc.provider == IdentityProviderCognitoGetUser && cfg.CognitoRegion != strings.TrimSpace(tc.env["IDENTITY_COGNITO_REGION"]) {
				t.Fatalf("region %q", cfg.CognitoRegion)
			}
		})
	}
}

func TestIdentityConfigRequiresLookup(t *testing.T) {
	if _, err := LoadIdentityConfig(nil); err == nil {
		t.Fatal("nil lookup accepted")
	}
}
