package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

const cognitoClientEnv = "IDENTITY_JWT_CLIENT_ID"

func cognitoAccessEnv() map[string]string {
	env := envDel(baseJWKSEnv(), envAudience)
	env[envTokenUse] = "access"
	env[cognitoClientEnv] = testEnvAud
	return env
}

func TestCognitoAccessConfig(t *testing.T) {
	for _, audience := range []string{"", "https://api.example.test"} {
		env := envSet(cognitoAccessEnv(), envAudience, audience)
		rec := &recordingConstructor{}
		if _, err := NewVerifierConfigFromEnv(envLookup(env), rec.construct); err != nil || !rec.called {
			t.Fatalf("access profile with audience %q: called=%v err=%v", audience, rec.called, err)
		}
		if rec.cfg.Audience != audience || rec.cfg.TokenUse != "access" {
			t.Fatalf("profile changed configured audience or token purpose: %+v", rec.cfg)
		}
	}
}

func TestCognitoAccessConfigRejectsInvalid(t *testing.T) {
	rsaPublic, _, _, _ := pemFixtures(t)
	cases := []struct {
		name string
		env  map[string]string
	}{
		{"missing client and audience", envDel(cognitoAccessEnv(), cognitoClientEnv)},
		{"blank client with legacy audience", envSet(envSet(cognitoAccessEnv(), envAudience, testEnvAud), cognitoClientEnv, "  ")},
		{"ID purpose with client", envSet(envSet(cognitoAccessEnv(), envAudience, testEnvAud), envTokenUse, "id")},
		{"missing purpose", envDel(cognitoAccessEnv(), envTokenUse)},
		{"client in PEM mode", envSet(basePEMEnv(rsaPublic), cognitoClientEnv, testEnvAud)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recordingConstructor{}
			v, err := NewVerifierConfigFromEnv(envLookup(tc.env), rec.construct)
			if err == nil || v != nil || rec.called {
				t.Fatalf("invalid profile must fail before construction: verifier=%T called=%v err=%v", v, rec.called, err)
			}
			if strings.Contains(err.Error(), testEnvAud) {
				t.Fatal("configuration error exposes client identifier")
			}
		})
	}
}

// All credentials and signing material below are test fixtures. No environment
// files, AWS endpoint or real token are used.
func configuredCognitoVerifier(t *testing.T, audience string) (*JWKSVerifier, string) {
	t.Helper()
	body := jwksBytes(t, jwksKey(t, "kid-a", jwa.RS256))
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	env := cognitoAccessEnv()
	env[envIssuer] = srv.URL
	env[envAudience] = audience
	v, err := NewVerifierConfigFromEnv(envLookup(env), func(cfg JWKSVerifierConfig) (security.Verifier, error) {
		v, err := NewJWKSVerifier(cfg)
		if err == nil {
			v.(*JWKSVerifier).client = srv.Client()
		}
		return v, err
	})
	if err != nil {
		t.Fatalf("configure Cognito access verifier: %v", err)
	}
	jv := v.(*JWKSVerifier)
	t.Cleanup(jv.Close)
	return jv, srv.URL
}

func accessTokenClaims(issuer string) map[string]any {
	now := time.Now()
	return map[string]any{
		"iss": issuer, "sub": "fixture-user", "client_id": testEnvAud,
		"token_use": "access", "exp": now.Add(time.Hour), "iat": now,
		"cognito:groups": []string{"recruiters"},
	}
}

func signAccessFixture(t *testing.T, claims map[string]any, key *rsa.PrivateKey, alg jwa.SignatureAlgorithm, kid string) string {
	t.Helper()
	tok := jwt.New()
	for name, value := range claims {
		must(t, tok.Set(name, value), "set fixture claim")
	}
	var signingMaterial any = key
	if alg != jwa.RS256 {
		signingMaterial = []byte("fixture-HMAC-signing-key")
	}
	jkey, err := jwk.FromRaw(signingMaterial)
	must(t, err, "fixture signing key")
	if kid != "" {
		must(t, jkey.Set(jwk.KeyIDKey, kid), "fixture kid")
	}
	encoded, err := jwt.Sign(tok, jwt.WithKey(alg, jkey))
	must(t, err, "sign access fixture")
	return string(encoded)
}

func TestCognitoAccessVerifierAcceptsWithoutAudience(t *testing.T) {
	v, issuer := configuredCognitoVerifier(t, "")
	claims, err := v.Verify(t.Context(), signAccessFixture(t, accessTokenClaims(issuer), testKey, jwa.RS256, "kid-a"))
	if err != nil || claims.Subject != "fixture-user" || len(claims.Groups) != 1 || claims.Groups[0] != "recruiters" {
		t.Fatalf("ordinary access token: claims=%+v err=%v", claims, err)
	}
}

