// Package health provides the liveness and readiness HTTP handlers.
package health

import (
	"context"
	"net/http"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// Pinger is the consumer-owned readiness port.
type Pinger interface{ Ping(context.Context) error }

func ok(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok")) // static 2-byte body; nothing actionable on write error
}

// Healthz returns the process-liveness handler; it never consults the port.
func Healthz(Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) { ok(w) }
}

// Readyz pings once under its own shorter timeout; failure/deadline writes the
// shared catalog service_unavailable 503 envelope without leaking driver or
// error details.
func Readyz(p Pinger, timeout time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		if p.Ping(ctx) != nil {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeServiceUnavailable))
			return
		}
		ok(w)
	}
}
