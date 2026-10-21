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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type lifecycleRouteCall struct {
	publishRouteCall
	action string
}
type lifecycleRouteStore struct {
	result          drafts.Result
	err             error
	gets, histories []routeGetCall
	transitions     []lifecycleRouteCall
}

func (s *lifecycleRouteStore) GetLifecycle(_ context.Context, company, actor, id uuid.UUID) (drafts.Result, error) {
	s.gets = append(s.gets, routeGetCall{companyID: company, actorID: actor, id: id})
	return s.result, s.err
}
func (s *lifecycleRouteStore) GetLifecycleHistory(_ context.Context, company, actor, id uuid.UUID) (drafts.Result, error) {
	s.histories = append(s.histories, routeGetCall{companyID: company, actorID: actor, id: id})
	return s.result, s.err
}
func (s *lifecycleRouteStore) TransitionLifecycle(_ context.Context, company, actor, id uuid.UUID, action, key string, kp bool, tag string, present bool, body []byte) (drafts.Result, error) {
	s.transitions = append(s.transitions, lifecycleRouteCall{publishRouteCall: publishRouteCall{routeSaveCall: routeSaveCall{companyID: company, actorID: actor, id: id, ifMatch: tag, present: present, body: body}, key: key, keyPresent: kp}, action: action})
	return s.result, s.err
}
func lifecycleRoutesRouter(s *lifecycleRouteStore) http.Handler {
	return newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), lifecycleHandler: jobshttp.NewLifecycleHandler(s)})
}

var lifecycleRouteCases = []struct{ method, suffix, action string }{{"GET", "", ""}, {"GET", "/history", ""}, {"POST", "/pause", "pause"}, {"POST", "/resume", "resume"}, {"POST", "/close", "close"}, {"POST", "/finish-process", "finish_process"}, {"POST", "/reopen", "reopen"}}

