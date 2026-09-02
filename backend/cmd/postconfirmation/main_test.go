// Tests for the PostConfirmation Lambda executable composition root: strict
// environment configuration, validation-before-dependency ordering, safe
// failure messages, and the open/ping/wire/start lifecycle. The real Lambda
// runtime and Postgres are never contacted; the starter and pool are fakes.
package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/lambdapostconfirmation"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// fakePool records ping/close invocations so tests can assert observable
// lifecycle behavior without touching Postgres.
type fakePool struct {
	pingCalls int
	pingErr   error
	closed    int
}

func (f *fakePool) Ping(context.Context) error { f.pingCalls++; return f.pingErr }
func (f *fakePool) Close()                     { f.closed++ }
func (f *fakePool) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (f *fakePool) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("fakePool: query not supported")
}
func (f *fakePool) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

// Compile-time assertion that the fake satisfies the consumer-side seam.
var _ poolPort = (*fakePool)(nil)

// recordingOpener records open invocations and returns the configured pool or error.
type recordingOpener struct {
	calls int
	dsn   string
	pool  poolPort
	err   error
}

func (o *recordingOpener) open(_ context.Context, dsn string) (poolPort, error) {
	o.calls++
	o.dsn = dsn
	return o.pool, o.err
}

// recordingStarter records Lambda-runtime starts; it never touches AWS.
type recordingStarter struct {
	calls   int
	handler any
}

func (s *recordingStarter) start(handler any) {
	s.calls++
	s.handler = handler
}

func getenvOverlay(overlay map[string]string) func(string) string {
	return func(key string) string { return overlay[key] }
}

// dsn is a syntactically valid, never-contacted DSN for composition tests.
const dsn = "postgres://tester:not-a-secret@example.invalid:5432/test"

func validOverlay() map[string]string {
	return map[string]string{
		"APP_ENV":                           "production",
		"IDENTITY_POSTCONFIRMATION_ENABLED": "true",
		"DATABASE_URL":                      dsn,
	}
}

// assertSafeError fails when an error message carries any forbidden fragment
// (env values, DSNs, credentials, raw driver text).
func assertSafeError(t *testing.T, forbidden ...string) func(error) {
	t.Helper()
	return func(err error) {
		t.Helper()
		if err == nil {
			t.Fatal("expected an error, got nil")
			return
		}
		msg := err.Error()
		for _, f := range forbidden {
			if f != "" && leaks(msg, f) {
				t.Errorf("error message leaks %q: %q", f, msg)
			}
		}
	}
}

// leaks reports whether msg carries the forbidden fragment: as a whole token
// for short fragments (a single-letter alias like "t" must not falsely match
// inside "exactly"), or as a substring for longer ones (catching embedded
// values such as DSNs or key=value forms).
func leaks(msg, fragment string) bool {
	for _, field := range strings.Fields(msg) {
		if strings.Trim(field, "=:") == fragment {
			return true
		}
		if len(fragment) > 2 && strings.Contains(field, fragment) {
			return true
		}
	}
	return false
}

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name     string
		override map[string]string
		remove   []string
		wantOK   bool
		leak     string
	}{
		{name: "valid production enabled", wantOK: true},
		{name: "valid local explicit false", override: map[string]string{"APP_ENV": "local", "IDENTITY_POSTCONFIRMATION_ENABLED": "false"}, wantOK: true},
		{name: "valid test explicit false", override: map[string]string{"APP_ENV": "test", "IDENTITY_POSTCONFIRMATION_ENABLED": "false"}, wantOK: true},
		{name: "local explicit true accepted", override: map[string]string{"APP_ENV": "local"}, wantOK: true},
		{name: "case normalization accepted", override: map[string]string{"APP_ENV": "PRODUCTION", "IDENTITY_POSTCONFIRMATION_ENABLED": "TRUE"}, wantOK: true},
		{name: "missing APP_ENV rejected", remove: []string{"APP_ENV"}},
		{name: "unknown APP_ENV rejected", override: map[string]string{"APP_ENV": "staging"}, leak: "staging"},
		{name: "blank APP_ENV rejected", override: map[string]string{"APP_ENV": "   "}},
		{name: "missing enablement rejected", remove: []string{"IDENTITY_POSTCONFIRMATION_ENABLED"}},
		{name: "enablement alias 1 rejected", override: map[string]string{"IDENTITY_POSTCONFIRMATION_ENABLED": "1"}, leak: "1"},
		{name: "enablement alias t rejected", override: map[string]string{"IDENTITY_POSTCONFIRMATION_ENABLED": "t"}, leak: "t"},
		{name: "enablement alias yes rejected", override: map[string]string{"IDENTITY_POSTCONFIRMATION_ENABLED": "yes"}, leak: "yes"},
		{name: "enablement alias on rejected", override: map[string]string{"IDENTITY_POSTCONFIRMATION_ENABLED": "on"}, leak: "on"},
		{name: "production explicit false rejected", override: map[string]string{"IDENTITY_POSTCONFIRMATION_ENABLED": "false"}},
		{name: "missing DATABASE_URL rejected", remove: []string{"DATABASE_URL"}},
		{name: "empty DATABASE_URL rejected", override: map[string]string{"DATABASE_URL": ""}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := validOverlay()
			for k, v := range tt.override {
				env[k] = v
			}
			for _, k := range tt.remove {
				delete(env, k)
			}

			cfg, err := loadConfig(getenvOverlay(env))

			if tt.wantOK {
				if err != nil {
					t.Fatalf("loadConfig returned error: %v", err)
				}
				if cfg.dsn != dsn {
					t.Errorf("cfg.dsn = %q, want %q", cfg.dsn, dsn)
				}
				return
			}
			assertSafeError(t, tt.leak, dsn, "not-a-secret")(err)
		})
	}
}

