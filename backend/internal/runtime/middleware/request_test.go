package middleware_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
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
// completionRecords returns the captured records carrying all bounded
// completion fields.
func completionRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var completions []map[string]any
	for _, rec := range decodeRecords(t, buf) {
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
	return completions
}

// TestRequestObservability_PropagatesCatalogCodeClass is the RED contract for
// the safe post-normalization catalog-code propagation slice: a handler that
// answers through httpjson.WriteCatalogError must still produce exactly one
// completion record, but its code_class must be the canonical catalog code
// (e.g. "not_found") from the already-normalized Definition — not the bare
// status bucket "4xx". The response itself stays the safe normalized catalog
// envelope, and the metric observation contract is unchanged and bounded.
func TestRequestObservability_PropagatesCatalogCodeClass(t *testing.T) {
	t.Parallel()

	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	spy := &httpMetricsSpy{}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(middleware.RequestObservability(logger, spy))
	r.Get("/companies/{id}", func(w http.ResponseWriter, _ *http.Request) {
		httpjson.WriteCatalogError(w, httpjson.Definition{
			Code:   httpjson.CodeNotFound,
			Status: http.StatusNotFound,
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/companies/abc", nil)
	req.Header.Set("X-Request-Id", fixedRequestID)
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)

	// Dispatch/response sanity: the RED failure must be attributable only to
	// the completion record's code_class, not routing or response behavior.
	if res.Code != http.StatusNotFound {
		t.Fatalf("response status = %d, want 404 (RED failure must be observability-only)", res.Code)
	}
	var envelope struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("response body is not the catalog envelope: %v", err)
	}
	if envelope.Code != string(httpjson.CodeNotFound) {
		t.Fatalf("response envelope code = %q, want %q (RED failure must be observability-only)", envelope.Code, httpjson.CodeNotFound)
	}

	completions := completionRecords(t, &logs)
	if len(completions) != 1 {
		t.Fatalf("completion records = %d, want exactly 1", len(completions))
	}
	rec := completions[0]
	if got, _ := rec["code_class"].(string); got != string(httpjson.CodeNotFound) {
		t.Errorf("code_class = %q, want canonical catalog code %q — the status bucket alone loses the normalized catalog classification", got, httpjson.CodeNotFound)
	}
	if got, _ := rec["path"].(string); got != "/companies/{id}" {
		t.Errorf("path = %q, want the bounded route pattern \"/companies/{id}\"", got)
	}
	if got, _ := rec["request_id"].(string); got != fixedRequestID {
		t.Errorf("request_id = %q, want %q", got, fixedRequestID)
	}
	if status, ok := rec["status"].(float64); !ok || int(status) != http.StatusNotFound {
		t.Errorf("status = %v (%T), want number %d", rec["status"], rec["status"], http.StatusNotFound)
	}
	if len(spy.observed) != 1 {
		t.Errorf("HTTP metric observations = %d, want exactly 1 (propagation must not alter the metric contract)", len(spy.observed))
	}
	if len(spy.observed) == 1 && spy.observed[0].status != http.StatusNotFound {
		t.Errorf("metric status = %d, want %d", spy.observed[0].status, http.StatusNotFound)
	}
}

// TestRequestObservability_PropagatesCatalogCodeClass_Triangulation pins the
// safety edges of the propagation: malformed or unknown definitions are
// normalized to internal_error BEFORE any propagation, WriteCatalogErrorData
// propagates its normalized code, and ordinary non-catalog 2xx responses keep
// the bounded success class "2xx".
func TestRequestObservability_PropagatesCatalogCodeClass_Triangulation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		handler    func(http.ResponseWriter, *http.Request)
		wantStatus int
		wantClass  string
	}{
		{
			name: "unknown catalog code normalizes to internal_error before propagation",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				httpjson.WriteCatalogError(w, httpjson.Definition{
					Code:   httpjson.Code("no_such_code"),
					Status: http.StatusTeapot,
				})
			},
			wantStatus: http.StatusInternalServerError,
			wantClass:  string(httpjson.CodeInternalError),
		},
		{
			name: "WriteCatalogErrorData propagates the normalized conflict code",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				httpjson.WriteCatalogErrorData(w, httpjson.Definition{
					Code:   httpjson.CodeConflict,
					Status: http.StatusConflict,
				}, map[string]string{"id": "abc"})
			},
			wantStatus: http.StatusConflict,
			wantClass:  string(httpjson.CodeConflict),
		},
		{
			name: "ordinary non-catalog success keeps the bounded 2xx class",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"ok":true}`))
			},
			wantStatus: http.StatusOK,
			wantClass:  successCodeClass,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var logs bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&logs, nil))
			spy := &httpMetricsSpy{}

			r := chi.NewRouter()
			r.Use(chimw.RequestID)
			r.Use(middleware.RequestObservability(logger, spy))
			r.Get("/companies/{id}", tt.handler)

			req := httptest.NewRequest(http.MethodGet, "/companies/abc", nil)
			req.Header.Set("X-Request-Id", fixedRequestID)
			res := httptest.NewRecorder()
			r.ServeHTTP(res, req)

			if res.Code != tt.wantStatus {
				t.Fatalf("response status = %d, want %d", res.Code, tt.wantStatus)
			}
			completions := completionRecords(t, &logs)
			if len(completions) != 1 {
				t.Fatalf("completion records = %d, want exactly 1", len(completions))
			}
			if got, _ := completions[0]["code_class"].(string); got != tt.wantClass {
				t.Errorf("code_class = %q, want %q", got, tt.wantClass)
			}
		})
	}
}

type writerCaps struct {
	flusher, hijacker, readerFrom, pusher bool
}

func capsOf(w any) writerCaps {
	var c writerCaps
	_, c.flusher = w.(http.Flusher)
	_, c.hijacker = w.(http.Hijacker)
	_, c.readerFrom = w.(io.ReaderFrom)
	_, c.pusher = w.(http.Pusher)
	return c
}

type fakeBaseWriter struct{ header http.Header }

func (w *fakeBaseWriter) Header() http.Header         { return w.header }
func (w *fakeBaseWriter) WriteHeader(int)             {}
func (w *fakeBaseWriter) Write(b []byte) (int, error) { return len(b), nil }

// fakeHTTP1Writer mimics net/http's HTTP/1 server writer: +Flusher/Hijacker/ReaderFrom.
type fakeHTTP1Writer struct{ fakeBaseWriter }

func (w *fakeHTTP1Writer) Flush()                              {}
func (w *fakeHTTP1Writer) ReadFrom(r io.Reader) (int64, error) { return io.Copy(io.Discard, r) }
func (w *fakeHTTP1Writer) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, http.ErrNotSupported
}

// fakeHTTP2Writer mimics net/http's HTTP/2 server writer: +Flusher/Pusher only.
type fakeHTTP2Writer struct{ fakeBaseWriter }

func (w *fakeHTTP2Writer) Flush()                               {}
func (w *fakeHTTP2Writer) Push(string, *http.PushOptions) error { return http.ErrNotSupported }

// TestRequestObservability_PreservesChiResponseWriterCapabilities (WS6C-2a remediation RED):
// the handler-facing writer must expose exactly chi's protocol-specific optional
// interface matrix (HTTP/1: Flusher+Hijacker+ReaderFrom; HTTP/2: Flusher+Pusher) —
// never hiding nor newly exposing a capability.
func TestRequestObservability_PreservesChiResponseWriterCapabilities(t *testing.T) {
	t.Parallel()

	capturedWriter := func(t *testing.T, protoMajor int, underlying http.ResponseWriter) http.ResponseWriter {
		t.Helper()
		r := chi.NewRouter()
		r.Use(chimw.RequestID)
		r.Use(middleware.RequestObservability(slog.New(slog.NewJSONHandler(io.Discard, nil)), &httpMetricsSpy{}))
		var captured http.ResponseWriter
		r.Get("/companies/{id}", func(w http.ResponseWriter, _ *http.Request) {
			captured = w
			w.WriteHeader(http.StatusOK)
		})
		req := httptest.NewRequest(http.MethodGet, "/companies/abc", nil)
		req.ProtoMajor = protoMajor
		r.ServeHTTP(underlying, req)
		if captured == nil {
			t.Fatal("handler never received a response writer")
		}
		return captured
	}

	assertCaps := func(t *testing.T, protoMajor int, underlying http.ResponseWriter, want writerCaps) {
		t.Helper()
		got := capsOf(capturedWriter(t, protoMajor, underlying))
		if got != want {
			t.Errorf("capability matrix = %+v, want %+v — RequestObservability must preserve chi's protocol-specific optional interfaces", got, want)
		}
		// Must also exactly match chi's own concrete wrapper (no hide, no add).
		baseline := capsOf(chimw.NewWrapResponseWriter(underlying, protoMajor))
		if got != baseline {
			t.Errorf("capability matrix = %+v, chi baseline = %+v — must match chi's concrete wrapper exactly", got, baseline)
		}
	}

	t.Run("http/1 keeps Flusher+Hijacker+ReaderFrom, no Pusher", func(t *testing.T) {
		t.Parallel()
		assertCaps(t, 1, &fakeHTTP1Writer{fakeBaseWriter{http.Header{}}},
			writerCaps{flusher: true, hijacker: true, readerFrom: true})
	})
	t.Run("http/2 keeps Flusher+Pusher, no Hijacker/ReaderFrom", func(t *testing.T) {
		t.Parallel()
		assertCaps(t, 2, &fakeHTTP2Writer{fakeBaseWriter{http.Header{}}},
			writerCaps{flusher: true, pusher: true})
	})
}

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

// TestRequestObservability_RandomUnknownRoutesUseBoundedUnmatchedPath is the
// Task 6.3 GREEN TRIANGULATION for randomized attacker-shaped unknown paths:
// each unmatched request must collapse its raw URL into the single bounded
// label "unmatched" on both the completion record's path and the metric
// route, emitting exactly one 404 completion record and one metric
// observation per request, with no raw path ever reaching the captured
// JSON log bytes. Deterministic: fixed-seed PRNG, so the paths repeat on
// every run.
func TestRequestObservability_RandomUnknownRoutesUseBoundedUnmatchedPath(t *testing.T) {
	t.Parallel()

	rng := rand.New(rand.NewSource(1))
	rawPaths := make([]string, 0, 6)
	for i := 0; i < 6; i++ {
		// Distinct URL-safe attacker-shaped paths: case index plus
		// hexadecimal PRNG output.
		rawPaths = append(rawPaths, fmt.Sprintf("/%x/%x/%d", rng.Uint64(), rng.Uint64(), i))
	}

	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	spy := &httpMetricsSpy{}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(middleware.RequestObservability(logger, spy))
	r.Get("/companies/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	for i, raw := range rawPaths {
		before := len(spy.observed)
		beforeRecords := len(completionRecords(t, &logs))

		req := httptest.NewRequest(http.MethodGet, raw, nil)
		req.Header.Set("X-Request-Id", fixedRequestID)
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)

		if res.Code != http.StatusNotFound {
			t.Fatalf("case %d (%q): response status = %d, want 404", i, raw, res.Code)
		}
		completions := completionRecords(t, &logs)
		if got := len(completions) - beforeRecords; got != 1 {
			t.Fatalf("case %d (%q): completion records emitted = %d, want exactly 1", i, raw, got)
		}
		rec := completions[len(completions)-1]
		if got, _ := rec["path"].(string); got != "unmatched" {
			t.Errorf("case %d: path = %q, want bounded %q (raw URL is forbidden)", i, got, "unmatched")
		}
		if got, _ := rec["method"].(string); got != http.MethodGet {
			t.Errorf("case %d: method = %q, want %q", i, got, http.MethodGet)
		}
		if status, ok := rec["status"].(float64); !ok || int(status) != http.StatusNotFound {
			t.Errorf("case %d: status = %v (%T), want number %d", i, rec["status"], rec["status"], http.StatusNotFound)
		}
		if got, _ := rec["code_class"].(string); got != "4xx" {
			t.Errorf("case %d: code_class = %q, want bounded 404 class %q", i, got, "4xx")
		}
		if got := len(spy.observed) - before; got != 1 {
			t.Fatalf("case %d: HTTP metric observations = %d, want exactly 1", i, got)
		}
		obs := spy.observed[len(spy.observed)-1]
		if obs.route != "unmatched" {
			t.Errorf("case %d: metric route = %q, want bounded %q", i, obs.route, "unmatched")
		}
		if obs.method != http.MethodGet || obs.status != http.StatusNotFound {
			t.Errorf("case %d: metric method/status = %q/%d, want %q/%d", i, obs.method, obs.status, http.MethodGet, http.StatusNotFound)
		}
	}

	for _, raw := range rawPaths {
		if bytes.Contains(logs.Bytes(), []byte(raw)) {
			t.Errorf("raw path %q leaked into captured JSON log bytes", raw)
		}
	}
}
