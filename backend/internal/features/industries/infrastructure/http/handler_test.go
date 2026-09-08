package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

// stubDBQueries implements industriesReader for test purposes.
type stubDBQueries struct {
	listIndustriesOut []db.Industry
	listIndustriesErr error
}

func (s *stubDBQueries) ListActiveIndustries(ctx context.Context) ([]db.Industry, error) {
	if s.listIndustriesErr != nil {
		return nil, s.listIndustriesErr
	}
	out := make([]db.Industry, len(s.listIndustriesOut))
	copy(out, s.listIndustriesOut)
	return out, nil
}

// --- helpers ----------------------------------------------------------------

func assertCatalogEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode httpjson.Code) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("want %d, got %d: %s", wantStatus, rec.Code, rec.Body.String())
	}
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != wantCode {
		t.Errorf("code: want %q, got %q", wantCode, env.Code)
	}
}

// --- tests ------------------------------------------------------------------

// TestListIndustries_InternalErrorReturnsCatalogEnvelope verifies that a DB
// failure returns a stable V1 error envelope with catalog code internal_error
// and status 500. The raw DB error must NOT appear in the client response.
// This is the task 1.4 DB-failure catalog envelope test.
func TestListIndustries_InternalErrorReturnsCatalogEnvelope(t *testing.T) {
	stub := &stubDBQueries{
		listIndustriesErr: errors.New("db: connection refused"),
	}
	handler := ListIndustries(stub)

	req := httptest.NewRequest(http.MethodGet, "/industries", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Assert catalog code and status.
	assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)

	// Prove non-leakage: canonical generic message, no injected DB detail.
	body := rec.Body.String()
	wantMsg := "an internal error occurred"
	if !strings.Contains(body, wantMsg) {
		t.Errorf("error message: want %q somewhere in body", wantMsg)
	}
	// The injected "db: connection refused" must not appear.
	if strings.Contains(body, "connection refused") {
		t.Errorf("error message must not leak DB detail: %s", body)
	}
}

// decodeIndustryArray decodes a successful GET /industries body as a
// slice of raw-keyed objects so tests can assert the EXACT key set.
func decodeIndustryArray(t *testing.T, rec *httptest.ResponseRecorder) []map[string]json.RawMessage {
	t.Helper()
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode response as JSON array: %v; body=%s", err, rec.Body.String())
	}
	return rows
}

// assertExactWireKeys proves one element carries exactly the four contract
// fields — no `active`, no `created_at`, no `updated_at`, nothing else.
func assertExactWireKeys(t *testing.T, elem map[string]json.RawMessage) {
	t.Helper()
	got := make([]string, 0, len(elem))
	for k := range elem {
		got = append(got, k)
	}
	sort.Strings(got)
	want := []string{"id", "label_en", "label_es", "sort_order"}
	if !equalStrings(got, want) {
		t.Errorf("element keys: want exactly %v, got %v", want, got)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestListIndustries_WireShapeExactlyFourFields pins the WS3B public
// contract: a 200 JSON array (never null) whose elements carry exactly
// id, label_es, label_en, and sort_order — and the zero-row edge stays
// `[]`, never `null`.
func TestListIndustries_WireShapeExactlyFourFields(t *testing.T) {
	stub := &stubDBQueries{listIndustriesOut: []db.Industry{
		{ID: "technology", LabelEs: "Tecnología", LabelEn: "Technology", SortOrder: 10},
	}}
	handler := ListIndustries(stub)

	req := httptest.NewRequest(http.MethodGet, "/industries", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rows := decodeIndustryArray(t, rec)
	if rows == nil {
		t.Fatal("response decoded as null; want a JSON array (never null)")
	}
	if len(rows) != 1 {
		t.Fatalf("want 1 element, got %d", len(rows))
	}
	assertExactWireKeys(t, rows[0])
	if string(rows[0]["id"]) != `"technology"` {
		t.Errorf("id: want %q, got %s", "technology", rows[0]["id"])
	}

	empty := ListIndustries(&stubDBQueries{})
	req2 := httptest.NewRequest(http.MethodGet, "/industries", nil)
	rec2 := httptest.NewRecorder()
	empty.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("empty catalog: want 200, got %d: %s", rec2.Code, rec2.Body.String())
	}
	if strings.TrimSpace(rec2.Body.String()) == "null" {
		t.Fatal("empty catalog serialized as null; want []")
	}
	rows2 := decodeIndustryArray(t, rec2)
	if rows2 == nil || len(rows2) != 0 {
		t.Fatalf("empty catalog: want empty non-null array, got %v (%s)", rows2, rec2.Body.String())
	}
}

// TestListIndustries_AuthorizationHeaderIgnored pins the public
// contract: a present (even garbage) Bearer token is ignored.
func TestListIndustries_AuthorizationHeaderIgnored(t *testing.T) {
	stub := &stubDBQueries{listIndustriesOut: []db.Industry{
		{ID: "technology", LabelEs: "Tecnología", LabelEn: "Technology", SortOrder: 10},
	}}
	handler := ListIndustries(stub)

	req := httptest.NewRequest(http.MethodGet, "/industries", nil)
	req.Header.Set("Authorization", "Bearer garbage-ws3b-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Authorization header must be ignored; want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "technology") {
		t.Errorf("catalog rows must be served despite Authorization header: %s", rec.Body.String())
	}
}

// --- WS6C: unexpected-error log correlation & redaction ---------------------

// captureIndustriesSlogJSON swaps the process-global default slog logger for
// a JSON handler writing into the returned buffer and registers the restore
// via t.Cleanup. Tests using it MUST stay non-parallel (slog.Default is
// shared state). Callers MUST install the capturing logger BEFORE building
// the router so RequestObservability(nil, nil) binds it.
func captureIndustriesSlogJSON(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// decodeIndustriesSlogRecords splits a captured JSON slog stream into one
// key/value map per emitted record.
func decodeIndustriesSlogRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("captured slog line is not JSON: %v: %q", err, line)
		}
		records = append(records, rec)
	}
	return records
}

