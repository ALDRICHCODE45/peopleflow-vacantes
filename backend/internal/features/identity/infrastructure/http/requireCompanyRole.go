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
//   - On success, CompanyContext{company_id, role} is injected and the
//     downstream handler runs.
//
// Port-only imports (design D5): this package imports the companies
// domain port + entities + valueobjects, NEVER the postgres adapter.
// The import direction stays `identity → companies/domain`, with the
// adapter remaining inside `companies`.
func RequireCompanyRole(
	users identityrepositories.UserRepository,
	members companiesrepositories.CompanyMemberRepository,
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
				slog.Error("company role middleware: user lookup failed", "error", err)
				respondServerError(w)
				return
			}

			member, err := members.GetMembershipByUserID(r.Context(), user.ID)
			if err != nil {
				if errors.Is(err, entities.ErrNotAMember) {
					respondForbidden(w, "not a member of any company")
					return
				}
				slog.Error("company role middleware: membership lookup failed", "error", err)
				respondServerError(w)
				return
			}

			if member.Role < minRole {
				respondForbidden(w, "insufficient role")
				return
			}

			ctx := security.ContextWithCompanyContext(r.Context(), security.CompanyContext{
				CompanyID: member.CompanyID,
				Role:      member.Role,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// respondForbidden writes a 403 JSON error body. Centralized so the
// middleware response shape mirrors respondUnauthorized.
func respondForbidden(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte(`{"error":"forbidden","reason":"` + reason + `"}`))
}

// respondServerError writes a 500 JSON error body. The real error is
// logged by the caller; the wire response is intentionally generic so
// internal failures don't leak to the client.
func respondServerError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	_, _ = w.Write([]byte(`{"error":"internal server error"}`))
}
