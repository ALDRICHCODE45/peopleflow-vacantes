// Package http exposes the identity bounded-context HTTP adapters:
// the JWT auth middleware. The middleware is the only public HTTP
// surface of the identity context in this slice — no routes are mounted
// in cmd/api/main.go yet.
package http

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	chimw "github.com/go-chi/chi/v5/middleware"
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
				slog.Debug("auth: token verification failed", boundedUnauthenticatedAttrs(r.Context())...)
				respondUnauthorized(w, "invalid token")
				return
			}

			ctx := security.ContextWithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// boundedUnauthenticatedAttrs builds the bounded auxiliary attributes for
// the RequireAuth verifier-failure branch: the catalog code_class plus
// request_id read ONLY from the existing chi request-ID context and omitted
// when no RequestID middleware set one. No method, path, body, identity, or
// raw error content — the raw verifier error must never be logged at any
// level, and the request middleware owns bounded request correlation.
func boundedUnauthenticatedAttrs(ctx context.Context) []any {
	attrs := []any{"code_class", httpjson.CodeUnauthenticated}
	if reqID := chimw.GetReqID(ctx); reqID != "" {
		attrs = append(attrs, "request_id", reqID)
	}
	return attrs
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
