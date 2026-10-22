package main

import (
	"context"
	"testing"

	pool "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
)

// This seam proves organic requests reach their own writer, never the manual one.
// Real validation and persistence are covered below and in the DB HTTP flow.
type organicDispatchReader struct {
	orgDetailReader
	called bool
}

func (s *organicDispatchReader) EditOrganic(ctx context.Context, c, a, id uuid.UUID, tag string, body []byte) (pool.Detail, error) {
	s.called = true
	return s.Detail(ctx, c, "organic", id)
}
func TestOrgCandidateCorrectionsGatesHTTP(t *testing.T) {
	for _, method := range []string{"PATCH", "GET"} {
		suffix := ""
		if method == "GET" {
			suffix = "/history"
		}
		for _, tc := range []struct {
			name    string
			headers map[string]string
			status  int
			code    string
		}{
			{"anonymous", nil, 401, "unauthenticated"},
			{"candidate", map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
		} {
			t.Run(method+"/"+tc.name, func(t *testing.T) {
				s := &organicDispatchReader{}
				w := doRouteRequest(t, orgCandidatesRouter(s), method, orgCandidatesPath+"/organic/"+routeTestDraftID.String()+suffix, `{"set":{"phone":null}}`, tc.headers)
				assertDraftRouteNoStore(t, w)
				if w.Code != tc.status || routeCatalogCode(t, w) != tc.code || s.called {
					t.Fatal(w.Code, w.Body.String())
				}
			})
		}
	}
}

func TestOrgCandidateCorrectionsDispatchHTTP(t *testing.T) {
	s := &organicDispatchReader{}
	w := doRouteRequest(t, orgCandidatesRouter(s), "PATCH", orgCandidatesPath+"/organic/"+routeTestDraftID.String(), `{"set":{"professional_title":"Engineer"}}`, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"test"`})
	assertDraftRouteNoStore(t, w)
	if w.Code != 200 || !s.called {
		t.Fatalf("organic writer not reached: %d %s", w.Code, w.Body.String())
	}
}