func TestLifecycleRoutesAllPathsIdentityHeadersAndNoStore(t *testing.T) {
	for _, tc := range lifecycleRouteCases {
		t.Run(tc.method+tc.suffix, func(t *testing.T) {
			s := &lifecycleRouteStore{result: drafts.Result{Body: []byte(`{}`), ETag: `"vl-tag"`}}
			req := httptest.NewRequest(tc.method, "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/lifecycle"+tc.suffix, strings.NewReader(`{}`))
			req.Header.Set("X-Test-Sub", "sub")
			req.Header.Set("X-Test-Role", routeTestRecruiterHeader)
			req.Header.Set("X-Company-Id", uuid.NewString())
			req.Header.Add("If-Match", `"first"`)
			req.Header.Add("If-Match", `"second"`)
			req.Header.Add("Idempotency-Key", "first")
			req.Header.Add("Idempotency-Key", "second")
			response := httptest.NewRecorder()
			lifecycleRoutesRouter(s).ServeHTTP(response, req)
			assertDraftRouteNoStore(t, response)
			if response.Code != 200 || response.Body.String() != `{}` || response.Header().Get("ETag") != s.result.ETag {
				t.Fatalf("%d %s %v", response.Code, response.Body, response.Header())
			}
			want := routeGetCall{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID}
			switch tc.suffix {
			case "":
				if !reflect.DeepEqual(s.gets, []routeGetCall{want}) {
					t.Fatal(s.gets)
				}
			case "/history":
				if !reflect.DeepEqual(s.histories, []routeGetCall{want}) {
					t.Fatal(s.histories)
				}
			default:
				if len(s.transitions) != 1 {
					t.Fatal(s.transitions)
				}
				call := s.transitions[0]
				if call.companyID != want.companyID || call.actorID != want.actorID || call.id != want.id || call.action != tc.action || call.key != "first,second" || !call.keyPresent || call.ifMatch != `"first","second"` || !call.present || string(call.body) != `{}` || response.Header().Get("Idempotency-Replayed") != "false" {
					t.Fatalf("%+v", call)
				}
			}
		})
	}
}
func TestLifecycleRoutesAnonymousAndCandidateFailClosed(t *testing.T) {
	for _, tc := range lifecycleRouteCases {
		t.Run(tc.method+tc.suffix, func(t *testing.T) {
			for _, caller := range []struct {
				name    string
				headers map[string]string
				status  int
			}{{"anonymous", nil, 401}, {"candidate", map[string]string{"X-Test-Sub": "candidate", "X-Test-Role": "candidate"}, 403}} {
				t.Run(caller.name, func(t *testing.T) {
					s := &lifecycleRouteStore{}
					response := doRouteRequest(t, lifecycleRoutesRouter(s), tc.method, "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/lifecycle"+tc.suffix, `{}`, caller.headers)
					assertDraftRouteNoStore(t, response)
					if response.Code != caller.status || len(s.transitions)+len(s.gets)+len(s.histories) != 0 {
						t.Fatalf("%d %s", response.Code, response.Body)
					}
				})
			}
		})
	}
}
func TestLifecycleRoutesErrorContractAndReplay(t *testing.T) {
	publicationState, process := "closed", "active"
	view := lifecycle.View{Publication: &publicationState, Process: &process, Version: "4", AllowedActions: []string{"finish_process", "reopen"}}
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"invalid transition", &lifecycle.InvalidTransition{Action: "pause", Lifecycle: view}, 409, "lifecycle_transition_invalid"},
		{"readiness", &publication.Incomplete{Missing: []string{"title_missing", "delivery_target_missing"}}, 422, "publication_incomplete"},
		{"missing key", drafts.ErrIdempotencyKeyRequired, 400, "idempotency_key_required"}, {"bad key", drafts.ErrInvalidIdempotencyKey, 400, "invalid_idempotency_key"}, {"key conflict", drafts.ErrIdempotencyConflict, 409, "idempotency_conflict"},
		{"not found", drafts.ErrNotFound, 404, "not_found"}, {"stale", drafts.ErrVersionConflict, 412, "version_conflict"}, {"missing precondition", drafts.ErrPreconditionRequired, 428, "precondition_required"}, {"invalid body", drafts.ErrInvalidRequest, 400, "invalid_request"}, {"unexpected", errors.New("private failure"), 500, "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &lifecycleRouteStore{err: tc.err}
			response := doRouteRequest(t, lifecycleRoutesRouter(s), "POST", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/lifecycle/pause", `{}`, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader})
			assertDraftRouteNoStore(t, response)
			var obj map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &obj); err != nil {
				t.Fatal(err)
			}
			if response.Code != tc.status || obj["code"] != tc.code || response.Header().Get("ETag") != "" || response.Header().Get("Idempotency-Replayed") != "" {
				t.Fatalf("%d %s %v", response.Code, response.Body, response.Header())
			}
			if tc.code == "publication_incomplete" {
				if len(obj) != 3 || !reflect.DeepEqual(obj["missing"], []any{"title_missing", "delivery_target_missing"}) {
					t.Fatal(obj)
				}
			} else if tc.code == "lifecycle_transition_invalid" {
				data := obj["data"].(map[string]any)
				if len(obj) != 3 || len(data) != 2 || data["action"] != "pause" || data["lifecycle"].(map[string]any)["version"] != "4" {
					t.Fatal(obj)
				}
			} else if len(obj) != 2 {
				t.Fatal(obj)
			}
		})
	}
	s := &lifecycleRouteStore{result: drafts.Result{Body: []byte(`{"original":true}`), ETag: `"original"`, Replayed: true}}
	response := doRouteRequest(t, lifecycleRoutesRouter(s), "POST", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/lifecycle/pause", `{}`, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader})
	if response.Code != 200 || response.Header().Get("Idempotency-Replayed") != "true" || response.Header().Get("ETag") != s.result.ETag || response.Body.String() != string(s.result.Body) || s.transitions[0].keyPresent || s.transitions[0].present {
		t.Fatalf("%d %s %v", response.Code, response.Body, response.Header())
	}
}
