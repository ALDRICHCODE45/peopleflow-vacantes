// Package middleware holds runtime HTTP middleware for the API server.
package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	rtmetrics "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics"
)

// RequestObservability wraps next with request-correlated structured
// completion logging and HTTP request metrics (design §8.3, Task 6.3 GREEN).
// Each request emits exactly one structured slog completion record with the
// bounded fields request_id/method/path/status/duration/code_class and calls
// HTTPMetrics.ObserveRequest(method, route, status, duration) exactly once
// with the same bounded route/status/duration.
//
// Ordering contract (composition wiring is a later slice): chi's RequestID
// middleware must run BEFORE this middleware — the request ID is read from
// the request context, never a second generated ID — and chi routing must
// have matched the request so the route pattern resolves after dispatch.
func RequestObservability(logger *slog.Logger, httpMetrics rtmetrics.HTTPMetrics) func(http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	if httpMetrics == nil {
		httpMetrics = rtmetrics.Default
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			duration := time.Since(start)

			status := ww.Status()
			if status == 0 {
				// Implicit success: the handler never wrote a header.
				status = http.StatusOK
			}

			// Bounded route: chi's matched pattern (e.g. "/companies/{id}").
			// The raw r.URL.Path is never logged or used as a metric label.
			route := "unmatched"
			if rctx := chi.RouteContext(r.Context()); rctx != nil {
				if p := rctx.RoutePattern(); p != "" {
					route = p
				}
			}

			logger.Info("http request completed",
				"request_id", chimw.GetReqID(r.Context()),
				"method", r.Method,
				"path", route,
				"status", status,
				"duration", duration, // slog renders KindDuration as positive fractional seconds
				"code_class", codeClass(status),
			)
			httpMetrics.ObserveRequest(r.Method, route, status, duration)
		})
	}
}

// codeClass maps a status to the bounded catalog code-class taxonomy
// (2xx / 4xx / 5xx): 5xx+ → "5xx", 4xx → "4xx", every other response
// (implicit/explicit success, including 1xx/3xx) collapses into the success
// class "2xx" so the label set stays closed. Catalog error-code propagation
// beyond the status class belongs to a later unit.
func codeClass(status int) string {
	switch {
	case status >= 500:
		return "5xx"
	case status >= 400:
		return "4xx"
	default:
		return "2xx"
	}
}
