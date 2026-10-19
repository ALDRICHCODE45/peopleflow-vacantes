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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type deliveryRouteStore struct {
	result drafts.Result
	err    error
	gets   []routeGetCall
	puts   []routeSaveCall
}

func (s *deliveryRouteStore) GetDelivery(_ context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	s.gets = append(s.gets, routeGetCall{companyID: companyID, actorID: actorID, id: id})
	return s.result, s.err
}
func (s *deliveryRouteStore) PutDelivery(_ context.Context, companyID, actorID, id uuid.UUID, tag string, present bool, body []byte) (drafts.Result, error) {
	s.puts = append(s.puts, routeSaveCall{companyID: companyID, actorID: actorID, id: id, ifMatch: tag, present: present, body: body})
	return s.result, s.err
}
func deliveryRoutesRouter(s *deliveryRouteStore) http.Handler {
	return newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), deliveryHandler: jobshttp.NewDeliveryHandler(s)})
}
func TestDeliveryRoutes_AnonymousNoStore(t *testing.T) {
	response := doRouteRequest(t, deliveryRoutesRouter(&deliveryRouteStore{}), "GET", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/pipeline/delivery", "", nil)
	if response.Code != 401 {
		t.Fatalf("status=%d body=%s want 401", response.Code, response.Body.String())
	}
	assertDraftRouteNoStore(t, response)
}
func TestDeliveryRoutes_ContractAndNoStoreOnEveryStatus(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline/delivery"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"opaque"`}
	cases := []struct {
		name, method, path, body string
		headers                  map[string]string
		err                      error
		status                   int
		code                     string
		calls                    int
	}{
		{"get 200", "GET", path, "", auth, nil, 200, "", 1},
		{"put 200", "PUT", path, `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":null}`, auth, nil, 200, "", 1},
		{"401", "GET", path, "", nil, nil, 401, "unauthenticated", 0},
		{"403", "PUT", path, `{}`, map[string]string{"X-Test-Sub": "sub"}, nil, 403, "forbidden", 0},
		{"bad path", "GET", "/v2/me/company/job-drafts/bad/pipeline/delivery", "", auth, nil, 400, "invalid_request", 0},
		{"invalid request", "PUT", path, `{}`, auth, drafts.ErrInvalidRequest, 400, "invalid_request", 1},
		{"validation", "PUT", path, `{}`, auth, drafts.ErrValidation, 400, "validation_error", 1},
		{"non-business date", "PUT", path, `{}`, auth, deliveryconfig.ErrNonBusinessDate, 400, "non_business_date", 1},
		{"wrapped non-business", "PUT", path, `{}`, auth, errors.Join(errors.New("private"), deliveryconfig.ErrNonBusinessDate), 400, "non_business_date", 1},
		{"live user", "GET", path, "", auth, drafts.ErrUnauthenticated, 401, "unauthenticated", 1},
		{"membership", "PUT", path, `{}`, auth, drafts.ErrForbidden, 403, "forbidden", 1},
		{"inactive company", "GET", path, "", auth, drafts.ErrCompanyInactive, 403, "company_inactive", 1},
		{"not active company", "PUT", path, `{}`, auth, drafts.ErrCompanyNotActive, 409, "company_not_active", 1},
		{"missing foreign nonprincipal", "GET", path, "", auth, drafts.ErrNotFound, 404, "not_found", 1},
		{"stale foreign tag", "PUT", path, `{}`, auth, drafts.ErrVersionConflict, 412, "version_conflict", 1},
		{"payload budget", "PUT", path, strings.Repeat("x", 1048577), auth, nil, 413, "payload_too_large", 0},
		{"precondition", "PUT", path, `{}`, auth, drafts.ErrPreconditionRequired, 428, "precondition_required", 1},
		{"unexpected", "GET", path, "", auth, errors.New("private detail"), 500, "internal_error", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := drafts.Result{Body: []byte(`{"fulfilled":false,"version":"0","cutoffStageId":null,"targetQuantity":null,"commitmentDate":null,"limits":{"maxTargetQuantity":999},"calendar":{"timeZone":"America/Mexico_City","today":"2026-10-16","minDate":"2026-10-16","maxDate":"2027-10-16","nonBusinessDates":[]}}`), ETag: `"delivery-opaque"`}
			s := &deliveryRouteStore{result: result, err: tc.err}
			r := doRouteRequest(t, deliveryRoutesRouter(s), tc.method, tc.path, tc.body, tc.headers)
			if r.Code != tc.status {
				t.Fatalf("status=%d body=%s want=%d", r.Code, r.Body.String(), tc.status)
			}
			assertDraftRouteNoStore(t, r)
			if len(s.gets)+len(s.puts) != tc.calls {
				t.Fatalf("calls gets=%d puts=%d want=%d", len(s.gets), len(s.puts), tc.calls)
			}
			if tc.code == "" {
				if r.Body.String() != string(result.Body) || r.Header().Get("ETag") != result.ETag || r.Header().Get("Idempotency-Replayed") != "" {
					t.Fatalf("success=%v %s", r.Header(), r.Body.String())
				}
			} else {
				var obj map[string]any
				if err := json.Unmarshal(r.Body.Bytes(), &obj); err != nil || len(obj) != 2 || obj["error"] == "" || obj["code"] != tc.code || r.Header().Get("ETag") != "" {
					t.Fatalf("error=%v %s", r.Header(), r.Body.String())
				}
			}
		})
	}
}
func TestDeliveryRoutes_ForwardIdentityAndAllIfMatchLines(t *testing.T) {
	s := &deliveryRouteStore{result: drafts.Result{Body: []byte(`{}`), ETag: `"tag"`}}
	router := deliveryRoutesRouter(s)
	body := `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":null}`
	req := httptest.NewRequest("PUT", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/pipeline/delivery", strings.NewReader(body))
	req.Header.Set("X-Test-Sub", "sub")
	req.Header.Set("X-Test-Role", routeTestRecruiterHeader)
	req.Header.Set("X-Company-Id", uuid.NewString())
	req.Header.Set("X-Actor-Id", uuid.NewString())
	req.Header.Add("If-Match", `"first"`)
	req.Header.Add("If-Match", `"second"`)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	want := routeSaveCall{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID, ifMatch: `"first","second"`, present: true, body: []byte(body)}
	if rec.Code != 200 || len(s.puts) != 1 || !reflect.DeepEqual(s.puts[0], want) {
		t.Fatalf("status=%d puts=%+v want=%+v", rec.Code, s.puts, want)
	}
	get := doRouteRequest(t, router, "GET", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/pipeline/delivery", "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader})
	if get.Code != 200 || len(s.gets) != 1 || s.gets[0] != (routeGetCall{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID}) {
		t.Fatalf("get identity=%+v status=%d", s.gets, get.Code)
	}
}
func TestDeliveryRoutes_PipelineCutoffConflict(t *testing.T) {
	s := &pipelineRouteStore{err: errors.Join(errors.New("private"), pipelineconfig.ErrCutoffStageInUse)}
	r := doRouteRequest(t, pipelineRoutesRouter(s), "PUT", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/pipeline", `{}`, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"tag"`})
	assertDraftRouteNoStore(t, r)
	var obj map[string]any
	if err := json.Unmarshal(r.Body.Bytes(), &obj); err != nil || r.Code != 409 || len(obj) != 2 || obj["code"] != "cutoff_stage_in_use" || obj["error"] == "" || r.Header().Get("ETag") != "" {
		t.Fatalf("conflict=%d %s", r.Code, r.Body.String())
	}
}
