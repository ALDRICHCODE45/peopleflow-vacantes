// Package http exposes the identity bounded-context HTTP adapters:
// the JWT auth middleware (RequireAuth) and the per-route role gate
// (RequireCompanyRole). The authz middleware is the only public HTTP
// surface of the identity context in this slice — no routes are
// mounted in cmd/api/main.go here (those belong to the bounded
// contexts that own the resources).
package http

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	companiesrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// RequireCompanyRole returns a middleware that resolves the
// authenticated subject's (company_id, role) pair per request and
// gates the downstream handler on the resolved role being at least
// minRole. The resolved CompanyContext is injected into the request
// context so the gated handler can read the caller's company without
// re-querying the membership table.
//
// Contract (per design Interfaces + error table):
//
//   - The JWT subject (`sub`) is read from the Claims that RequireAuth
//     places into the request context. If no Claims are present (the
//     auth middleware was skipped or mis-wired), the middleware
//     rejects with 401 — it NEVER trusts an empty `sub`.
//   - sub → users.GetByCognitoSub → users.id. Unknown sub maps to 401
//     and short-circuits BEFORE the membership table is touched (no
//     IDOR leak from probing membership rows with a bogus sub).
//   - users.id → members.GetMembershipByUserID. Missing row maps to
//     403; role < minRole maps to 403 (per design D4 / spec scenarios).
//   - After membership resolution, the middleware probes the company's
//     liveness via the narrow CompanyLivenessRepository. A tombstoned
//     company (`deleted_at IS NOT NULL`) and a missing company (no
//     such row, ErrCompanyNotFound) collapse to the SAME 403 with
//     code `company_inactive` — the gate MUST NOT reveal which one it
//     saw, because that would leak the existence of soft-deleted
//     companies to a probing caller (R7 invariant extension: a
//     soft-deleted company is invisible on every role-gated route,
//     not just the membership read). An unexpected liveness lookup
//     error maps to 500 (the existing generic internal-error response).
//     Liveness runs AFTER membership resolution (so a stranger
//     doesn't probe company existence via the gate) and BEFORE role
//     comparison (so the handler never receives a CompanyContext for
//     a tombstoned company).
//   - On success, CompanyContext{company_id, user_id, role} is injected and
//     the downstream handler runs.
//
// Port-only imports (design D5): this package imports the companies
// domain port + entities + valueobjects, NEVER the postgres adapter.
// The import direction stays `identity → companies/domain`, with the
// adapter remaining inside `companies`.
func RequireCompanyRole(
	users identityrepositories.UserRepository,
	members companiesrepositories.CompanyMemberRepository,
	liveness companiesrepositories.CompanyLivenessRepository,
	minRole valueobjects.MemberRole,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Defense in depth: refuse to run with no Claims in the
			// context. In production, RequireAuth runs first and
			// injects Claims; if a route is mis-wired (e.g. mounted
			// outside the /me subtree), we never silently admit a
			// request with an empty subject.
			claims := security.ClaimsFromContext(r.Context())
			if claims.Subject == "" {
				respondUnauthorized(w, "missing authenticated subject")
				return
			}

			user, err := users.GetByCognitoSub(r.Context(), claims.Subject)
			if err != nil {
				if errors.Is(err, identityentities.ErrUserNotFound) {
					respondUnauthorized(w, "unknown subject")
					return
				}
				// Unexpected error: log and return generic 500.
				slog.Error("company role middleware: user lookup failed", "error", err)
				respondServerError(w)
				return
			}

			member, err := members.GetMembershipByUserID(r.Context(), user.ID)
			if err != nil {
				if errors.Is(err, entities.ErrNotAMember) {
					respondForbiddenSafe(w, "not a member of any company")
					return
				}
				slog.Error("company role middleware: membership lookup failed", "error", err)
				respondServerError(w)
				return
			}

			// Liveness gate (require-company-role-tombstone-gate slice).
			// Runs AFTER membership resolution (so a stranger cannot
			// probe company existence via this gate) and BEFORE role
			// comparison (so the handler never sees a CompanyContext
			// for a tombstoned company).
			//
			// A tombstoned company (`deleted_at IS NOT NULL`) AND a
			// missing company (pgx.ErrNoRows →
			// entities.ErrCompanyNotFound) collapse to the SAME 403
			// with code `company_inactive` — the gate MUST NOT reveal
			// which one it saw, because that would leak the
			// existence of soft-deleted companies to a probing caller.
			// Any other liveness error is treated as 500 (the error is
			// logged via slog; the wire body is the generic
			// internal-error response).
			live, err := liveness.IsCompanyLive(r.Context(), member.CompanyID)
			if err != nil {
				if errors.Is(err, entities.ErrCompanyNotFound) {
					respondCompanyInactive(w)
					return
				}
				slog.Error("company role middleware: liveness lookup failed", "error", err)
				respondServerError(w)
				return
			}
			if !live {
				respondCompanyInactive(w)
				return
			}

			if member.Role < minRole {
				respondForbiddenSafe(w, "insufficient role")
				return
			}

			ctx := security.ContextWithCompanyContext(r.Context(), security.CompanyContext{
				CompanyID: member.CompanyID,
				UserID:    user.ID,
				Role:      member.Role,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}



// respondForbiddenSafe writes a 403 catalog envelope with code "forbidden".
// The safe message is the domain-specific reason, not the canonical
// generic message.
func respondForbiddenSafe(w http.ResponseWriter, safeMsg string) {
	def := httpjson.SafeMessage(
		httpjson.Resolve(httpjson.CodeForbidden),
		safeMsg,
	)
	httpjson.WriteCatalogError(w, def)
}

// respondCompanyInactive writes a 403 catalog envelope with code "company_inactive".
// Used for both tombstoned and missing companies — the code is identical so
// the gate does not leak which condition it saw.
func respondCompanyInactive(w http.ResponseWriter) {
	httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeCompanyInactive))
}

// respondServerError writes a 500 catalog envelope with code "internal_error".
// The real error is logged by the caller; the wire response is intentionally
// generic so internal failures don't leak to the client.
func respondServerError(w http.ResponseWriter) {
	httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
}
