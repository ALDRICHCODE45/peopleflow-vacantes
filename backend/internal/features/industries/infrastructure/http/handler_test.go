package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
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
