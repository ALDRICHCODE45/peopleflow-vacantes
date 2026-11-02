package http

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/savedjobs"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type savedFake struct {
	writes, reads int
	err           error
	created       bool
	subject       string
	id            uuid.UUID
}

var savedTestID = uuid.MustParse("11111111-1111-4111-8111-111111111111")
var savedTestTime = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

func (f *savedFake) Save(_ context.Context, sub string, id uuid.UUID) (app.Saved, bool, error) {
	f.writes++
	f.subject = sub
	f.id = id
	return app.Saved{JobID: id, SavedAt: savedTestTime}, f.created, f.err
}
func (f *savedFake) Remove(_ context.Context, sub string, id uuid.UUID) error {
	f.writes++
	f.subject = sub
	f.id = id
	return f.err
}
func (f *savedFake) RemoveClosed(_ context.Context, sub string) (int, error) {
	f.writes++
	f.subject = sub
	return 3, f.err
}
func (f *savedFake) List(_ context.Context, sub string) (app.Page, error) {
	f.reads++
	f.subject = sub
	return app.Page{Items: []app.Item{}, Total: 0, Limit: 200}, f.err
}
func (f *savedFake) IDs(_ context.Context, sub string) ([]uuid.UUID, error) {
	f.reads++
	f.subject = sub
	return []uuid.UUID{savedTestID}, f.err
}
func savedRouter(f *savedFake) http.Handler {
	h := NewSavedJobsHandler(f)
	r := chi.NewRouter()
	r.Put("/saved/{jobId}", h.Save)
	r.Delete("/saved/{jobId}", h.Remove)
	r.Delete("/saved", h.RemoveClosed)
	r.Get("/saved", h.List)
	r.Get("/saved/ids", h.IDs)
	return r
}
func TestSavedJobsHTTP(t *testing.T) {
	for _, tc := range []struct {
		name, method, path string
		created            bool
		err                error
		status             int
		body               string
		writes, reads      int
	}{
		{"created", "PUT", "/saved/" + savedTestID.String(), true, nil, 201, `{"job_id":"11111111-1111-4111-8111-111111111111","saved_at":"2026-01-02T03:04:05Z"}` + "\n", 1, 0},
		{"replay", "PUT", "/saved/" + savedTestID.String(), false, nil, 200, `{"job_id":"11111111-1111-4111-8111-111111111111","saved_at":"2026-01-02T03:04:05Z"}` + "\n", 1, 0},
		{"not found", "PUT", "/saved/" + savedTestID.String(), false, app.ErrNotFound, 404, `{"error":"not found","code":"not_found"}` + "\n", 1, 0},
		{"unavailable", "PUT", "/saved/" + savedTestID.String(), false, app.ErrUnavailable, 409, `{"error":"job unavailable","code":"job_unavailable"}` + "\n", 1, 0},
		{"limit", "PUT", "/saved/" + savedTestID.String(), false, app.ErrLimit, 409, `{"error":"saved jobs limit reached","code":"saved_jobs_limit","data":{"limit":200}}` + "\n", 1, 0},
		{"internal", "PUT", "/saved/" + savedTestID.String(), false, errors.New("private SQL"), 500, `{"error":"an internal error occurred","code":"internal_error"}` + "\n", 1, 0},
		{"remove", "DELETE", "/saved/" + savedTestID.String(), false, nil, 204, "", 1, 0},
		{"bulk", "DELETE", "/saved?availability=closed", false, nil, 200, `{"removed":3}` + "\n", 1, 0},
		{"list", "GET", "/saved", false, nil, 200, `{"items":[],"total":0,"limit":200}` + "\n", 0, 1},
		{"ids", "GET", "/saved/ids", false, nil, 200, `{"job_ids":["11111111-1111-4111-8111-111111111111"]}` + "\n", 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &savedFake{err: tc.err, created: tc.created}
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req = req.WithContext(security.ContextWithClaims(req.Context(), security.Claims{Subject: "candidate-sub"}))
			w := httptest.NewRecorder()
			savedRouter(f).ServeHTTP(w, req)
			if w.Code != tc.status || w.Body.String() != tc.body || w.Header().Get("Cache-Control") != "no-store" || f.writes != tc.writes || f.reads != tc.reads || f.subject != "candidate-sub" {
				t.Fatalf("%d %q writes=%d reads=%d subject=%s", w.Code, w.Body.String(), f.writes, f.reads, f.subject)
			}
			if (tc.method == "PUT" || tc.name == "remove") && f.id != savedTestID {
				t.Fatal(f.id)
			}
		})
	}
}
func TestSavedJobsRejectedTransportNeverWrites(t *testing.T) {
	for _, method := range []string{"PUT", "DELETE"} {
		for _, id := range []string{"bad", "11111111111141118111111111111111", "urn:uuid:11111111-1111-4111-8111-111111111111"} {
			t.Run(method+id, func(t *testing.T) {
				f := &savedFake{}
				w := httptest.NewRecorder()
				savedRouter(f).ServeHTTP(w, httptest.NewRequest(method, "/saved/"+id, nil))
				if w.Code != 404 || w.Body.String() != `{"error":"not found","code":"not_found"}`+"\n" || f.writes != 0 || f.reads != 0 || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal(w.Code, w.Body.String(), f)
				}
			})
		}
	}
	for _, query := range []string{"", "?availability=open", "?availability=closed&availability=closed", "?availability=closed&extra=x", "?other=closed", "?availability=", "?availability=closed;extra=x", "?availability=%zz"} {
		t.Run(query, func(t *testing.T) {
			f := &savedFake{}
			w := httptest.NewRecorder()
			savedRouter(f).ServeHTTP(w, httptest.NewRequest("DELETE", "/saved"+query, nil))
			if w.Code != 400 || w.Body.String() != `{"error":"validation failed","code":"validation_error","fields":[{"field":"availability","code":"invalid"}]}`+"\n" || f.writes != 0 || f.reads != 0 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(w.Code, w.Body.String(), f)
			}
		})
	}
}
