package health_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"

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

// readinessSpy records every SetReady call in order, so tests can assert
// exactly one gauge observation with the wanted value per readiness outcome.
type readinessSpy struct{ calls []bool }

func (s *readinessSpy) SetReady(ready bool) { s.calls = append(s.calls, ready) }

// captureReadinessLog returns a *slog.Logger whose JSON records land in buf,
// mirroring the production JSON handler shape.
func captureReadinessLog(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(buf, nil))
}

// parseReadinessRecords splits captured JSON-handler output into per-line
// records; a non-JSON line is a hard failure.
func parseReadinessRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var recs []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("captured log line is not JSON: %v\nline: %s", err, line)
		}
		recs = append(recs, rec)
	}
	return recs
}

// readinessFailureRecords selects the captured records that classify a
// readiness failure (event == "readiness").
func readinessFailureRecords(recs []map[string]any) []map[string]any {
	var out []map[string]any
	for _, rec := range recs {
		if rec["event"] == "readiness" {
			out = append(out, rec)
		}
	}
	return out
}

// readinessRecordKeys is the CLOSED field set of a readiness failure record:
// the standard slog keys plus exactly the three bounded readiness fields.
var readinessRecordKeys = map[string]bool{
	"time": true, "level": true, "msg": true,
	"request_id": true, "event": true, "classification": true,
}

// assertSafeReadinessRecord asserts the closed, bounded shape of the single
// readiness failure record: the exact key set, the wanted bounded
// classification, the chi request ID when supplied, and no injected DB detail
// or error string anywhere in the response body or captured log.
func assertSafeReadinessRecord(t *testing.T, records []map[string]any, rawLog, body, classification, wantRequestID string) {
	t.Helper()
	if len(records) != 1 {
		return
	}
	rec := records[0]
	for k := range rec {
		if !readinessRecordKeys[k] {
			t.Errorf("readiness failure record has unbounded key %q (closed set: time/level/msg/request_id/event/classification): %v", k, rec)
		}
	}
	if rec["event"] != "readiness" {
		t.Errorf("event = %v, want bounded \"readiness\"", rec["event"])
	}
	if rec["classification"] != classification {
		t.Errorf("classification = %v, want bounded %q", rec["classification"], classification)
	}
	if wantRequestID != "" && rec["request_id"] != wantRequestID {
		t.Errorf("request_id = %v, want the chi request-context ID %q", rec["request_id"], wantRequestID)
	}
	for _, frag := range []string{"connection refused", "db:"} {
		if strings.Contains(rawLog, frag) {
			t.Errorf("captured readiness log leaks forbidden fragment %q (the ping error must never be attached or stringified): %s", frag, rawLog)
		}
	}
	if strings.Contains(body, "connection refused") {
		t.Errorf("readiness response leaks driver detail: %q", body)
	}
}

