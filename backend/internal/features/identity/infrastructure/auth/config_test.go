package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"maps"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
)

const (
	testEnvIssuer  = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool123"
	testEnvAud     = "client-id-98765"
	testEnvUse     = "use-value-42"
	testEnvBadPEM  = "NOT-A-PEM-BLOCK-LEAKNEEDLE"
	testEnvBadMode = "opaque-mode-leakneedle"
	testEnvBadTTL  = "soon-not-a-duration"
	testCtorSecret = "ctor-cause-9f3a1b-leakneedle"
	testIssuerCred = "secret-cred-9b2c-leakneedle"
	testOpaqueIss  = "https:opaque-form-leakneedle"
)

func envLookup(env map[string]string) func(string) string {
	return func(k string) string { return env[k] }
}
func envSet(env map[string]string, key, value string) map[string]string {
	out := maps.Clone(env)
	out[key] = value
	return out
}
func envDel(env map[string]string, key string) map[string]string {
	out := maps.Clone(env)
	delete(out, key)
	return out
}
func baseJWKSEnv() map[string]string {
	return map[string]string{envAppEnv: "production", envMode: ModeJWKS, envIssuer: testEnvIssuer,
		envAudience: testEnvAud, envTokenUse: testEnvUse, envCacheTTL: "10m", envFetchTimeout: "5s"}
}
func basePEMEnv(publicPEM string) map[string]string {
	return map[string]string{envAppEnv: "local", envMode: ModePEM, envIssuer: testIssuer,
		envAudience: testAud, envPublicKeyPEM: publicPEM}
}

type nopVerifier struct{}

func (nopVerifier) Verify(context.Context, string) (security.Claims, error) {
	return security.Claims{}, errors.New("not used")
}

type recordingConstructor struct {
	called bool
	cfg    JWKSVerifierConfig
	err    error
	nilV   bool
}

func (r *recordingConstructor) construct(cfg JWKSVerifierConfig) (security.Verifier, error) {
	r.called, r.cfg = true, cfg
	if r.err != nil || r.nilV {
		return nil, r.err
	}
	return nopVerifier{}, nil
}

func pemFixtures(t *testing.T) (rsaPub, ecPub, privatePKCS1, privatePKCS8 string) {
	t.Helper()
	encodePublic := func(key any) string {
		der, err := x509.MarshalPKIXPublicKey(key)
		if err != nil {
			t.Fatal(err)
		}
		return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	}
	ec, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der8, err := x509.MarshalPKCS8PrivateKey(testKey)
	if err != nil {
		t.Fatal(err)
	}
	return encodePublic(&testKey.PublicKey), encodePublic(&ec.PublicKey),
		string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(testKey)})),
		string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der8}))
}

type invalidCase struct {
	name string
	env  map[string]string
}

func invalidCases(t *testing.T) []invalidCase {
	rsaPub, ecPub, private1, private8 := pemFixtures(t)
	jwks, pemEnv := baseJWKSEnv(), basePEMEnv(rsaPub)
	cases := []invalidCase{
		{"missing mode", envDel(jwks, envMode)}, {"whitespace mode", envSet(jwks, envMode, "   ")},
		{"unknown mode", envSet(jwks, envMode, testEnvBadMode)},
		{"missing APP_ENV", envDel(jwks, envAppEnv)}, {"whitespace APP_ENV", envSet(jwks, envAppEnv, "   ")},
		{"unknown APP_ENV", envSet(jwks, envAppEnv, "staging")},
		{"malformed issuer", envSet(jwks, envIssuer, "not-a-url")},
		{"http issuer", envSet(jwks, envIssuer, "http://cognito-idp.example/pool")},
		{"issuer without host", envSet(jwks, envIssuer, "https:///pool")},
		{"issuer with userinfo", envSet(jwks, envIssuer, "https://user:"+testIssuerCred+"@cognito-idp.example/pool")},
		{"issuer with query", envSet(jwks, envIssuer, testEnvIssuer+"?x=1")},
		{"issuer with fragment", envSet(jwks, envIssuer, testEnvIssuer+"#frag")},
		{"opaque issuer", envSet(jwks, envIssuer, testOpaqueIss)},
	}
	for _, key := range []string{envIssuer, envAudience, envTokenUse, envCacheTTL, envFetchTimeout} {
		cases = append(cases, invalidCase{"jwks missing " + key, envDel(jwks, key)},
			invalidCase{"jwks whitespace " + key, envSet(jwks, key, "   ")})
	}
	for _, tc := range [][2]string{
		{envCacheTTL, testEnvBadTTL}, {envCacheTTL, "0s"}, {envCacheTTL, "-5m"}, {envCacheTTL, "30s"}, {envCacheTTL, "25h"},
		{envFetchTimeout, testEnvBadTTL}, {envFetchTimeout, "-5s"}, {envFetchTimeout, "500ms"}, {envFetchTimeout, "0s"}, {envFetchTimeout, "2m"},
	} {
		cases = append(cases, invalidCase{"jwks duration " + tc[0] + "=" + tc[1], envSet(jwks, tc[0], tc[1])})
	}
	cases = append(cases,
		invalidCase{"pem in production", envSet(pemEnv, envAppEnv, "production")},
		invalidCase{"pem malformed issuer", envSet(pemEnv, envIssuer, "not-a-url")},
		invalidCase{"invalid pem", envSet(pemEnv, envPublicKeyPEM, testEnvBadPEM)},
		invalidCase{"ec public pem", envSet(pemEnv, envPublicKeyPEM, ecPub)},
		invalidCase{"rsa private PKCS1", envSet(pemEnv, envPublicKeyPEM, private1)},
		invalidCase{"rsa private PKCS8", envSet(pemEnv, envPublicKeyPEM, private8)})
	for _, key := range []string{envPublicKeyPEM, envIssuer, envAudience} {
		cases = append(cases, invalidCase{"pem missing " + key, envDel(pemEnv, key)},
			invalidCase{"pem whitespace " + key, envSet(pemEnv, key, "  ")})
	}
	return cases
}

