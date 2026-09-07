// Package middleware holds runtime HTTP middleware for the API server.
package middleware

import (
	"bufio"
	"io"
	"log/slog"
	"net"
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
			core := &observabilityResponseWriter{WrapResponseWriter: ww}
			next.ServeHTTP(newObservabilityResponseWriter(core), r)
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

			// Catalog-code propagation (Task 6.3 GREEN, bounded slice): a
			// handler that answered through httpjson.WriteCatalogError{,Data}
			// left the already-normalized canonical code on the writer; it
			// replaces the bare status bucket. Non-catalog responses keep the
			// status-bucket classification unchanged.
			class := core.catalogCode
			if class == "" {
				class = codeClass(status)
			}

			logger.Info("http request completed",
				"request_id", chimw.GetReqID(r.Context()),
				"method", r.Method,
				"path", route,
				"status", status,
				"duration", duration, // slog renders KindDuration as positive fractional seconds
				"code_class", class,
			)
			httpMetrics.ObserveRequest(r.Method, route, status, duration)
		})
	}
}

// observabilityResponseWriter adds the optional catalog-code capability on
// top of chi's wrapped response writer so httpjson.WriteCatalogError and
// WriteCatalogErrorData can propagate only the canonical catalog code to the
// completion record. The captured value is from the closed V1 code set —
// never a definition, message, data payload, raw path, or unbounded value.
type observabilityResponseWriter struct {
	chimw.WrapResponseWriter
	catalogCode string
}

// RecordCatalogCode implements the httpjson.CatalogCodeRecorder capability.
func (o *observabilityResponseWriter) RecordCatalogCode(code string) {
	o.catalogCode = code
}

// Optional-capability variants over the core, each embedding the concrete smaller variant
// so the composed method set adds exactly one optional method (gated by chi's own matrix).
type obsFlush struct{ *observabilityResponseWriter }

func (o obsFlush) Flush() { o.WrapResponseWriter.(http.Flusher).Flush() }

type obsFlushPush struct{ obsFlush }

func (o obsFlushPush) Push(target string, opts *http.PushOptions) error {
	return o.WrapResponseWriter.(http.Pusher).Push(target, opts)
}

type obsFlushHijack struct{ obsFlush }

func (o obsFlushHijack) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return o.WrapResponseWriter.(http.Hijacker).Hijack()
}

type obsFlushHijackReadFrom struct{ obsFlushHijack }

func (o obsFlushHijackReadFrom) ReadFrom(r io.Reader) (int64, error) {
	return o.WrapResponseWriter.(io.ReaderFrom).ReadFrom(r)
}

type obsHijack struct{ *observabilityResponseWriter }

func (o obsHijack) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return o.WrapResponseWriter.(http.Hijacker).Hijack()
}

// newObservabilityResponseWriter mirrors chi's NewWrapResponseWriter gating
// so the handler-facing writer matches chi's capability matrix exactly.
func newObservabilityResponseWriter(core *observabilityResponseWriter) http.ResponseWriter {
	ww := core.WrapResponseWriter
	_, fl := ww.(http.Flusher)
	_, hj := ww.(http.Hijacker)
	_, rf := ww.(io.ReaderFrom)
	_, ps := ww.(http.Pusher)
	switch {
	case fl && hj && rf:
		return obsFlushHijackReadFrom{obsFlushHijack{obsFlush{core}}}
	case fl && hj:
		return obsFlushHijack{obsFlush{core}}
	case fl && ps:
		return obsFlushPush{obsFlush{core}}
	case fl:
		return obsFlush{core}
	case hj:
		return obsHijack{core}
	default:
		return core
	}
}

// codeClass maps a status to the bounded catalog code-class taxonomy
// (2xx / 4xx / 5xx): 5xx+ → "5xx", 4xx → "4xx", every other response
// (implicit/explicit success, including 1xx/3xx) collapses into the success
// class "2xx" so the label set stays closed. It is the fallback for responses
// written outside the catalog writers; catalog errors propagate their
// normalized code instead.
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
