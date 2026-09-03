package server_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	rtserver "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/server"
)

var _ rtserver.HTTPServer = (*http.Server)(nil)

type fakeServer struct {
	serve                     func() error
	shutdown                  func(context.Context) error
	closeFn                   func() error
	shutdownCalls, closeCalls int
}

func (f *fakeServer) ListenAndServe() error              { return f.serve() }
func (f *fakeServer) Close() error                       { f.closeCalls++; return f.closeFn() }
func (f *fakeServer) Shutdown(ctx context.Context) error { f.shutdownCalls++; return f.shutdown(ctx) }

// runWithCancel starts Run, blocks on a real pre-cancellation serving barrier, then cancels.
func runWithCancel(t *testing.T, srv *fakeServer, drain time.Duration) error {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	serving := make(chan struct{})
	serve := srv.serve
	srv.serve = func() error { close(serving); return serve() }
	done := make(chan error, 1)
	go func() { done <- rtserver.Run(ctx, srv, drain) }()
	select {
	case <-serving:
	case <-time.After(2 * time.Second):
		t.Fatal("ListenAndServe never entered")
	}
	cancel()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return")
	}
	return nil
}
func TestRun_CancelRacingServeErrorClassifiesError(t *testing.T) {
	errBoom := errors.New("listener: boom")
	fail := make(chan struct{})
	fs := &fakeServer{
		serve:    func() error { <-fail; return errBoom },
		shutdown: func(context.Context) error { close(fail); return nil },
	}
	if err := runWithCancel(t, fs, time.Second); !errors.Is(err, errBoom) {
		t.Errorf("Run = %v, want the serve error racing cancellation", err)
	}
}
func TestRun_GracefulShutdownDoesNotClose(t *testing.T) {
	closing := make(chan struct{})
	fs := &fakeServer{
		serve:    func() error { <-closing; return http.ErrServerClosed },
		shutdown: func(ctx context.Context) error { close(closing); return ctx.Err() },
	}
	if err := runWithCancel(t, fs, time.Second); err != nil || fs.shutdownCalls != 1 || fs.closeCalls != 0 {
		t.Errorf("graceful Run = %v, lifecycle = (shutdown %d, close %d), want (nil, 1, 0)", err, fs.shutdownCalls, fs.closeCalls)
	}
}
func TestRun_ForcedDrainTimeoutClosesExactlyOnce(t *testing.T) {
	closedCh := make(chan struct{})
	fs := &fakeServer{
		serve:    func() error { <-closedCh; return http.ErrServerClosed },
		shutdown: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() },
		closeFn:  func() error { close(closedCh); return nil },
	}
	if err := runWithCancel(t, fs, 5*time.Millisecond); !errors.Is(err, context.DeadlineExceeded) || fs.shutdownCalls != 1 || fs.closeCalls != 1 {
		t.Errorf("forced Run = %v, lifecycle = (shutdown %d, close %d), want (DeadlineExceeded, 1, 1)", err, fs.shutdownCalls, fs.closeCalls)
	}
}
func TestRun_ServePathIsDeterministic(t *testing.T) {
	errBoom := errors.New("listener: boom")
	for _, tc := range []struct {
		name    string
		serve   func() error
		wantErr error // nil means expect nil
	}{
		{"serve error returned unchanged", func() error { return errBoom }, errBoom},
		{"ErrServerClosed normalized to nil", func() error { return http.ErrServerClosed }, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fs := &fakeServer{serve: tc.serve}
			err := rtserver.Run(context.Background(), fs, time.Second) // errors.Is(nil, nil) covers both rows
			if !errors.Is(err, tc.wantErr) || fs.shutdownCalls != 0 || fs.closeCalls != 0 {
				t.Errorf("Run = %v, lifecycle = (shutdown %d, close %d), want (%v, 0, 0)", err, fs.shutdownCalls, fs.closeCalls, tc.wantErr)
			}
		})
	}
}
func TestRun_UnexpectedShutdownErrorDoesNotClose(t *testing.T) {
	errShutdown := errors.New("shutdown failed")
	released := make(chan struct{})
	fs := &fakeServer{
		serve:    func() error { <-released; return http.ErrServerClosed },
		shutdown: func(context.Context) error { return errShutdown },
	}
	if err := runWithCancel(t, fs, time.Second); !errors.Is(err, errShutdown) || fs.closeCalls != 0 {
		t.Errorf("Run = %v (Close calls %d), want the shutdown error without Close", err, fs.closeCalls)
	}
	close(released) // unblock the serve goroutine; no leak
}
func TestNew(t *testing.T) {
	cfg := config.DefaultServerConfig(":0")
	srv, err := rtserver.New(cfg, http.NotFoundHandler())
	if err != nil {
		t.Fatalf("New = %v, want nil", err)
	}
	if srv.ReadHeaderTimeout != cfg.ReadHeaderTimeout || srv.ReadTimeout != cfg.ReadTimeout ||
		srv.WriteTimeout != cfg.WriteTimeout || srv.IdleTimeout != cfg.IdleTimeout {
		t.Errorf("New did not wire hardening timeouts: %+v vs %+v", srv, cfg)
	}
	if _, err := rtserver.New(config.ServerConfig{Addr: ":0", ReadTimeout: time.Second}, http.NotFoundHandler()); err == nil {
		t.Error("New(zero read_header timeout) = nil error, want validation error")
	}
}
