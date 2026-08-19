// Package auth implements the identity verification seam against RS256 JWTs.
// The Verifier holds the configuration (key, expected issuer, expected
// audience) and exposes the security.Verifier port from the domain.
package auth

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

// RSAVerifier validates bearer tokens signed with a known RS256 key.
// Construction is cheap; the verifier is safe for concurrent use.
type RSAVerifier struct {
	key      jwk.Key
	issuer   string
	audience string
}

// NewRSAVerifier builds a verifier around a public JWK plus the expected
// issuer and audience. The verifier rejects any token whose alg is not
// RS256, which is the mitigation for the HS256-algorithm-confusion attack.
func NewRSAVerifier(publicKey jwk.Key, expectedIssuer, expectedAudience string) (*RSAVerifier, error) {
	if publicKey == nil {
		return nil, errors.New("public key is required")
	}
	if expectedIssuer == "" {
		return nil, errors.New("expected issuer is required")
	}
	if expectedAudience == "" {
		return nil, errors.New("expected audience is required")
	}
	// Pin the algorithm to RS256. Any other alg falls through to Parse
	// which would then succeed for HS256 secret collisions on the public key.
	if err := publicKey.Set(jwk.AlgorithmKey, jwa.RS256); err != nil {
		return nil, fmt.Errorf("pin algorithm: %w", err)
	}
	return &RSAVerifier{
		key:      publicKey,
		issuer:   expectedIssuer,
		audience: expectedAudience,
	}, nil
}

// Verify validates the token and returns the normalized claims. It
// rejects: malformed tokens, wrong alg, tampered signature, expired
// tokens, wrong issuer, wrong audience.
func (v *RSAVerifier) Verify(ctx context.Context, token string) (security.Claims, error) {
	_ = ctx

	// Parse with explicit key + algorithm pinning. This means jwx will
	// refuse to accept anything other than RS256 signed with this key.
	parsed, err := jwt.Parse([]byte(token),
		jwt.WithKey(jwa.RS256, v.key),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithValidate(true),
	)
	if err != nil {
		return security.Claims{}, err
	}

	// cognito:groups may be []string or []any depending on the JSON
	// decoder; normalize into []string.
	rawGroups, _ := parsed.Get("cognito:groups")
	groups := normalizeGroups(rawGroups)

	return security.Claims{
		Subject: parsed.Subject(),
		Groups:  groups,
	}, nil
}

// normalizeGroups returns a string slice for the cognito:groups claim,
// regardless of whether the underlying JSON decoder materialized it as
// a []string or a []any. Returns nil when the claim is absent.
func normalizeGroups(v any) []string {
	switch x := v.(type) {
	case []string:
		return slices.Clone(x)
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

// Compile-time assertion that the verifier implements the domain port.
var _ security.Verifier = (*RSAVerifier)(nil)