func TestCognitoAccessVerifierRejectsInvalid(t *testing.T) {
	rogue, err := rsa.GenerateKey(rand.Reader, 2048)
	must(t, err, "rogue fixture key")
	cases := []struct {
		name string
		edit func(map[string]any)
		key  *rsa.PrivateKey
		alg  jwa.SignatureAlgorithm
		kid  string
	}{
		{"wrong client", func(c map[string]any) { c["client_id"] = "other-client" }, testKey, jwa.RS256, "kid-a"},
		{"missing client", func(c map[string]any) { delete(c, "client_id") }, testKey, jwa.RS256, "kid-a"},
		{"non-string client", func(c map[string]any) { c["client_id"] = 42 }, testKey, jwa.RS256, "kid-a"},
		{"audience cannot replace client", func(c map[string]any) { delete(c, "client_id"); c["aud"] = []string{testEnvAud} }, testKey, jwa.RS256, "kid-a"},
		{"ID token", func(c map[string]any) { c["token_use"] = "id"; c["aud"] = []string{testEnvAud} }, testKey, jwa.RS256, "kid-a"},
		{"missing purpose", func(c map[string]any) { delete(c, "token_use") }, testKey, jwa.RS256, "kid-a"},
		{"wrong issuer", func(c map[string]any) { c["iss"] = "https://other-pool.example" }, testKey, jwa.RS256, "kid-a"},
		{"expired", func(c map[string]any) { c["exp"] = time.Now().Add(-jwksClockSkew - time.Minute) }, testKey, jwa.RS256, "kid-a"},
		{"missing expiration", func(c map[string]any) { delete(c, "exp") }, testKey, jwa.RS256, "kid-a"},
		{"missing subject", func(c map[string]any) { delete(c, "sub") }, testKey, jwa.RS256, "kid-a"},
		{"rogue signature", func(map[string]any) {}, rogue, jwa.RS256, "kid-a"},
		{"wrong algorithm", func(map[string]any) {}, testKey, jwa.HS256, "kid-a"},
		{"missing kid", func(map[string]any) {}, testKey, jwa.RS256, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v, issuer := configuredCognitoVerifier(t, "")
			fixture := accessTokenClaims(issuer)
			tc.edit(fixture)
			claims, err := v.Verify(t.Context(), signAccessFixture(t, fixture, tc.key, tc.alg, tc.kid))
			if err == nil || claims.Subject != "" || len(claims.Groups) != 0 {
				t.Fatalf("rejected fixture must return no principal: claims=%+v err=%v", claims, err)
			}
		})
	}
}

func TestCognitoAccessVerifierPreservesConfiguredAudience(t *testing.T) {
	const resource = "https://api.example.test"
	for _, aud := range []string{resource, "https://other-api.example.test", ""} {
		t.Run(aud, func(t *testing.T) {
			v, issuer := configuredCognitoVerifier(t, resource)
			fixture := accessTokenClaims(issuer)
			if aud != "" {
				fixture["aud"] = []string{aud}
			}
			claims, err := v.Verify(t.Context(), signAccessFixture(t, fixture, testKey, jwa.RS256, "kid-a"))
			if aud == resource {
				if err != nil || claims.Subject != "fixture-user" {
					t.Fatalf("matching resource and client: claims=%+v err=%v", claims, err)
				}
			} else if err == nil || claims.Subject != "" {
				t.Fatalf("configured audience bypass: claims=%+v err=%v", claims, err)
			}
		})
	}
}

func TestCognitoAccessPreservesLegacyIDProfile(t *testing.T) {
	v := newTestJWKSVerifier(t, kidSetHandler(t, nil, nil))
	v.cfg.TokenUse = "id"
	fixture := accessTokenClaims(testIssuer)
	delete(fixture, "client_id")
	fixture["token_use"] = "id"
	fixture["aud"] = []string{testAud}
	claims, err := v.Verify(t.Context(), signAccessFixture(t, fixture, testKey, jwa.RS256, "kid-a"))
	if err != nil || claims.Subject != "fixture-user" {
		t.Fatalf("legacy ID profile changed: claims=%+v err=%v", claims, err)
	}
}

func TestCognitoAccessConstructorRejectsInvalidProfile(t *testing.T) {
	for _, tc := range []struct{ client, purpose string }{{" ", "access"}, {testEnvAud, "id"}} {
		t.Run(tc.client+"/"+tc.purpose, func(t *testing.T) {
			v, err := NewJWKSVerifier(JWKSVerifierConfig{
				JWKSURL: "https://jwks.example.test", Issuer: testIssuer,
				ClientID: tc.client, TokenUse: tc.purpose,
				CacheTTL: time.Minute, FetchTimeout: time.Second,
			})
			if err == nil || v != nil {
				t.Fatalf("constructor accepted invalid client profile: verifier=%T err=%v", v, err)
			}
		})
	}
}
