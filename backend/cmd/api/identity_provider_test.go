package main

import (
	"log/slog"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/cognitogetuser"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/userinfo"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
)

// embedded-auth-v1 D8: the configured provider is built once and shared by
// both onboardings (one identityProvider in main.go); none → onboarding 503.
func TestNewIdentityProviderSelection(t *testing.T) {
	if p := newIdentityProvider(runtimeconfig.IdentityConfig{}, slog.Default()); p != nil {
		t.Fatalf("no provider configured, got %T", p)
	}
	if _, ok := newIdentityProvider(runtimeconfig.IdentityConfig{Provider: runtimeconfig.IdentityProviderUserInfo, UserInfoEndpoint: "https://pool.example.com/oauth2/userInfo"}, slog.Default()).(*userinfo.Client); !ok {
		t.Fatal("userinfo provider not built")
	}
	if _, ok := newIdentityProvider(runtimeconfig.IdentityConfig{Provider: runtimeconfig.IdentityProviderCognitoGetUser, CognitoRegion: "us-east-1", CognitoEndpoint: "https://cognito-idp.us-east-1.amazonaws.com/"}, slog.Default()).(*cognitogetuser.Client); !ok {
		t.Fatal("cognito_getuser provider not built")
	}
}

// D8: mixed or partial provider configuration fails startup before any
// infrastructure (DATABASE_URL) is touched, with a static message.
func TestRun_RefusesInvalidIdentityProviderConfig(t *testing.T) {
	for name, extra := range map[string]map[string]string{
		"unknown provider":        {"IDENTITY_PROVIDER": "bogus-provider"},
		"getuser without region":  {"IDENTITY_PROVIDER": "cognito_getuser"},
		"region without provider": {"IDENTITY_COGNITO_REGION": "us-east-1"},
		"getuser with userinfo":   {"IDENTITY_PROVIDER": "cognito_getuser", "IDENTITY_COGNITO_REGION": "us-east-1", "IDENTITY_USERINFO_ENDPOINT": "https://pool.example.com/oauth2/userInfo"},
		"non-loopback override":   {"IDENTITY_PROVIDER": "cognito_getuser", "IDENTITY_COGNITO_REGION": "us-east-1", "IDENTITY_COGNITO_ENDPOINT": "http://cognito.example.com"},
	} {
		t.Run(name, func(t *testing.T) {
			env := map[string]string{
				"APP_ENV": "local", "IDENTITY_JWT_MODE": "pem", "IDENTITY_JWT_PUBLIC_KEY_PEM": mwMainPEM,
				"IDENTITY_JWT_ISSUER": "https://cognito-idp.test.local", "IDENTITY_JWT_AUDIENCE": "test-client-id",
				"IDENTITY_JWT_TOKEN_USE": "", "IDENTITY_JWT_CACHE_TTL": "", "IDENTITY_JWT_FETCH_TIMEOUT": "",
				"IDENTITY_PROVIDER": "", "IDENTITY_USERINFO_ENDPOINT": "", "IDENTITY_COGNITO_REGION": "", "IDENTITY_COGNITO_ENDPOINT": "",
				"DATABASE_URL": "",
			}
			for k, v := range extra {
				env[k] = v
			}
			for k, v := range env {
				t.Setenv(k, v)
			}
			err := run()
			if err == nil || !strings.Contains(err.Error(), "IDENTITY_") || strings.Contains(err.Error(), "DATABASE_URL") {
				t.Fatalf("run() = %v; want an identity configuration error before DATABASE_URL", err)
			}
			for k, v := range extra {
				// Provider names are part of the static vocabulary; the rest are operator values.
				if (k != "IDENTITY_PROVIDER" || v == "bogus-provider") && strings.Contains(err.Error(), v) {
					t.Fatalf("error echoes a value: %v", err)
				}
			}
		})
	}
}
