package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type publicReaderStub struct {
	rows  []publicjobs.Row
	err   error
	calls int
}

func (s *publicReaderStub) Search(context.Context, publicjobs.Query) ([]publicjobs.Row, error) {
	s.calls++
	return s.rows, s.err
}
func (s *publicReaderStub) Get(_ context.Context, id uuid.UUID) (publicjobs.Detail, error) {
	s.calls++
	if s.err != nil {
		return publicjobs.Detail{}, s.err
	}
	if len(s.rows) == 0 || s.rows[0].Detail.ID != id {
		return publicjobs.Detail{}, publicjobs.ErrNotFound
	}
	return s.rows[0].Detail, nil
}

func TestPublicJobsHTTPStrictAnonymousAndCacheHeaders(t *testing.T) {
	id := uuid.New()
	stub := &publicReaderStub{rows: []publicjobs.Row{{Detail: publicjobs.Detail{Item: publicjobs.Item{ID: id, Source: "vacancy", Title: "Go", PublishedAt: time.Now().UTC()}, Benefits: publicjobs.Benefits{Predefined: []string{}, Custom: []string{}}}}}}
	r := chi.NewRouter()
	h := NewPublicJobsHandler(publicjobs.NewCatalog(stub))
	r.Get("/v2/jobs", h.List)
	r.Get("/v2/jobs/{id}", h.Get)
	for _, tc := range []struct {
		name, path string
		status     int
		code       string
	}{
		{"list", "/v2/jobs", 200, ""}, {"detail", "/v2/jobs/" + id.String(), 200, ""},
		{"unknown param", "/v2/jobs?seniority=senior", 400, "invalid_request"},
		{"duplicate", "/v2/jobs?limit=1&limit=2", 400, "invalid_request"},
		{"invalid enum", "/v2/jobs?contract_type=contract", 400, "invalid_request"},
		{"bad cursor", "/v2/jobs?cursor=bad", 400, "invalid_request"},
		{"missing", "/v2/jobs/" + uuid.NewString(), 404, "not_found"},
		{"malformed id", "/v2/jobs/bad", 404, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := stub.calls
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "" {
				t.Fatal("private cache headers")
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if tc.code != "" && (len(body) != 2 || body["code"] != tc.code) {
				t.Fatalf("error=%s", w.Body.String())
			}
			if tc.status == 400 && stub.calls != before {
				t.Fatal("invalid request reached reader")
			}
			if tc.name == "list" {
				if len(body) != 2 || body["next_cursor"] != nil {
					t.Fatal("list envelope")
				}
				item := body["items"].([]any)[0].(map[string]any)
				if len(item) != 14 {
					t.Fatalf("list keys=%v", item)
				}
			}
			if tc.name == "detail" && len(body) != 18 {
				t.Fatalf("detail keys=%v", body)
			}
		})
	}
	stub.err = errors.New("database failure with sensitive context")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/jobs", nil))
	if w.Code != 500 || w.Body.String() == stub.err.Error() {
		t.Fatal("internal error leaked")
	}
}
