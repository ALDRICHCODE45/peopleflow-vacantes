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

// respondUnauthorized writes a 401 response with a small JSON body. The
// body is intentionally generic so internal validation details (e.g.
// "token expired" vs "wrong audience") don't leak to the client.
func respondUnauthorized(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"unauthorized","reason":"` + reason + `"}`))
}
