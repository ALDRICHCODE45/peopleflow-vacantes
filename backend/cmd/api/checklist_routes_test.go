package main

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type checklistRouteStore struct {
	result drafts.Result
	err    error
	gets   []routeGetCall
	puts   []routeSaveCall
}

func (s *checklistRouteStore) GetChecklist(_ context.Context, c, a, id uuid.UUID) (drafts.Result, error) {
	s.gets = append(s.gets, routeGetCall{companyID: c, actorID: a, id: id})
	return s.result, s.err
}
func (s *checklistRouteStore) PutChecklist(_ context.Context, c, a, id uuid.UUID, tag string, present bool, body []byte) (drafts.Result, error) {
	s.puts = append(s.puts, routeSaveCall{companyID: c, actorID: a, id: id, ifMatch: tag, present: present, body: body})
	return s.result, s.err
}
func checklistRoutesRouter(s *checklistRouteStore) http.Handler {
	return newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), checklistHandler: jobshttp.NewChecklistHandler(s)})
}
func TestChecklistRoutesContractIdentityAndNoStore(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/checklist"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"tag"`}
	for _, tc := range []struct {
		name, method string
		headers      map[string]string
		err          error
		status       int
		code         string
	}{
		{"get", "GET", auth, nil, 200, ""}, {"put", "PUT", auth, nil, 200, ""}, {"anonymous", "GET", nil, nil, 401, "unauthenticated"}, {"role", "PUT", map[string]string{"X-Test-Sub": "sub"}, nil, 403, "forbidden"}, {"not found", "GET", auth, drafts.ErrNotFound, 404, "not_found"}, {"missing tag", "PUT", auth, drafts.ErrPreconditionRequired, 428, "precondition_required"}, {"stale", "PUT", auth, drafts.ErrVersionConflict, 412, "version_conflict"}, {"malformed", "PUT", auth, drafts.ErrInvalidRequest, 400, "invalid_request"}, {"validation", "PUT", auth, &checklist.Invalid{Fields: []checklist.Field{{Field: "criteria", Code: "required"}}}, 400, "validation_error"}, {"internal", "GET", auth, errors.New("private"), 500, "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := drafts.Result{Body: []byte(`{"version":"0","criteria":[],"reminder_stage_ids":[]}`), ETag: `"tag"`}
			s := &checklistRouteStore{result: result, err: tc.err}
			r := doRouteRequest(t, checklistRoutesRouter(s), tc.method, path, `{}`, tc.headers)
			if r.Code != tc.status {
				t.Fatalf("%d %s", r.Code, r.Body.String())
			}
			assertDraftRouteNoStore(t, r)
			if tc.code != "" {
				if routeCatalogCode(t, r) != tc.code || r.Header().Get("ETag") != "" {
					t.Fatal(r.Body.String())
				}
				return
			}
			if r.Body.String() != string(result.Body) || r.Header().Get("ETag") != result.ETag {
				t.Fatal(r.Body.String())
			}
			if tc.method == "GET" {
				if !reflect.DeepEqual(s.gets, []routeGetCall{{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID}}) {
					t.Fatal(s.gets)
				}
			} else {
				if !reflect.DeepEqual(s.puts, []routeSaveCall{{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID, ifMatch: `"tag"`, present: true, body: []byte(`{}`)}}) {
					t.Fatal(s.puts)
				}
			}
		})
	}
}
