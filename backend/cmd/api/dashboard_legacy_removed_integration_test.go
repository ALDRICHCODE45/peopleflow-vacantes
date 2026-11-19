//go:build integration

package main

import (
	"net/http"
	"testing"
)

// d2c (company-dashboard-v2 §7): the legacy GET /v2/me/company/dashboard is
// gone from the production router, so an owner or recruiter gets 404 (not a
// gate answer), while the v2 sections and lists that replaced it still answer.
func TestDashboard_LegacyRouteRemoved(t *testing.T) {
	h := newDraftFlowHarness(t)
	f := newMXFixture(t, h)
	_, recruiter := f.member("recruiter", "Rita")
	for _, tc := range []struct {
		name  string
		token string
	}{{"owner", f.owner.token}, {"recruiter", recruiter.token}, {"anonymous", ""}} {
		t.Run(tc.name, func(t *testing.T) {
			if r := h.do(t, "GET", "/v2/me/company/dashboard", "", tc.token, nil); r.status != http.StatusNotFound {
				t.Fatalf("legacy route: %d %s", r.status, r.body)
			}
		})
	}
	paths := []string{}
	for _, section := range mxDashboardRoutes {
		paths = append(paths, section+"?window=30")
	}
	for _, list := range []string{"candidates", "deliveries", "vacancies", "applications"} {
		paths = append(paths, "lists/"+list+"?window=30")
	}
	for _, actor := range []draftFlowActor{f.owner, recruiter} {
		for _, path := range paths {
			if r := h.do(t, "GET", "/v2/me/company/dashboard/"+path, "", actor.token, nil); r.status != http.StatusOK {
				t.Fatalf("%s: %d %s", path, r.status, r.body)
			}
		}
	}
}
