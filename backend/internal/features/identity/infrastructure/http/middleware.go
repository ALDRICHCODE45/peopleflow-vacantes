// Package http exposes the identity bounded-context HTTP adapters:
// the JWT auth middleware. The middleware is the only public HTTP
// surface of the identity context in this slice — no routes are mounted
// in cmd/api/main.go yet.
package http

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// RequireAuth returns a middleware that verifies a Bearer token via the
// supplied Verifier and places the resulting claims into the request
// context. On any failure (missing header, wrong scheme, invalid token,
// expired, wrong iss/aud, wrong alg) the middleware writes 401 and
// short-circuits without invoking the downstream handler.
func RequireAuth(verifier security.Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				respondUnauthorized(w, "missing Authorization header")
				return
			}

			const prefix = "Bearer "
			if !strings.HasPrefix(header, prefix) {
				respondUnauthorized(w, "unsupported Authorization scheme")
				return
			}
			token := strings.TrimSpace(header[len(prefix):])
			if token == "" {
				respondUnauthorized(w, "empty bearer token")
				return
			}

			claims, err := verifier.Verify(r.Context(), token)
			if err != nil {
				slog.Debug("auth: token verification failed", "error", err)
				respondUnauthorized(w, "invalid token")
				return
			}

			ctx := security.ContextWithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// respondUnauthorized writes a 401 catalog envelope. The body uses the
// canonical catalog error field with a safe human-readable message derived
// from the reason, while the code is always "unauthenticated" and no
// internal verifier detail leaks to the client. The WWW-Authenticate header
// is retained per HTTP semantics.
func respondUnauthorized(w http.ResponseWriter, reason string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
	def := httpjson.SafeMessage(
		httpjson.Resolve(httpjson.CodeUnauthenticated),
		"unauthorized",
	)
	httpjson.WriteCatalogError(w, def)
}
