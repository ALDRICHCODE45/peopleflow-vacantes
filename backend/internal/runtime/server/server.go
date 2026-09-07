// Package server builds the hardened HTTP server and owns its lifecycle.
package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
)

// HTTPServer is the lifecycle surface Run depends on; *http.Server satisfies it.
type HTTPServer interface {
	ListenAndServe() error
	Shutdown(context.Context) error
	Close() error
}

// New builds a validated http.Server with all hardening timeouts.
func New(cfg config.ServerConfig, h http.Handler) (*http.Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &http.Server{
		Addr: cfg.Addr, Handler: h, ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout: cfg.ReadTimeout, WriteTimeout: cfg.WriteTimeout, IdleTimeout: cfg.IdleTimeout,
	}, nil
}

// Shutdown record vocabulary is a closed set: reason is always
// context_cancelled and classification is graceful (drained within budget) or
// forced (drain budget expired, Close used). The record carries no raw causes,
// errors, or environment details.
const (
	shutdownEvent          = "shutdown"
	shutdownReason         = "context_cancelled"
	classificationGraceful = "graceful"
	classificationForced   = "forced"
)

// logShutdownRecord emits the single structured shutdown record after the
// cancellation outcome is known, restricted to the strict safe field allowlist
// (standard slog fields plus event/reason/classification).
func logShutdownRecord(classification string) {
	slog.Info("server shutdown", "event", shutdownEvent, "reason", shutdownReason, "classification", classification)
}

// Run serves until ctx is cancelled or the server fails; unexpected serve errors
// return unchanged (no Shutdown/Close) and ErrServerClosed → nil. On ctx
// cancellation it shuts down with a WithoutCancel drain context bounded by drain
// (Close exactly once, only on expiry); after a successful Shutdown the
// concurrent ListenAndServe result is consumed and classified, never dropped.
// Exactly one structured shutdown record is emitted once the cancellation
// outcome is fully known: graceful only after the listener result is consumed
// and classified as a successful shutdown, forced after drain-budget expiry and
// Close. Pre-cancellation listener exits, cancellation-racing listener errors,
// and unexpected shutdown errors (returned unchanged, never also logged) emit
// no record.
func Run(ctx context.Context, srv HTTPServer, drain time.Duration) error {
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ListenAndServe() }()
	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}
	drainCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), drain)
	defer cancel()
	if err := srv.Shutdown(drainCtx); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			closeErr := srv.Close()
			logShutdownRecord(classificationForced)
			return errors.Join(err, closeErr)
		}
		return err
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	logShutdownRecord(classificationGraceful) // only after the listener result confirms the graceful drain
	return nil
}