func TestRun(t *testing.T) {
	t.Run("invalid config validates before opening or starting", func(t *testing.T) {
		env := validOverlay()
		delete(env, "APP_ENV")
		opener := &recordingOpener{}
		starter := &recordingStarter{}

		err := run(context.Background(), getenvOverlay(env), opener.open, starter.start)

		assertSafeError(t, dsn, "not-a-secret")(err)
		if opener.calls != 0 {
			t.Errorf("pool opened %d times; config must validate before any dependency is created", opener.calls)
		}
		if starter.calls != 0 {
			t.Errorf("lambda started %d times; config must validate before runtime start", starter.calls)
		}
	})

	t.Run("open failure returns a safe error without starting", func(t *testing.T) {
		opener := &recordingOpener{err: errors.New("raw pgx driver detail with postgres://leak")}
		starter := &recordingStarter{}

		err := run(context.Background(), getenvOverlay(validOverlay()), opener.open, starter.start)

		assertSafeError(t, dsn, "not-a-secret", "pgx", "leak")(err)
		if opener.calls != 1 || opener.dsn != dsn {
			t.Errorf("opener calls = %d, dsn = %q; want 1 call with the configured DSN", opener.calls, opener.dsn)
		}
		if starter.calls != 0 {
			t.Errorf("lambda started %d times on open failure", starter.calls)
		}
	})

	t.Run("ping failure closes the pool and refuses to start", func(t *testing.T) {
		pool := &fakePool{pingErr: errors.New("raw connection refused detail")}
		opener := &recordingOpener{pool: pool}
		starter := &recordingStarter{}

		err := run(context.Background(), getenvOverlay(validOverlay()), opener.open, starter.start)

		assertSafeError(t, "connection refused")(err)
		if pool.pingCalls != 1 {
			t.Errorf("ping calls = %d, want 1", pool.pingCalls)
		}
		if pool.closed != 1 {
			t.Errorf("pool closed %d times on ping failure, want 1", pool.closed)
		}
		if starter.calls != 0 {
			t.Errorf("lambda started %d times on ping failure", starter.calls)
		}
	})

	t.Run("successful composition starts the adapter exactly once", func(t *testing.T) {
		pool := &fakePool{}
		opener := &recordingOpener{pool: pool}
		starter := &recordingStarter{}

		if err := run(context.Background(), getenvOverlay(validOverlay()), opener.open, starter.start); err != nil {
			t.Fatalf("run returned error: %v", err)
		}

		if starter.calls != 1 {
			t.Fatalf("lambda starts = %d, want exactly 1", starter.calls)
		}
		if _, ok := starter.handler.(*lambdapostconfirmation.Adapter); !ok {
			t.Errorf("started handler type = %T, want *lambdapostconfirmation.Adapter", starter.handler)
		}
		if opener.dsn != dsn || pool.pingCalls != 1 {
			t.Errorf("open/ping not exercised as expected: dsn = %q, pingCalls = %d", opener.dsn, pool.pingCalls)
		}
		if pool.closed != 1 {
			t.Errorf("pool closed %d times after run returned, want 1", pool.closed)
		}
	})

	t.Run("local explicit false composes and starts with the application no-op gate", func(t *testing.T) {
		env := validOverlay()
		env["APP_ENV"] = "local"
		env["IDENTITY_POSTCONFIRMATION_ENABLED"] = "false"
		pool := &fakePool{}
		opener := &recordingOpener{pool: pool}
		starter := &recordingStarter{}

		if err := run(context.Background(), getenvOverlay(env), opener.open, starter.start); err != nil {
			t.Fatalf("run returned error for valid local disabled config: %v", err)
		}
		if starter.calls != 1 {
			t.Errorf("lambda starts = %d, want 1 (the disable gate is enforced inside the application handler)", starter.calls)
		}
		if pool.closed != 1 {
			t.Errorf("pool closed %d times after run returned, want 1", pool.closed)
		}
	})
}
