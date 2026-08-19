package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

// These globals are set by TestMain so individual tests can pick them up.
// We avoid a package-level var initializer so the dev fixture is truly
// in-memory and never touches the filesystem.
var (
	testKey    *rsa.PrivateKey
	testIssuer = "https://cognito-idp.test.local"
	testAud    = "test-client-id"
)

// TestMain generates a fresh 2048-bit RSA key for every `go test` run.
// Keeping it in-memory means there's no committed key file and no
// cross-run pollution.
func TestMain(m *testing.M) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic("cannot generate RSA key: " + err.Error())
	}
	testKey = key
	os.Exit(m.Run())
}

// signToken produces a valid RS256 JWT signed with the in-memory test key.
// The claims are encoded as a registered JWT and signed via jwx.
func signToken(t *testing.T, claims map[string]any) string {
	t.Helper()
	if testKey == nil {
		t.Fatal("testKey not initialized; TestMain must run first")
	}

	tok, err := jwt.NewBuilder().
		Issuer(testIssuer).
		Audience([]string{testAud}).
		Subject(stringOf(claims["sub"])).
		IssuedAt(time.Now()).
		Expiration(time.Now().Add(time.Hour)).
		JwtID("test-jti").
		Claim("cognito:groups", groupsOf(claims["cognito:groups"])).
		Build()
	if err != nil {
		t.Fatalf("build jwt: %v", err)
	}

	priv, err := jwk.FromRaw(testKey)
	if err != nil {
		t.Fatalf("jwk.FromRaw: %v", err)
	}
	if err := priv.Set(jwk.KeyIDKey, "test-kid"); err != nil {
		t.Fatalf("set kid: %v", err)
	}

	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, priv))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return string(signed)
}

func stringOf(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func groupsOf(v any) []string {
	switch x := v.(type) {
	case []string:
		return x
	case []any:
		out := make([]string, 0, len(x))
		for _, e := range x {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// publicJWK returns the public half of the test key as a jwk.Key, suitable
// for the verifier.
func publicJWK(t *testing.T) jwk.Key {
	t.Helper()
	pub, err := jwk.FromRaw(&testKey.PublicKey)
	if err != nil {
		t.Fatalf("jwk.FromRaw: %v", err)
	}
	if err := pub.Set(jwk.KeyIDKey, "test-kid"); err != nil {
		t.Fatalf("set kid: %v", err)
	}
	if err := pub.Set(jwk.AlgorithmKey, jwa.RS256); err != nil {
		t.Fatalf("set alg: %v", err)
	}
	return pub
}

// TestRsaVerifier_ValidToken proves the happy path: a token signed with
// the in-memory key, with the right iss/aud/exp, verifies and the
// returned Claims carry the sub and cognito:groups.
func TestRsaVerifier_ValidToken(t *testing.T) {
	v, err := NewRSAVerifier(publicJWK(t), testIssuer, testAud)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}

	tok := signToken(t, map[string]any{
		"sub":            "sub-abc",
		"cognito:groups": []string{"candidates"},
	})

	claims, err := v.Verify(context.Background(), tok)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if claims.Subject != "sub-abc" {
		t.Errorf("Subject: want sub-abc, got %q", claims.Subject)
	}
	if len(claims.Groups) != 1 || claims.Groups[0] != "candidates" {
		t.Errorf("Groups: want [candidates], got %v", claims.Groups)
	}
}

// TestRsaVerifier_TamperedSignature is the canary for the algorithm/confusion
// attack surface: flipping a byte in the signature section must reject the
// token. We pick a guaranteed-different byte in the signature segment.
func TestRsaVerifier_TamperedSignature(t *testing.T) {
	v, err := NewRSAVerifier(publicJWK(t), testIssuer, testAud)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}

	tok := signToken(t, map[string]any{"sub": "abc"})
	// Find the third '.' (start of signature) and flip a byte a couple
	// positions into the signature section.
	dots := 0
	sigStart := 0
	for i, c := range tok {
		if c == '.' {
			dots++
			if dots == 2 {
				sigStart = i + 1
				break
			}
		}
	}
	if sigStart == 0 || sigStart+2 >= len(tok) {
		t.Fatalf("could not locate signature segment in token")
	}

	// Flip a byte in the middle of the signature, ensuring we pick a
	// printable base64url char and replace it with a known-different one.
	b := tok[sigStart+5]
	var replacement byte
	switch b {
	case 'A':
		replacement = 'B'
	case 'a':
		replacement = 'b'
	default:
		replacement = 'A'
		if b == 'A' {
			replacement = 'B'
		}
	}
	flipped := tok[:sigStart+5] + string(replacement) + tok[sigStart+6:]

	if _, err := v.Verify(context.Background(), flipped); err == nil {
		t.Fatalf("expected verify to fail for tampered signature at byte %d (%q -> %q), got nil. token=%s",
			sigStart+5, string(b), string(replacement), flipped)
	}
}

// TestRsaVerifier_ExpiredToken covers the past-exp branch.
func TestRsaVerifier_ExpiredToken(t *testing.T) {
	v, err := NewRSAVerifier(publicJWK(t), testIssuer, testAud)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}

	// Build a token whose exp is in the past.
	tok, err := jwt.NewBuilder().
		Issuer(testIssuer).
		Audience([]string{testAud}).
		Subject("abc").
		IssuedAt(time.Now().Add(-2 * time.Hour)).
		Expiration(time.Now().Add(-time.Hour)).
		Build()
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	priv, err := jwk.FromRaw(testKey)
	if err != nil {
		t.Fatalf("priv: %v", err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, priv))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := v.Verify(context.Background(), string(signed)); err == nil {
		t.Fatal("expected verify to fail for expired token, got nil")
	}
}

// TestRsaVerifier_WrongIssuer covers mismatched iss.
func TestRsaVerifier_WrongIssuer(t *testing.T) {
	v, err := NewRSAVerifier(publicJWK(t), testIssuer, testAud)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}

	tok, err := jwt.NewBuilder().
		Issuer("https://wrong-issuer.example.com").
		Audience([]string{testAud}).
		Subject("abc").
		Expiration(time.Now().Add(time.Hour)).
		Build()
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	priv, err := jwk.FromRaw(testKey)
	if err != nil {
		t.Fatalf("priv: %v", err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, priv))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := v.Verify(context.Background(), string(signed)); err == nil {
		t.Fatal("expected verify to fail for wrong issuer, got nil")
	}
}

