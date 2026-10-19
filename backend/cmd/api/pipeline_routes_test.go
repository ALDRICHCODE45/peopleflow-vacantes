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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type pipelineRouteStore struct {
	result drafts.Result
	err    error
	gets   []routeGetCall
	puts   []routeSaveCall
}

func (s *pipelineRouteStore) GetPipeline(_ context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	s.gets = append(s.gets, routeGetCall{companyID: companyID, actorID: actorID, id: id})
	return s.result, s.err
}

func (s *pipelineRouteStore) PutPipeline(_ context.Context, companyID, actorID, id uuid.UUID, tag string, present bool, body []byte) (drafts.Result, error) {
	s.puts = append(s.puts, routeSaveCall{companyID: companyID, actorID: actorID, id: id, ifMatch: tag, present: present, body: body})
	return s.result, s.err
}

func pipelineRoutesRouter(s *pipelineRouteStore) http.Handler {
	return newRouter(routerDeps{
		requireAuth:      routeRequireAuth,
		requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader),
		requireOwner:     routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader),
		pipelineHandler:  jobshttp.NewPipelineHandler(s),
	})
}

func TestPipelineRoutes_ContractAndNoStoreOnEveryStatus(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline"
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
		{"put 200", "PUT", path, `{}`, auth, nil, 200, "", 1},
		{"401", "GET", path, "", nil, nil, 401, "unauthenticated", 0},
		{"403", "PUT", path, `{}`, map[string]string{"X-Test-Sub": "sub"}, nil, 403, "forbidden", 0},
		{"bad path", "GET", "/v2/me/company/job-drafts/bad/pipeline", "", auth, nil, 400, "invalid_request", 0},
		{"invalid request", "PUT", path, `{}`, auth, drafts.ErrInvalidRequest, 400, "invalid_request", 1},
		{"validation", "PUT", path, `{}`, auth, drafts.ErrValidation, 400, "validation_error", 1},
		{"structure locked", "PUT", path, `{}`, auth, pipelineconfig.ErrStructureLocked, 409, "stage_change_requires_empty_pipeline", 1},
		{"live user", "GET", path, "", auth, drafts.ErrUnauthenticated, 401, "unauthenticated", 1},
		{"membership", "PUT", path, `{}`, auth, drafts.ErrForbidden, 403, "forbidden", 1},
		{"inactive company", "GET", path, "", auth, drafts.ErrCompanyInactive, 403, "company_inactive", 1},
		{"not active company", "PUT", path, `{}`, auth, drafts.ErrCompanyNotActive, 409, "company_not_active", 1},
		{"missing foreign nonprincipal", "GET", path, "", auth, drafts.ErrNotFound, 404, "not_found", 1},
		{"stale foreign tag", "PUT", path, `{}`, auth, drafts.ErrVersionConflict, 412, "version_conflict", 1},
		{"payload budget", "PUT", path, strings.Repeat("x", 1048577), auth, nil, 413, "payload_too_large", 0},
		{"precondition", "PUT", path, `{}`, auth, drafts.ErrPreconditionRequired, 428, "precondition_required", 1},
		{"unexpected", "GET", path, "", auth, errors.New("private internal detail"), 500, "internal_error", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := drafts.Result{Body: []byte(`{"version":"0","structure_locked":false,"stages":[],"exit":{},"limits":{"maxCustomStages":3,"nameMaxLength":40}}`), ETag: `"pipeline-opaque"`}
			s := &pipelineRouteStore{result: result, err: tc.err}
			r := doRouteRequest(t, pipelineRoutesRouter(s), tc.method, tc.path, tc.body, tc.headers)
			if r.Code != tc.status {
				t.Fatalf("status=%d body=%s want=%d", r.Code, r.Body.String(), tc.status)
			}
			assertDraftRouteNoStore(t, r)
			if len(s.gets)+len(s.puts) != tc.calls {
				t.Fatalf("calls gets=%d puts=%d want=%d", len(s.gets), len(s.puts), tc.calls)
			}
			if tc.code == "" {
				if r.Body.String() != string(result.Body) || r.Header().Get("ETag") != result.ETag || r.Header().Get("Idempotency-Replayed") != "" {
					t.Fatalf("success headers/body: %v %s", r.Header(), r.Body.String())
				}
			} else {
				if routeCatalogCode(t, r) != tc.code || r.Header().Get("ETag") != "" {
					t.Fatalf("error headers/body: %v %s", r.Header(), r.Body.String())
				}
				obj := map[string]any{}
				if err := json.Unmarshal(r.Body.Bytes(), &obj); err != nil || len(obj) != 2 || obj["error"] == "" || obj["data"] != nil {
					t.Fatalf("error must have only error and code: %s", r.Body.String())
				}
			}
		})
	}
}

func TestPipelineRoutes_ForwardIdentityAndAllIfMatchLines(t *testing.T) {
	s := &pipelineRouteStore{result: drafts.Result{Body: []byte(`{}`), ETag: `"tag"`}}
	router := pipelineRoutesRouter(s)
	req := httptest.NewRequest("PUT", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/pipeline", strings.NewReader(`{"stages":[],"exit":{}}`))
	req.Header.Set("X-Test-Sub", "sub")
	req.Header.Set("X-Test-Role", routeTestRecruiterHeader)
	req.Header.Set("X-Company-Id", uuid.NewString())
	req.Header.Set("X-Actor-Id", uuid.NewString())
	req.Header.Add("If-Match", `"first"`)
	req.Header.Add("If-Match", `"second"`)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 200 || len(s.puts) != 1 {
		t.Fatalf("response=%d calls=%+v", rec.Code, s.puts)
	}
	want := routeSaveCall{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID, ifMatch: `"first","second"`, present: true, body: []byte(`{"stages":[],"exit":{}}`)}
	if !reflect.DeepEqual(s.puts[0], want) {
		t.Fatalf("forwarded %+v want %+v", s.puts[0], want)
	}
}
