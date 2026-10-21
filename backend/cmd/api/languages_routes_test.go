package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLanguagesRouteAnonymous(t *testing.T) {
	deny := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("public catalog invoked authentication")
			w.WriteHeader(http.StatusUnauthorized)
		})
	}
	router := newRouter(routerDeps{requireAuth: deny, requireCandidate: deny, requireRecruiter: deny, requireOwner: deny})
	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/v2/catalogs/languages", nil))
	if first.Code != 200 || first.Header().Get("Cache-Control") != "public, max-age=86400" {
		t.Fatalf("anonymous response %d %v", first.Code, first.Header())
	}
	r := httptest.NewRequest(http.MethodGet, "/v2/catalogs/languages", nil)
	r.Header.Set("If-None-Match", first.Header().Get("ETag"))
	cached := httptest.NewRecorder()
	router.ServeHTTP(cached, r)
	if cached.Code != 304 || cached.Body.Len() != 0 || cached.Header().Get("Cache-Control") != "public, max-age=86400" {
		t.Fatalf("conditional response %d %v", cached.Code, cached.Header())
	}
}
