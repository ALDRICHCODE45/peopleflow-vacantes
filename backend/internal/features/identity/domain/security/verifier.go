// Package security defines the auth verification seam for the identity
// bounded context. The port is the only thing the middleware and downstream
// HTTP adapters depend on; the actual verifier (RSA, JWKS, etc.) lives in
// the infrastructure layer.
package security

import "context"

// Claims is the normalized set of fields the middleware places into the
// request context. Keeping the surface small (Subject + Groups) lets the
// middleware swap verifier implementations (dev RSA, prod Cognito JWKS)
// without touching consumers.
type Claims struct {
	// Subject is the JWT `sub` claim — the user identifier (Cognito sub).
	Subject string
	// Groups is the normalized list of `cognito:groups` values.
	Groups []string
}

// Verifier validates a bearer token and returns normalized claims. Dev uses
// a static local RSA public key; prod uses the Cognito JWKS endpoint with
// kid + cache + rotation. The middleware depends only on this interface.
type Verifier interface {
	Verify(ctx context.Context, token string) (Claims, error)
}

// claimsContextKey is the unexported type used as the context key for
// storing claims so middleware and downstream handlers can retrieve them
// without colliding with other packages' keys.
type claimsContextKey struct{}

// ContextWithClaims returns a new context carrying the supplied claims.
func ContextWithClaims(ctx context.Context, claims Claims) context.Context {
	return context.WithValue(ctx, claimsContextKey{}, claims)
}

// ClaimsFromContext returns the claims previously stored in ctx, or the
// zero-value Claims if no claims were stored.
func ClaimsFromContext(ctx context.Context) Claims {
	claims, _ := ctx.Value(claimsContextKey{}).(Claims)
	return claims
}
