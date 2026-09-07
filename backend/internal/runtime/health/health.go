// Package health provides the liveness and readiness HTTP handlers.
package health

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"

	rtmetrics "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics"
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
//
// Readiness observability (Task 6.3, ws6c-4a): every outcome calls
// ReadinessMetrics.SetReady exactly once (true on success, false on ordinary
// failure or readiness deadline), and failure only emits exactly one
// structured record carrying the chi request ID already present in the
// request context plus closed, bounded event/classification fields. The ping
// error itself is never attached or stringified — the classification is the
// closed set {"ping_failed", "deadline"}. Safe nil defaults: a nil logger
// resolves to slog.Default() and a nil gauge to the shared no-op default.
func Readyz(p Pinger, timeout time.Duration, logger *slog.Logger, ready rtmetrics.ReadinessMetrics) http.HandlerFunc {
	if logger == nil {
		logger = slog.Default()
	}
	if ready == nil {
		ready = rtmetrics.Default
	}
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		err := p.Ping(ctx)
		if err == nil {
			ready.SetReady(true)
			ok(w)
			return
		}
		ready.SetReady(false)
		// Safe classification: the deadline boundary (not the error value)
		// decides; the ping error is never attached or stringified.
		class := "ping_failed"
		if ctx.Err() != nil {
			class = "deadline"
		}
		logger.ErrorContext(ctx, "readiness check failed",
			"request_id", chimw.GetReqID(r.Context()),
			"event", "readiness",
			"classification", class,
		)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeServiceUnavailable))
	}
}