// TestReadyz_Observability is the behavioral RED/GREEN test for the ws6c-4a
// readiness-gauge and safe-classification slice: every /readyz outcome
// produces exactly one ReadinessMetrics.SetReady observation, and failure
// only produces exactly one request-correlated, safely classified structured
// record with closed bounded fields (never the ping error itself).
func TestReadyz_Observability(t *testing.T) {
	newReadyz := func(p health.Pinger, timeout time.Duration, logger *slog.Logger, spy *readinessSpy) http.Handler {
		return health.Readyz(p, timeout, logger, spy)
	}

	t.Run("success emits exactly one true observation and no failure record", func(t *testing.T) {
		var buf bytes.Buffer
		spy := &readinessSpy{}
		rec := httptest.NewRecorder()
		newReadyz(&stubPinger{}, time.Second, captureReadinessLog(&buf), spy).
			ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
		if len(spy.calls) != 1 {
			t.Errorf("readiness metric observations = %d, want exactly 1", len(spy.calls))
		} else if !spy.calls[0] {
			t.Errorf("readiness metric observation = false, want true after successful ping")
		}
		if records := readinessFailureRecords(parseReadinessRecords(t, &buf)); len(records) != 0 {
			t.Errorf("readiness failure records = %d, want exactly 0 on success: %v", len(records), records)
		}
	})

	t.Run("ordinary ping failure emits one false observation and one safe record", func(t *testing.T) {
		var buf bytes.Buffer
		spy := &readinessSpy{}
		rec := httptest.NewRecorder()
		p := &stubPinger{err: errors.New("db: connection refused")}
		newReadyz(p, time.Second, captureReadinessLog(&buf), spy).
			ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
		if len(spy.calls) != 1 {
			t.Errorf("readiness metric observations = %d, want exactly 1", len(spy.calls))
		} else if spy.calls[0] {
			t.Errorf("readiness metric observation = true, want false after failed ping")
		}
		records := readinessFailureRecords(parseReadinessRecords(t, &buf))
		if len(records) != 1 {
			t.Errorf("readiness failure records = %d, want exactly 1", len(records))
		}
		assertUnavailable(t, rec.Code, rec.Body.String())
		assertSafeReadinessRecord(t, records, buf.String(), rec.Body.String(), "ping_failed", "")
	})

	t.Run("deadline emits one false observation and the same bounded classification", func(t *testing.T) {
		var buf bytes.Buffer
		spy := &readinessSpy{}
		rec := httptest.NewRecorder()
		newReadyz(blockingPinger{}, 5*time.Millisecond, captureReadinessLog(&buf), spy).
			ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
		if len(spy.calls) != 1 {
			t.Errorf("readiness metric observations = %d, want exactly 1", len(spy.calls))
		} else if spy.calls[0] {
			t.Errorf("readiness metric observation = true, want false after readiness deadline")
		}
		records := readinessFailureRecords(parseReadinessRecords(t, &buf))
		if len(records) != 1 {
			t.Errorf("readiness failure records = %d, want exactly 1", len(records))
		}
		assertUnavailable(t, rec.Code, rec.Body.String())
		assertSafeReadinessRecord(t, records, buf.String(), rec.Body.String(), "deadline", "")
	})

	t.Run("failure record carries the chi request id from the request context", func(t *testing.T) {
		var buf bytes.Buffer
		spy := &readinessSpy{}
		var chiID string
		probe := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			chiID = chimw.GetReqID(r.Context())
			newReadyz(&stubPinger{err: errors.New("db: connection refused")}, time.Second, captureReadinessLog(&buf), spy).ServeHTTP(w, r)
		})
		rec := httptest.NewRecorder()
		chimw.RequestID(probe).ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
		if chiID == "" {
			t.Fatalf("chi RequestID middleware produced no request ID; the correlation probe is vacuous")
		}
		records := readinessFailureRecords(parseReadinessRecords(t, &buf))
		if len(records) != 1 {
			t.Errorf("readiness failure records = %d, want exactly 1", len(records))
		}
		assertSafeReadinessRecord(t, records, buf.String(), rec.Body.String(), "ping_failed", chiID)
	})
}

func TestReadyz(t *testing.T) {
	t.Run("ping success returns 200", func(t *testing.T) {
		rec := httptest.NewRecorder()
		p := &stubPinger{}
		health.Readyz(p, time.Second, nil, nil)(rec, httptest.NewRequest("GET", "/readyz", nil))
		if rec.Code != 200 || rec.Body.String() != "ok" || p.calls != 1 {
			t.Errorf("Readyz = (%d, %q) after %d pings, want (200, ok) with exactly one ping", rec.Code, rec.Body.String(), p.calls)
		}
	})
	t.Run("ping failure returns 503 service_unavailable envelope", func(t *testing.T) {
		rec := httptest.NewRecorder()
		p := &stubPinger{err: errors.New("db: connection refused")}
		health.Readyz(p, time.Second, nil, nil)(rec, httptest.NewRequest("GET", "/readyz", nil))
		assertUnavailable(t, rec.Code, rec.Body.String())
	})
	t.Run("readiness deadline is observed", func(t *testing.T) {
		rec := httptest.NewRecorder()
		health.Readyz(blockingPinger{}, 5*time.Millisecond, nil, nil)(rec, httptest.NewRequest("GET", "/readyz", nil))
		assertUnavailable(t, rec.Code, rec.Body.String())
	})
}