// industriesSensitiveMarkers carries one synthetic marker per forbidden
// class: DSN, bearer token, email/name, CV key, query string, raw driver
// error. None of them may ever appear in captured logs or on the wire.
var industriesSensitiveMarkers = []string{
	"postgres://svc:hunter2@db.internal:5432/peopleflow",
	"tok-synthetic-0f3a9c",
	"candidate.personal@example.com",
	"resumes/cv-synthetic-key.pdf",
	"query=classified-leak",
	`pq: relation "industries" does not exist`,
}

// assertNoIndustriesSensitiveMarker fails when any synthetic marker appears
// in raw.
func assertNoIndustriesSensitiveMarker(t *testing.T, what, raw string) {
	t.Helper()
	for _, m := range industriesSensitiveMarkers {
		if strings.Contains(raw, m) {
			t.Errorf("%s must not contain synthetic marker %q", what, m)
		}
	}
}

// runListIndustriesUnexpectedErrorScenario fires GET /industries through the
// production-shaped chain chi RequestID → runtime RequestObservability →
// industries RegisterRoutes while the stub injects an unexpected error laden
// with synthetic sensitive markers. When requestIDHeader is non-empty it is
// sent as X-Request-Id so chi's RequestID middleware adopts the caller value.
func runListIndustriesUnexpectedErrorScenario(t *testing.T, requestIDHeader string) (*bytes.Buffer, *httptest.ResponseRecorder) {
	t.Helper()
	stub := &stubDBQueries{
		listIndustriesErr: fmt.Errorf("db: %s", strings.Join(industriesSensitiveMarkers, "; ")),
	}

	// Capturing logger first, so the runtime middleware binds it.
	buf := captureIndustriesSlogJSON(t)

	router := chi.NewRouter()
	router.Use(chimw.RequestID)
	router.Use(middleware.RequestObservability(nil, nil))
	RegisterRoutes(router, stub)

	req := httptest.NewRequest(http.MethodGet, "/industries", nil)
	if requestIDHeader != "" {
		req.Header.Set("X-Request-Id", requestIDHeader)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return buf, rec
}

// TestListIndustries_UnexpectedErrorLogCorrelationAndRedaction pins the WS6C
// bounded unexpected-error contract for GET /industries: the auxiliary ERROR
// record carries exactly time/level/msg/code_class plus the correlated
// request_id (shared with the completion record, adopted from the caller's
// X-Request-Id when supplied or generated by chi's RequestID middleware), the
// completion INFO record reports the bounded route with status 500 and the
// canonical internal_error class, and no sensitive marker from the injected
// error reaches the logs or the wire. The raw error is never logged at any
// level; the request middleware owns bounded request correlation.
func TestListIndustries_UnexpectedErrorLogCorrelationAndRedaction(t *testing.T) {
	const suppliedID = "req-supplied-fixed-ws6c"
	const auxMsg = "list industries failed"
	const completionMsg = "http request completed"

	t.Run("supplied_request_id_correlated_and_redacted", func(t *testing.T) {
		buf, rec := runListIndustriesUnexpectedErrorScenario(t, suppliedID)

		// Wire: canonical 500 internal_error envelope, nothing else leaks.
		assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
		var env httpjson.ErrorEnvelope
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode envelope: %v", err)
		}
		if env.Error != "an internal error occurred" {
			t.Errorf("canonical message: want %q, got %q", "an internal error occurred", env.Error)
		}
		assertNoIndustriesSensitiveMarker(t, "wire body", rec.Body.String())

		// Exactly two records: one auxiliary ERROR + one completion INFO.
		records := decodeIndustriesSlogRecords(t, buf)
		var auxRecords, completions []map[string]any
		for _, r := range records {
			switch r["msg"] {
			case auxMsg:
				auxRecords = append(auxRecords, r)
			case completionMsg:
				completions = append(completions, r)
			}
		}
		if len(records) != 2 {
			t.Fatalf("captured records = %d, want exactly 2 (%s ERROR + %s INFO): %v", len(records), auxMsg, completionMsg, records)
		}
		if len(auxRecords) != 1 || len(completions) != 1 {
			t.Fatalf("want exactly 1 %q ERROR and 1 %q INFO, got %d aux / %d completion: %v", auxMsg, completionMsg, len(auxRecords), len(completions), records)
		}
		aux, completion := auxRecords[0], completions[0]

		// Auxiliary record: exact bounded key set — no error attribute, no
		// path, no DB detail.
		wantAux := map[string]bool{"time": true, "level": true, "msg": true, "code_class": true, "request_id": true}
		for k := range aux {
			if !wantAux[k] {
				t.Errorf("auxiliary record has unbounded key %q (record: %v)", k, aux)
			}
			delete(wantAux, k)
		}
		for k := range wantAux {
			t.Errorf("auxiliary record is missing required key %q (record: %v)", k, aux)
		}
		if got, _ := aux["level"].(string); got != slog.LevelError.String() {
			t.Errorf("aux level = %v, want %q", aux["level"], slog.LevelError.String())
		}
		if got, _ := aux["code_class"].(string); got != string(httpjson.CodeInternalError) {
			t.Errorf("aux code_class = %v, want %q", aux["code_class"], httpjson.CodeInternalError)
		}
		if got, _ := aux["request_id"].(string); got != suppliedID {
			t.Errorf("aux request_id = %v, want supplied header value %q", aux["request_id"], suppliedID)
		}

		// Completion record: bounded route pattern, same request ID, status
		// 500 classified as the canonical catalog code.
		if got, _ := completion["request_id"].(string); got != suppliedID {
			t.Errorf("completion request_id = %v, want %q", completion["request_id"], suppliedID)
		}
		if got, _ := completion["method"].(string); got != http.MethodGet {
			t.Errorf("completion method = %v, want %q", completion["method"], http.MethodGet)
		}
		if got, _ := completion["path"].(string); got != "/industries" {
			t.Errorf("completion path = %v, want matched route pattern %q", completion["path"], "/industries")
		}
		if got, _ := completion["status"].(float64); got != http.StatusInternalServerError {
			t.Errorf("completion status = %v, want %d", completion["status"], http.StatusInternalServerError)
		}
		if got, _ := completion["level"].(string); got != slog.LevelInfo.String() {
			t.Errorf("completion level = %v, want %q", completion["level"], slog.LevelInfo.String())
		}
		if got, _ := completion["code_class"].(string); got != string(httpjson.CodeInternalError) {
			t.Errorf("completion code_class = %v, want %q", completion["code_class"], httpjson.CodeInternalError)
		}

		assertNoIndustriesSensitiveMarker(t, "captured logs", buf.String())
	})

	t.Run("generated_request_id_when_header_absent", func(t *testing.T) {
		buf, rec := runListIndustriesUnexpectedErrorScenario(t, "")
		assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)

		records := decodeIndustriesSlogRecords(t, buf)
		var aux, completion map[string]any
		for _, r := range records {
			switch r["msg"] {
			case auxMsg:
				aux = r
			case completionMsg:
				completion = r
			}
		}
		if len(records) != 2 || aux == nil || completion == nil {
			t.Fatalf("want exactly 2 records (auxiliary ERROR + completion INFO), got %d: %v", len(records), records)
		}

		auxID, _ := aux["request_id"].(string)
		completionID, _ := completion["request_id"].(string)
		if auxID == "" || completionID == "" || auxID != completionID {
			t.Errorf("chi RequestID middleware must generate one nonempty ID shared by both records, got aux=%q completion=%q", auxID, completionID)
		}

		wantAux := map[string]bool{"time": true, "level": true, "msg": true, "code_class": true, "request_id": true}
		for k := range aux {
			if !wantAux[k] {
				t.Errorf("auxiliary record has unbounded key %q (record: %v)", k, aux)
			}
			delete(wantAux, k)
		}
		for k := range wantAux {
			t.Errorf("auxiliary record is missing required key %q (record: %v)", k, aux)
		}
		if got, _ := aux["code_class"].(string); got != string(httpjson.CodeInternalError) {
			t.Errorf("aux code_class = %v, want %q", aux["code_class"], httpjson.CodeInternalError)
		}
		if got, _ := completion["path"].(string); got != "/industries" {
			t.Errorf("completion path = %v, want %q", completion["path"], "/industries")
		}
		if got, _ := completion["status"].(float64); got != http.StatusInternalServerError {
			t.Errorf("completion status = %v, want %d", completion["status"], http.StatusInternalServerError)
		}

		assertNoIndustriesSensitiveMarker(t, "captured logs", buf.String())
	})
}
