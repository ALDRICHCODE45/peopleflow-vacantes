// Package security defines the auth verification seam for the identity
// bounded context. The port is the only thing the middleware and downstream
// HTTP adapters depend on; the actual verifier (RSA, JWKS, etc.) lives in
// the infrastructure layer.
package security

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// CompanyContext is the per-request authorization context injected by
// RequireCompanyRole (identity/infrastructure/http). It carries the
// resolved (company_id, role) pair so the gated handler can read the
// caller's company without re-querying the membership table.
//
// The struct lives in the identity security package (not the companies
// slice) because it is the authz boundary — the middleware is the only
// legitimate producer, and the consumers (the companies HTTP handlers)
// treat it as an opaque, port-only contract. Pushing this type into the
// companies domain would invert the dependency: handlers would depend on
// a companies-domain type that already encodes how the middleware maps
// errors to HTTP, which is the wrong direction.
type CompanyContext struct {
	// CompanyID is the membership.company_id of the caller — the same
	// value the resolver chain (`sub → users.id → company_members`)
	// produced. Handlers MUST use this for all mutating queries; the
	// path or body company_id is ignored (spec scenario "body company_id
	// is ignored").
	CompanyID uuid.UUID
	// Role is the caller's role on CompanyID. The middleware already
	// verified `role >= minRole` before injecting, so the handler can
	// trust whatever Role it reads back.
	Role valueobjects.MemberRole
}

// companyContextKey is the unexported type used as the context key for
// storing CompanyContext. The untyped-key pattern (Go idiom: never use
// strings or ints as context keys) prevents accidental collisions with
// other packages' keys and removes the smuggling vector the test
// "UnrelatedKeyDoesNotLeak" guards against.
type companyContextKey struct{}

// ContextWithCompanyContext returns a new context carrying the supplied
// CompanyContext. Production code path: the RequireCompanyRole middleware
// calls this after the resolver chain succeeds.
func ContextWithCompanyContext(ctx context.Context, cc CompanyContext) context.Context {
	return context.WithValue(ctx, companyContextKey{}, cc)
}

// CompanyContextFromContext returns the CompanyContext previously stored
// in ctx, and ok=true when one was stored. ok=false means the request
// reached the handler without passing through RequireCompanyRole (or
// through a misconfigured middleware). Handlers MUST short-circuit on
// ok=false rather than read a zero-value CompanyContext — otherwise a
// missing gate would silently authorize the request.
//
// The shape `(value, ok)` is deliberately distinct from the verifier's
// Claims (which returns a single value). The difference is intentional:
// Claims is always present after RequireAuth (never ok=false), so a
// single-value read is sufficient. CompanyContext is conditional — the
// /me/company handler is ungated, so the "missing" branch is reachable
// and must be explicitly handled.
func CompanyContextFromContext(ctx context.Context) (CompanyContext, bool) {
	cc, ok := ctx.Value(companyContextKey{}).(CompanyContext)
	if !ok {
		return CompanyContext{}, false
	}
	return cc, true
}
