package main

import (
	"context"
	"net/http/httptest"
	"testing"

	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/savedjobs"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type savedRouteStore struct {
	app.Store
	calls   int
	subject string
}

func (s *savedRouteStore) IDs(_ context.Context, sub string) ([]uuid.UUID, error) {
	s.calls++
	s.subject = sub
	return []uuid.UUID{}, nil
}
func TestSavedJobsStaticIDsRoute(t *testing.T) {
	store := &savedRouteStore{}
	r := newRouter(routerDeps{requireAuth: identityhttp.RequireAuth(identityRouteVerifier{}), requireCandidate: identityhttp.RequireCandidateRole(identityRouteUsers{}), requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth, savedJobsHandler: jobshttp.NewSavedJobsHandler(store)})
	req := httptest.NewRequest("GET", "/v2/me/saved-jobs/ids", nil)
	req.Header.Set("Authorization", "Bearer candidate")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 || w.Body.String() != `{"job_ids":[]}`+"\n" || w.Header().Get("Cache-Control") != "no-store" || store.calls != 1 || store.subject == "" {
		t.Fatal(w.Code, w.Body.String(), store)
	}
}
