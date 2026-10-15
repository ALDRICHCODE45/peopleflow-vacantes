package main

import (
	"context"
	"net/http"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/requesters"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	runtimemetrics "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics"
	"github.com/google/uuid"
)

// routeRequesterStore records the session identity each route forwards.
type routeRequesterStore struct {
	calls     int
	companyID uuid.UUID
	actorID   uuid.UUID
}

func (s *routeRequesterStore) CreateRequester(_ context.Context, companyID, actorID uuid.UUID, kind string, name valueobjects.RequesterName) (requesters.Entry, error) {
	s.calls++
	s.companyID, s.actorID = companyID, actorID
	return requesters.Entry{ID: routeTestDraftID, Kind: kind, Name: name.Value()}, nil
}

func (s *routeRequesterStore) ListRequesters(_ context.Context, companyID, actorID uuid.UUID, _ requesters.ListRequest) (requesters.Page, error) {
	s.calls++
	s.companyID, s.actorID = companyID, actorID
	return requesters.Page{Items: []requesters.Entry{}}, nil
}

func newRequesterRoutesTestRouter(store requesters.Store) http.Handler {
	return newRouter(routerDeps{
		requireAuth:      routeRequireAuth,
		requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader),
		requireOwner:     routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader),
		requesterHandler: jobshttp.NewRequesterHandler(store),
		httpMetrics:      runtimemetrics.Default,
	})
}

// The catalog is private: no-store applies before the auth and recruiter
// gates, so even their rejections are uncacheable, and the session identity
// (never a body or query value) reaches the store.
func TestRequesterRoutes_GatesNoStoreAndIdentity(t *testing.T) {
	const path = "/me/company/requesters"
	authorized := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	cases := []struct {
		name    string
		method  string
		target  string
		body    string
		headers map[string]string
		status  int
		code    string
	}{
		{"list unauthenticated", http.MethodGet, path + "?kind=client", "", nil, http.StatusUnauthorized, "unauthenticated"},
		{"create unauthenticated", http.MethodPost, path, `{"kind":"client","name":"Acme"}`, nil, http.StatusUnauthorized, "unauthenticated"},
		{"list without role", http.MethodGet, path + "?kind=client", "", map[string]string{"X-Test-Sub": "sub"}, http.StatusForbidden, "forbidden"},
		{"create without role", http.MethodPost, path, `{"kind":"client","name":"Acme"}`, map[string]string{"X-Test-Sub": "sub"}, http.StatusForbidden, "forbidden"},
		{"list ok", http.MethodGet, path + "?kind=client", "", authorized, http.StatusOK, ""},
		{"create ok", http.MethodPost, path, `{"kind":"client","name":"Acme"}`, authorized, http.StatusCreated, ""},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			store := &routeRequesterStore{}
			rec := doRouteRequest(t, newRequesterRoutesTestRouter(store), tt.method, tt.target, tt.body, tt.headers)
			assertDraftRouteNoStore(t, rec)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.status, rec.Body)
			}
			if tt.code != "" {
				if got := routeCatalogCode(t, rec); got != tt.code {
					t.Fatalf("code = %q, want %q", got, tt.code)
				}
				if store.calls != 0 {
					t.Fatalf("gated request reached the store")
				}
				return
			}
			if store.calls != 1 || store.companyID != routeTestCompanyID || store.actorID != routeTestActorID {
				t.Fatalf("store identity = %v/%v (%d calls), want session %v/%v", store.companyID, store.actorID, store.calls, routeTestCompanyID, routeTestActorID)
			}
		})
	}
}