func TestNewVerifierConfigFromEnv_RejectsInvalid(t *testing.T) {
	for _, tt := range invalidCases(t) {
		t.Run(tt.name, func(t *testing.T) {
			rec := &recordingConstructor{}
			v, err := NewVerifierConfigFromEnv(envLookup(tt.env), rec.construct)
			if err == nil || v != nil {
				t.Fatalf("must fail closed, got verifier=%#v error=%v", v, err)
			}
			values := []string{testCtorSecret, testIssuerCred, testEnvIssuer, testEnvAud,
				testEnvUse, testEnvBadPEM, testEnvBadMode, testEnvBadTTL, testOpaqueIss, "staging", "not-a-url"}
			for _, value := range values {
				if strings.Contains(err.Error(), value) {
					t.Errorf("error leaks environment value or key material %q: %q", value, err)
				}
			}
			if rec.called {
				t.Error("invalid configuration invoked JWKS constructor")
			}
		})
	}
	if _, err := NewVerifierConfigFromEnv(nil, nil); err == nil {
		t.Fatal("nil environment lookup must fail")
	}
}

func TestNewVerifierConfigFromEnv_JWKSMode(t *testing.T) {
	env := envSet(baseJWKSEnv(), envIssuer, testEnvIssuer+"/")
	rec := &recordingConstructor{}
	v, err := NewVerifierConfigFromEnv(envLookup(env), rec.construct)
	if err != nil || !rec.called {
		t.Fatalf("valid JWKS construction failed: called=%v err=%v", rec.called, err)
	}
	if _, ok := v.(nopVerifier); !ok {
		t.Fatalf("returned verifier type = %T, want nopVerifier", v)
	}
	want := JWKSVerifierConfig{Issuer: testEnvIssuer + "/", JWKSURL: testEnvIssuer + jwksDiscoveryPath,
		Audience: testEnvAud, TokenUse: testEnvUse, CacheTTL: 10 * time.Minute, FetchTimeout: 5 * time.Second}
	if rec.cfg != want {
		t.Fatalf("constructor config mismatch:\n got %#v\nwant %#v", rec.cfg, want)
	}

	for _, tc := range []recordingConstructor{{err: errors.New(testCtorSecret)}, {nilV: true}} {
		rec := tc
		_, err := NewVerifierConfigFromEnv(envLookup(baseJWKSEnv()), rec.construct)
		if err == nil || err.Error() != "jwks verifier construction failed" || strings.Contains(err.Error(), testCtorSecret) {
			t.Fatalf("constructor failure was not static: %q", err)
		}
	}

	for _, bounds := range [][2]string{{"1m", "5s"}, {"24h", "5s"}, {"10m", "1s"}, {"10m", "1m"}} {
		rec := &recordingConstructor{}
		env := envSet(envSet(baseJWKSEnv(), envCacheTTL, bounds[0]), envFetchTimeout, bounds[1])
		if _, err := NewVerifierConfigFromEnv(envLookup(env), rec.construct); err != nil || !rec.called {
			t.Fatalf("inclusive boundary ttl=%s timeout=%s failed: called=%v err=%v", bounds[0], bounds[1], rec.called, err)
		}
	}
}

func TestNewVerifierConfigFromEnv_PEMMode(t *testing.T) {
	rsaPublic, _, _, _ := pemFixtures(t)
	v, err := NewVerifierConfigFromEnv(envLookup(basePEMEnv(rsaPublic)), nil)
	if err != nil {
		t.Fatalf("valid PEM with nil unselected JWKS constructor failed: %v", err)
	}
	verifier, ok := v.(*RSAVerifier)
	if !ok {
		t.Fatalf("PEM verifier type = %T, want *RSAVerifier", v)
	}
	claims, err := verifier.Verify(context.Background(), signToken(t, map[string]any{"sub": "user-1"}))
	if err != nil || claims.Subject != "user-1" {
		t.Fatalf("PEM verifier result: subject=%q err=%v", claims.Subject, err)
	}
}
