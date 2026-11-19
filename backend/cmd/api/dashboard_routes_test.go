package main

import (
	"testing"

	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
)

// d2c (company-dashboard-v2 §7): the legacy GET /v2/me/company/dashboard is
// not registered anymore, so the router answers 404 for every caller, before
// any gate. The v2 sections are pinned by TestRouteTopology_ExactRegistrations
// and exercised end to end by TestDashboard_LegacyRouteRemoved (integration).
func TestDashboardRoute_LegacyRemoved(t *testing.T) {
	router := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companies.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companies.OwnerRole, routeTestOwnerHeader)})
	for _, tc := range []struct {
		name    string
		headers map[string]string
	}{
		{"anonymous", nil},
		{"owner", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestOwnerHeader}},
		{"recruiter", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if w := doRouteRequest(t, router, "GET", "/v2/me/company/dashboard", "", tc.headers); w.Code != 404 {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
}
