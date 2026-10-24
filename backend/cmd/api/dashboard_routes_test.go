package main

import (
	"context"
	"encoding/json"
	"errors"
	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dashboard"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
	"testing"
	"time"
)

type dashboardReader struct {
	calls int
	err   error
}

func (f *dashboardReader) Dashboard(context.Context, uuid.UUID, uuid.UUID) (app.Dashboard, error) {
	f.calls++
	return app.Dashboard{}, f.err
}
func TestDashboardRoute(t *testing.T) {
	for _, tc := range []struct {
		name    string
		headers map[string]string
		status  int
		code    string
	}{
		{"anonymous", nil, 401, "unauthenticated"},
		{"non member", map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
		{"recruiter", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}, 200, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &dashboardReader{}
			router := newRouter(routerDeps{dashboardHandler: jobshttp.NewDashboardHandler(app.NewService(reader, time.Now)), requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companies.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companies.OwnerRole, routeTestOwnerHeader)})
			w := doRouteRequest(t, router, "GET", "/v2/me/company/dashboard", "", tc.headers)
			assertDraftRouteNoStore(t, w)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if tc.code != "" {
				if routeCatalogCode(t, w) != tc.code || reader.calls != 0 {
					t.Fatal(w.Body.String())
				}
				return
			}
			var got app.Dashboard
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			var shape map[string]json.RawMessage
			_ = json.Unmarshal(w.Body.Bytes(), &shape)
			if len(shape) != 6 || len(got.OriginByDay) != 90 || got.Recent == nil || reader.calls != 1 {
				t.Fatal(w.Body.String())
			}
			reader.err = errors.New("PRIVATE database")
			w = doRouteRequest(t, router, "GET", "/v2/me/company/dashboard", "", tc.headers)
			if w.Code != 500 || routeCatalogCode(t, w) != "internal_error" {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}
