package main

import (
	"testing"
)

func TestOrgCandidateEditsRoutes(t *testing.T) {
	path := orgCandidatesPath + "/manual/" + routeTestDraftID.String()
	recruiter := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, tc := range []struct {
		name, method, suffix, body string
		headers                    map[string]string
		status                     int
		code                       string
	}{
		{"patch anonymous", "PATCH", "", `{}`, nil, 401, "unauthenticated"},
		{"patch candidate", "PATCH", "", `{}`, map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
		{"history anonymous", "GET", "/history", "", nil, 401, "unauthenticated"},
		{"history candidate", "GET", "/history", "", map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
		{"missing precondition", "PATCH", "", `{"set":{"full_name":"New Candidate"}}`, recruiter, 428, "precondition_required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := doRouteRequest(t, orgCandidatesRouter(&orgDetailReader{}), tc.method, path+tc.suffix, tc.body, tc.headers)
			assertDraftRouteNoStore(t, w)
			if w.Code != tc.status || routeCatalogCode(t, w) != tc.code {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
		})
	}
}
