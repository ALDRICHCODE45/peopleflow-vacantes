// Package server builds the hardened HTTP server and owns its lifecycle.
package server

import (
	"context"
	"errors"
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

// Run serves until ctx is cancelled or the server fails; unexpected serve errors
// return unchanged (no Shutdown/Close) and ErrServerClosed → nil. On ctx
// cancellation it shuts down with a WithoutCancel drain context bounded by drain
// (Close exactly once, only on expiry); after a successful Shutdown the
// concurrent ListenAndServe result is consumed and classified, never dropped.
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
			return errors.Join(err, srv.Close())
		}
		return err
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
