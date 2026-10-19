package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type managementRouteStore struct {
	result drafts.Result
	err    error
	gets   []routeGetCall
	puts   []routeSaveCall
}

func (s *managementRouteStore) GetManagement(_ context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	s.gets = append(s.gets, routeGetCall{companyID: companyID, actorID: actorID, id: id})
	return s.result, s.err
}
func (s *managementRouteStore) PutManagement(_ context.Context, companyID, actorID, id uuid.UUID, tag string, present bool, body []byte) (drafts.Result, error) {
	s.puts = append(s.puts, routeSaveCall{companyID: companyID, actorID: actorID, id: id, ifMatch: tag, present: present, body: body})
	return s.result, s.err
}
func managementRoutesRouter(s *managementRouteStore) http.Handler {
	return newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), managementHandler: jobshttp.NewManagementHandler(s)})
}
func TestManagementRoutesAnonymousNoStore(t *testing.T) {
	for _, method := range []string{"GET", "PUT"} {
		t.Run(method, func(t *testing.T) {
			r := doRouteRequest(t, managementRoutesRouter(&managementRouteStore{}), method, "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/management", "{}", nil)
			if r.Code != 401 {
				t.Fatalf("status=%d body=%s want 401", r.Code, r.Body.String())
			}
			assertDraftRouteNoStore(t, r)
		})
	}
}
func TestManagementRoutesContractEveryStatus(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/management"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, tc := range []struct {
		name, method, body string
		err                error
		status             int
		code               string
	}{
		{"get", "GET", "", nil, 200, ""}, {"put", "PUT", `{"requestDate":null,"hiringHeadcount":null}`, nil, 200, ""},
		{"invalid", "PUT", `{}`, drafts.ErrInvalidRequest, 400, "invalid_request"}, {"validation", "PUT", `{}`, drafts.ErrValidation, 400, "validation_error"}, {"notfound", "GET", "", drafts.ErrNotFound, 404, "not_found"},
		{"unauthenticated", "GET", "", drafts.ErrUnauthenticated, 401, "unauthenticated"}, {"forbidden", "GET", "", drafts.ErrForbidden, 403, "forbidden"}, {"inactive", "GET", "", drafts.ErrCompanyInactive, 403, "company_inactive"}, {"notactive", "GET", "", drafts.ErrCompanyNotActive, 409, "company_not_active"},
		{"conflict", "PUT", `{}`, drafts.ErrVersionConflict, 412, "version_conflict"}, {"required", "PUT", `{}`, drafts.ErrPreconditionRequired, 428, "precondition_required"}, {"oversize", "PUT", strings.Repeat("x", 1048577), nil, 413, "payload_too_large"}, {"internal", "GET", "", errors.New("private"), 500, "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := drafts.Result{Body: []byte(`{"version":"0","requestDate":null,"hiringHeadcount":null,"limits":{"maxHiringHeadcount":999},"today":"2026-10-16"}`), ETag: `"opaque"`}
			s := &managementRouteStore{result: result, err: tc.err}
			r := doRouteRequest(t, managementRoutesRouter(s), tc.method, path, tc.body, auth)
			assertDraftRouteNoStore(t, r)
			if r.Code != tc.status || r.Header().Get("Idempotency-Replayed") != "" {
				t.Fatalf("%d %s", r.Code, r.Body.String())
			}
			if tc.code == "" {
				if r.Body.String() != string(result.Body) || r.Header().Get("ETag") != result.ETag {
					t.Fatalf("%v %s", r.Header(), r.Body.String())
				}
			} else {
				var obj map[string]any
				_ = json.Unmarshal(r.Body.Bytes(), &obj)
				if len(obj) != 2 || obj["error"] == "" || obj["code"] != tc.code || r.Header().Get("ETag") != "" {
					t.Fatalf("%v %s", r.Header(), r.Body.String())
				}
			}
		})
	}
}
func TestManagementRoutesForwardIdentityAndIfMatchLines(t *testing.T) {
	s := &managementRouteStore{result: drafts.Result{Body: []byte(`{}`), ETag: `"tag"`}}
	body := `{"requestDate":null,"hiringHeadcount":null}`
	req := httptest.NewRequest("PUT", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/management", strings.NewReader(body))
	req.Header.Set("X-Test-Sub", "sub")
	req.Header.Set("X-Test-Role", routeTestRecruiterHeader)
	req.Header.Set("X-Company-Id", uuid.NewString())
	req.Header.Add("If-Match", `"first"`)
	req.Header.Add("If-Match", `"second"`)
	r := httptest.NewRecorder()
	managementRoutesRouter(s).ServeHTTP(r, req)
	want := routeSaveCall{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID, ifMatch: `"first","second"`, present: true, body: []byte(body)}
	if r.Code != 200 || len(s.puts) != 1 || !reflect.DeepEqual(s.puts[0], want) {
		t.Fatalf("%d %+v", r.Code, s.puts)
	}
}
