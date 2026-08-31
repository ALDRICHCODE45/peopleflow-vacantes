package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