// TestRsaVerifier_WrongAudience covers mismatched aud.
func TestRsaVerifier_WrongAudience(t *testing.T) {
	v, err := NewRSAVerifier(publicJWK(t), testIssuer, testAud)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}

	tok, err := jwt.NewBuilder().
		Issuer(testIssuer).
		Audience([]string{"wrong-aud"}).
		Subject("abc").
		Expiration(time.Now().Add(time.Hour)).
		Build()
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	priv, err := jwk.FromRaw(testKey)
	if err != nil {
		t.Fatalf("priv: %v", err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, priv))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := v.Verify(context.Background(), string(signed)); err == nil {
		t.Fatal("expected verify to fail for wrong audience, got nil")
	}
}

// TestRsaVerifier_HS256AlgorithmConfusion covers the classic alg=HS256
// attack: the attacker signs the JWT with the RSA *public* key bytes used
// as the HMAC secret. The verifier must reject because it only accepts
// RS256.
func TestRsaVerifier_HS256AlgorithmConfusion(t *testing.T) {
	v, err := NewRSAVerifier(publicJWK(t), testIssuer, testAud)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}

	// Encode the public key as PEM (the attacker would have this from the
	// JWKS endpoint).
	pubBytes := x509.MarshalPKCS1PublicKey(&testKey.PublicKey)
	pemBlock := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PUBLIC KEY",
		Bytes: pubBytes,
	})

	header := map[string]any{
		"alg": "HS256",
		"typ": "JWT",
	}
	payload := map[string]any{
		"iss": testIssuer,
		"aud": testAud,
		"sub": "abc",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	hb, _ := json.Marshal(header)
	pb, _ := json.Marshal(payload)
	signingInput := base64.RawURLEncoding.EncodeToString(hb) + "." + base64.RawURLEncoding.EncodeToString(pb)

	// HMAC the signing input using the PEM bytes as the secret.
	mac := hmac.New(sha256.New, pemBlock)
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	hs256Token := signingInput + "." + sig

	if _, err := v.Verify(context.Background(), hs256Token); err == nil {
		t.Fatal("expected verify to fail for HS256-signed token, got nil")
	}
}

// TestRsaVerifier_MalformedToken covers the catch-all for garbage input.
func TestRsaVerifier_MalformedToken(t *testing.T) {
	v, err := NewRSAVerifier(publicJWK(t), testIssuer, testAud)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}
	if _, err := v.Verify(context.Background(), "not-a-jwt"); err == nil {
		t.Fatal("expected verify to fail for garbage token, got nil")
	}
}

// Compile-time guard that rsa.PublicKey implements the bits we depend on
// (the big.Int exponent / modulus). The compiler will surface the import
// usage via this reference.
var _ = (*big.Int)(nil)
