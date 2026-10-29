package main

import (
	"context"
	"errors"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/profile"
	profilehttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

type profileRouteStore struct {
	result profile.Result
	err    error
	gets   []routeGetCall
	puts   []routeSaveCall
}

func (s *profileRouteStore) GetProfile(_ context.Context, c, a, id uuid.UUID) (profile.Result, error) {
	s.gets = append(s.gets, routeGetCall{companyID: c, actorID: a, id: id})
	return s.result, s.err
}
func (s *profileRouteStore) PutProfile(_ context.Context, c, a, id uuid.UUID, tag string, present bool, body []byte) (profile.Result, error) {
	s.puts = append(s.puts, routeSaveCall{companyID: c, actorID: a, id: id, ifMatch: tag, present: present, body: body})
	return s.result, s.err
}
func TestPsychometricProfileRoutes(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/psychometric-profile"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"tag"`}
	for _, tc := range []struct {
		name, method string
		headers      map[string]string
		err          error
		status       int
		code         string
	}{
		{"get", "GET", auth, nil, 200, ""}, {"put", "PUT", auth, nil, 200, ""}, {"anonymous", "GET", nil, nil, 401, "unauthenticated"}, {"role", "PUT", map[string]string{"X-Test-Sub": "sub"}, nil, 403, "forbidden"}, {"membership", "GET", auth, drafts.ErrForbidden, 403, "forbidden"}, {"foreign", "GET", auth, drafts.ErrNotFound, 404, "not_found"}, {"missing tag", "PUT", auth, drafts.ErrPreconditionRequired, 428, "precondition_required"}, {"stale", "PUT", auth, drafts.ErrVersionConflict, 412, "version_conflict"}, {"malformed", "PUT", auth, drafts.ErrInvalidRequest, 400, "invalid_request"}, {"validation", "PUT", auth, &profile.Invalid{Fields: []httpjson.ValidationField{{Field: "test", Code: "invalid"}}}, 400, "validation_error"}, {"internal", "GET", auth, errors.New("private"), 500, "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &profileRouteStore{result: profile.Result{Body: []byte(`{"version":"0"}`), ETag: `"tag"`}, err: tc.err}
			router := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), psychometricProfileHandler: profilehttp.NewHandler(s, writeProfileContextError)})
			r := doRouteRequest(t, router, tc.method, path, `{}`, tc.headers)
			assertDraftRouteNoStore(t, r)
			if r.Code != tc.status {
				t.Fatalf("%d %s", r.Code, r.Body.String())
			}
			if tc.code != "" {
				if routeCatalogCode(t, r) != tc.code || r.Header().Get("ETag") != "" {
					t.Fatal(r.Body.String())
				}
				return
			}
			if r.Body.String() != string(s.result.Body) || r.Header().Get("ETag") != s.result.ETag {
				t.Fatal(r.Body.String())
			}
			if tc.method == "GET" {
				if len(s.gets) != 1 || s.gets[0] != (routeGetCall{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID}) {
					t.Fatal(s.gets)
				}
			} else {
				if len(s.puts) != 1 || s.puts[0].companyID != routeTestCompanyID || s.puts[0].actorID != routeTestActorID || s.puts[0].id != routeTestDraftID || s.puts[0].ifMatch != `"tag"` || !s.puts[0].present || string(s.puts[0].body) != `{}` {
					t.Fatal(s.puts)
				}
			}
		})
	}
}
