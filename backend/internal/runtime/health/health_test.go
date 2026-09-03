package health_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/health"
)

type stubPinger struct {
	err   error
	calls int
}

func (s *stubPinger) Ping(context.Context) error { s.calls++; return s.err }

// blockingPinger returns only once its context is done, so the readiness
// deadline (not the handler) decides the outcome.
type blockingPinger struct{}

func (blockingPinger) Ping(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }
func assertUnavailable(t *testing.T, status int, body string) {
	t.Helper()
	var env struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if status != 503 {
		t.Errorf("status = %d, want 503", status)
	}
	if err := json.Unmarshal([]byte(body), &env); err != nil {
		t.Fatalf("body is not a JSON envelope: %v", err)
	}
	if env.Code != "service_unavailable" || env.Error == "" {
		t.Errorf("envelope = (%q, %q), want service_unavailable with message", env.Error, env.Code)
	}
	if strings.Contains(body, "connection refused") {
		t.Errorf("driver detail leaked: %q", body)
	}
}
func TestHealthz_Static200WithoutDB(t *testing.T) {
	rec := httptest.NewRecorder()
	// nil port: any consultation would panic and fail the test.
	health.Healthz(nil)(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != 200 || rec.Body.String() != "ok" {
		t.Errorf("Healthz = (%d, %q), want (200, ok)", rec.Code, rec.Body.String())
	}
}
func TestReadyz(t *testing.T) {
	t.Run("ping success returns 200", func(t *testing.T) {
		rec := httptest.NewRecorder()
		p := &stubPinger{}
		health.Readyz(p, time.Second)(rec, httptest.NewRequest("GET", "/readyz", nil))
		if rec.Code != 200 || rec.Body.String() != "ok" || p.calls != 1 {
			t.Errorf("Readyz = (%d, %q) after %d pings, want (200, ok) with exactly one ping", rec.Code, rec.Body.String(), p.calls)
		}
	})
	t.Run("ping failure returns 503 service_unavailable envelope", func(t *testing.T) {
		rec := httptest.NewRecorder()
		p := &stubPinger{err: errors.New("db: connection refused")}
		health.Readyz(p, time.Second)(rec, httptest.NewRequest("GET", "/readyz", nil))
		assertUnavailable(t, rec.Code, rec.Body.String())
	})
	t.Run("readiness deadline is observed", func(t *testing.T) {
		rec := httptest.NewRecorder()
		health.Readyz(blockingPinger{}, 5*time.Millisecond)(rec, httptest.NewRequest("GET", "/readyz", nil))
		assertUnavailable(t, rec.Code, rec.Body.String())
	})
}
