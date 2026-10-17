package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
)

func TestP2bPrivateRoutesLiveCandidateGates(t *testing.T) {
	r := newRouter(routerDeps{requireAuth: identityhttp.RequireAuth(identityRouteVerifier{}), requireCandidate: identityhttp.RequireCandidateRole(identityRouteUsers{}), requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth})
	for _, route := range []struct{ method, path string }{
		{"GET", "/v2/me/cvs"}, {"POST", "/v2/me/cvs"}, {"PATCH", "/v2/me/cvs/not-an-id"}, {"DELETE", "/v2/me/cvs/not-an-id"}, {"GET", "/v2/me/cvs/not-an-id/file"}, {"POST", "/v2/jobs/not-an-id/applications"}, {"GET", "/v2/me/applications"},
	} {
		for _, actor := range []struct {
			token, code string
			status      int
		}{{"", "unauthenticated", 401}, {"recruiter", "wrong_role", 403}, {"unknown", "account_required", 403}} {
			t.Run(route.method+route.path+actor.code, func(t *testing.T) {
				req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
				if actor.token != "" {
					req.Header.Set("Authorization", "Bearer "+actor.token)
				}
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				var body map[string]any
				json.Unmarshal(w.Body.Bytes(), &body)
				if w.Code != actor.status || body["code"] != actor.code || len(body) != 2 || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("%d %s %v", w.Code, w.Body.String(), w.Header())
				}
			})
		}
	}
}
func TestP2bScreeningIsPublic(t *testing.T) {
	r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth, publicJobsHandler: jobshttp.NewPublicJobsHandler(publicjobs.NewCatalog(publicRouteReader{}))})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/jobs/11111111-1111-4111-8111-111111111111/screening", nil))
	var body map[string]any
	json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 404 || body["code"] != "not_found" || w.Header().Get("Cache-Control") != "" {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
