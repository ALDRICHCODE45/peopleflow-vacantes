package localbootstrap

import (
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

const (
	testKey    = "0123456789abcdef0123456789abcdef"
	testDomain = "https://example.auth.us-east-1.amazoncognito.com"
	testIssuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE"
	testDSN    = "postgres://admin:not-a-real-secret@127.0.0.1:5432/peopleflow_vacancies"
)

func validConfigEnv() map[string]string {
	return map[string]string{
		EnvEnabled:       "true",
		EnvAppEnv:        "local",
		EnvAddr:          DefaultAddr,
		EnvKey:           testKey,
		EnvUserType:      RequiredUserType,
		EnvCognitoDomain: testDomain,
		EnvDatabaseURL:   testDSN,
		EnvJWTMode:       JWTModeJWKS,
		EnvJWTIssuer:     testIssuer,
		EnvJWTClientID:   "example-client-id",
		EnvJWTTokenUse:   JWSTokenUse,
	}
}

func getenvOverlay(overlay map[string]string) func(string) string {
	return func(key string) string { return overlay[key] }
}

// leaks reports whether msg carries the forbidden fragment as a whole token or
// an embedded substring.
func leaks(msg, fragment string) bool {
	if fragment == "" {
		return false
	}
	for _, field := range strings.Fields(msg) {
		if strings.Trim(field, "=:") == fragment {
			return true
		}
	}
	return len(fragment) > 2 && strings.Contains(msg, fragment)
}

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name     string
		mutate   func(map[string]string)
		remove   []string
		wantOK   bool
		disabled bool
		wantErr  bool
		leak     string
		wantAddr string
	}{
		{name: "valid enabled local", wantOK: true},
		{name: "enabled key absent is a safe no-op", remove: []string{EnvEnabled}, wantOK: true, disabled: true},
		{name: "enabled explicit false is a safe no-op", mutate: func(m map[string]string) { m[EnvEnabled] = "false" }, wantOK: true, disabled: true},
		{name: "enabled alias 1 rejected", mutate: func(m map[string]string) { m[EnvEnabled] = "1" }, wantErr: true, leak: "IDENTITY_LOCAL_BOOTSTRAP_ENABLED"},
		{name: "enabled alias yes rejected", mutate: func(m map[string]string) { m[EnvEnabled] = "yes" }, wantErr: true},
		{name: "app env production rejected", mutate: func(m map[string]string) { m[EnvAppEnv] = "production" }, wantErr: true, leak: "APP_ENV"},
		{name: "app env test rejected", mutate: func(m map[string]string) { m[EnvAppEnv] = "test" }, wantErr: true},
		{name: "app env absent rejected when enabled", remove: []string{EnvAppEnv}, wantErr: true},
		{name: "addr default applied", remove: []string{EnvAddr}, wantOK: true},
		{name: "addr localhost hostname rejected", mutate: func(m map[string]string) { m[EnvAddr] = "localhost:8081" }, wantErr: true},
		{name: "addr wildcard rejected", mutate: func(m map[string]string) { m[EnvAddr] = "0.0.0.0:8081" }, wantErr: true},
		{name: "addr non loopback rejected", mutate: func(m map[string]string) { m[EnvAddr] = "10.0.0.5:8081" }, wantErr: true},
		{name: "addr port zero rejected", mutate: func(m map[string]string) { m[EnvAddr] = "127.0.0.1:0" }, wantErr: true},
		{name: "addr missing port rejected", mutate: func(m map[string]string) { m[EnvAddr] = "127.0.0.1" }, wantErr: true},
		{name: "addr ipv6 loopback accepted", mutate: func(m map[string]string) { m[EnvAddr] = "[::1]:8081" }, wantOK: true, wantAddr: "[::1]:8081"},
		{name: "key absent rejected", remove: []string{EnvKey}, wantErr: true},
		{name: "key short rejected", mutate: func(m map[string]string) { m[EnvKey] = strings.Repeat("a", MinKeyBytes-1) }, wantErr: true},
		{name: "key whitespace rejected", mutate: func(m map[string]string) { m[EnvKey] = strings.Repeat("a", 31) + " " }, wantErr: true},
		{name: "key control rejected", mutate: func(m map[string]string) { m[EnvKey] = strings.Repeat("a", 31) + "\t" }, wantErr: true},
		{name: "user type candidate rejected", mutate: func(m map[string]string) { m[EnvUserType] = "candidate" }, wantErr: true},
		{name: "user type unknown rejected", mutate: func(m map[string]string) { m[EnvUserType] = "admin" }, wantErr: true},
		{name: "user type recruiter mixed case accepted", mutate: func(m map[string]string) { m[EnvUserType] = "Recruiter" }, wantOK: true},
		{name: "cognito domain http rejected", mutate: func(m map[string]string) { m[EnvCognitoDomain] = "http://example.auth.example" }, wantErr: true},
		{name: "cognito domain path rejected", mutate: func(m map[string]string) { m[EnvCognitoDomain] = testDomain + "/callback" }, wantErr: true},
		{name: "cognito domain trailing slash rejected", mutate: func(m map[string]string) { m[EnvCognitoDomain] = testDomain + "/" }, wantErr: true},
		{name: "cognito domain query rejected", mutate: func(m map[string]string) { m[EnvCognitoDomain] = testDomain + "?x=1" }, wantErr: true},
		{name: "cognito domain fragment rejected", mutate: func(m map[string]string) { m[EnvCognitoDomain] = testDomain + "#frag" }, wantErr: true},
		{name: "cognito domain credentials rejected", mutate: func(m map[string]string) { m[EnvCognitoDomain] = "https://u:p@example.auth.example" }, wantErr: true},
		{name: "cognito domain absent rejected", remove: []string{EnvCognitoDomain}, wantErr: true},
		{name: "jwt mode pem rejected", mutate: func(m map[string]string) { m[EnvJWTMode] = "pem" }, wantErr: true},
		{name: "jwt mode absent rejected", remove: []string{EnvJWTMode}, wantErr: true},
		{name: "jwt client id absent rejected", remove: []string{EnvJWTClientID}, wantErr: true},
		{name: "jwt token use id rejected", mutate: func(m map[string]string) { m[EnvJWTTokenUse] = "id" }, wantErr: true},
		{name: "jwt issuer absent rejected", remove: []string{EnvJWTIssuer}, wantErr: true},
		{name: "database url absent rejected", remove: []string{EnvDatabaseURL}, wantErr: true},
		{name: "database url whitespace rejected", mutate: func(m map[string]string) { m[EnvDatabaseURL] = "   " }, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := validConfigEnv()
			if tt.mutate != nil {
				tt.mutate(env)
			}
			for _, k := range tt.remove {
				delete(env, k)
			}

			cfg, err := LoadConfig(getenvOverlay(env))

			if tt.wantErr {
				if err == nil {
					t.Fatalf("LoadConfig returned nil error, want a safe rejection")
				}
				if leaks(err.Error(), testKey) || leaks(err.Error(), "not-a-real-secret") {
					t.Errorf("error leaks a secret value: %q", err.Error())
				}
				return
			}
			if err != nil {
				t.Fatalf("LoadConfig returned error: %v", err)
			}
			if tt.disabled {
				if cfg.Enabled {
					t.Fatalf("cfg.Enabled = true, want a disabled no-op")
				}
				return
			}
			if !cfg.Enabled {
				t.Fatalf("cfg.Enabled = false, want enabled")
			}
			wantAddr := tt.wantAddr
			if wantAddr == "" {
				wantAddr = DefaultAddr
			}
			if cfg.Addr != wantAddr {
				t.Errorf("cfg.Addr = %q, want %q", cfg.Addr, wantAddr)
			}
			if string(cfg.Key) != testKey {
				t.Errorf("cfg.Key mismatch")
			}
			if cfg.UserType != valueobjects.UserRecruiter {
				t.Errorf("cfg.UserType = %v, want recruiter", cfg.UserType)
			}
			if cfg.UserInfoURL != testDomain+UserInfoPath {
				t.Errorf("cfg.UserInfoURL = %q, want %q", cfg.UserInfoURL, testDomain+UserInfoPath)
			}
			if cfg.Issuer != testIssuer {
				t.Errorf("cfg.Issuer = %q, want the configured issuer", cfg.Issuer)
			}
			if cfg.DatabaseURL != testDSN {
				t.Errorf("cfg.DatabaseURL mismatch")
			}
		})
	}
}
