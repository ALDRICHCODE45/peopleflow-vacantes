package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type publicRouteReader struct{}

func (publicRouteReader) Search(context.Context, publicjobs.Query) ([]publicjobs.Row, error) {
	return []publicjobs.Row{}, nil
}
func (publicRouteReader) Get(context.Context, uuid.UUID) (publicjobs.Detail, error) {
	return publicjobs.Detail{}, publicjobs.ErrNotFound
}
func TestPublicJobsInvalidFilterBytesUnchanged(t *testing.T) {
	r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth, publicJobsHandler: jobshttp.NewPublicJobsHandler(publicjobs.NewCatalog(publicRouteReader{}))})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v2/jobs?seniority=not-a-level", nil))
	if w.Code != 400 || w.Body.String() != `{"error":"invalid filter","code":"invalid_filter"}`+"\n" || w.Header().Get("Cache-Control") != "" {
		t.Fatal(w.Code, w.Body.String(), w.Header())
	}
}

func TestPublicJobsRoutesAnonymousWithoutPrivateHeaders(t *testing.T) {
	r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth, publicJobsHandler: jobshttp.NewPublicJobsHandler(publicjobs.NewCatalog(publicRouteReader{}))})
	for _, tc := range []struct {
		path   string
		status int
	}{{"/v2/jobs", 200}, {"/v2/jobs?unexpected=true", 400}, {"/v2/jobs/" + uuid.NewString(), 404}} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != tc.status || w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "" {
			t.Fatalf("%s: %d %s %v", tc.path, w.Code, w.Body.String(), w.Header())
		}
	}
}
