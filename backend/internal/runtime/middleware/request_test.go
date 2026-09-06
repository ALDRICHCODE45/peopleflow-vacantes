package middleware_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
)

// fixedRequestID is a fixed, bounded X-Request-Id value consumed by chi's
// RequestID middleware so the completion record's request_id is deterministic.
const fixedRequestID = "red-fixed-request-id-0001"

// successCodeClass pins the bounded success classification of the catalog
// code-class taxonomy (bounded set: 2xx / 4xx / 5xx); catalog error
// propagation belongs to a later unit.
const successCodeClass = "2xx"

// completionRecordKeys are the six bounded fields the Task 6.3 completion
// contract requires on exactly one structured record per request.
var completionRecordKeys = [...]string{
	"request_id", "method", "path", "status", "duration", "code_class",
}

// observedRequest captures one HTTPMetrics.ObserveRequest call.
type observedRequest struct {
	method, route string
	status        int
	duration      time.Duration
}

// httpMetricsSpy is the test spy proving exactly one bounded metric
// observation per request.
type httpMetricsSpy struct{ observed []observedRequest }

func (s *httpMetricsSpy) ObserveRequest(method, route string, status int, d time.Duration) {
	s.observed = append(s.observed, observedRequest{method, route, status, d})
}

// decodeRecords parses one slog JSONHandler record per non-empty line.
func decodeRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range bytes.Split(buf.Bytes(), []byte("\n")) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal(line, &rec); err != nil {
			t.Fatalf("captured log line is not a JSON record: %q: %v", line, err)
		}
		records = append(records, rec)
	}
	return records
}

// TestRequestObservability_EmitsOneCompletionRecordAndOneMetricPerRequest is
// the Task 6.3 RED contract for the first bounded slice: one successful
// request to the known parameterized route /companies/{id} must produce
// exactly one structured completion record with the bounded fields
// request_id/method/path/status/duration/code_class (success code class) and
// exactly one HTTP metric observation. Both count checks are non-fatal so a
// single RED run independently records two failure messages: zero completion
// records (the stub middleware emits no completion record and the captured
// logs lack the required fields) AND zero HTTP metric observations. Field
// assertions are guarded so they never dereference a missing record. The RED
// failure is never compilation, setup, route dispatch, or response behavior.
func TestRequestObservability_EmitsOneCompletionRecordAndOneMetricPerRequest(t *testing.T) {
	t.Parallel()

	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	spy := &httpMetricsSpy{}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(middleware.RequestObservability(logger, spy))
	r.Get("/companies/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"abc"}`))
	})

	req := httptest.NewRequest(http.MethodGet, "/companies/abc", nil)
	req.Header.Set("X-Request-Id", fixedRequestID)
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)

	// Dispatch/response sanity: the RED failure must be attributable only to
	// missing log/metric emission, not routing or handler behavior.
	if res.Code != http.StatusOK {
		t.Fatalf("response status = %d, want 200 (RED failure must be log/metric-only, not dispatch)", res.Code)
	}

	records := decodeRecords(t, &logs)

	var completions []map[string]any
	for _, rec := range records {
		complete := true
		for _, k := range completionRecordKeys {
			if _, ok := rec[k]; !ok {
				complete = false
				break
			}
		}
		if complete {
			completions = append(completions, rec)
		}
	}
	if len(completions) != 1 {
		t.Errorf("completion records carrying bounded fields %v = %d, want 1 — the stub middleware emits no completion record and the captured logs lack the required fields (captured records: %d)",
			completionRecordKeys, len(completions), len(records))
	}
	// Field assertions are guarded: when no completion record exists the count
	// failure above already records the RED contract, and dereferencing an
	// absent record must not panic or mask the independent metric check below.
	if len(completions) == 1 {
		rec := completions[0]

		if got, _ := rec["request_id"].(string); got != fixedRequestID {
			t.Errorf("request_id = %q, want %q", got, fixedRequestID)
		}
		if got, _ := rec["method"].(string); got != http.MethodGet {
			t.Errorf("method = %q, want %q", got, http.MethodGet)
		}
		// path MUST be the matched chi route pattern, never the raw URL
		// ("/companies/abc"): the request URL intentionally differs from the pattern.
		if got, _ := rec["path"].(string); got != "/companies/{id}" {
			t.Errorf("path = %q, want the matched route pattern %q (raw URL is forbidden)", got, "/companies/{id}")
		}
		if status, ok := rec["status"].(float64); !ok || int(status) != http.StatusOK {
			t.Errorf("status = %v (%T), want number %d", rec["status"], rec["status"], http.StatusOK)
		}
		if dur, ok := rec["duration"].(float64); !ok || dur <= 0 {
			t.Errorf("duration = %v (%T), want a positive number", rec["duration"], rec["duration"])
		}
		if got, _ := rec["code_class"].(string); got != successCodeClass {
			t.Errorf("code_class = %q, want bounded success class %q", got, successCodeClass)
		}
	}

	if len(spy.observed) != 1 {
		t.Errorf("HTTP metric observations = %d, want exactly 1 — the stub middleware records no request metric", len(spy.observed))
	}
	// Same guard discipline: the metric count failure above independently
	// records the RED contract; no observation means no fields to assert.
	if len(spy.observed) == 1 {
		obs := spy.observed[0]
		if obs.method != http.MethodGet {
			t.Errorf("metric method = %q, want %q", obs.method, http.MethodGet)
		}
		if obs.route != "/companies/{id}" {
			t.Errorf("metric route = %q, want bounded route pattern %q", obs.route, "/companies/{id}")
		}
		if obs.status != http.StatusOK {
			t.Errorf("metric status = %d, want %d", obs.status, http.StatusOK)
		}
		if obs.duration <= 0 {
			t.Errorf("metric duration = %v, want > 0", obs.duration)
		}
	}
}
