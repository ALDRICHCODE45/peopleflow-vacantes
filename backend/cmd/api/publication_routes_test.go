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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type publishRouteCall struct {
	routeSaveCall
	key        string
	keyPresent bool
}
type publicationRouteStore struct {
	result    drafts.Result
	err       error
	gets      []routeGetCall
	publishes []publishRouteCall
}

func (s *publicationRouteStore) GetPublication(_ context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	s.gets = append(s.gets, routeGetCall{companyID: companyID, actorID: actorID, id: id})
	return s.result, s.err
}
func (s *publicationRouteStore) Publish(_ context.Context, companyID, actorID, id uuid.UUID, key string, keyPresent bool, tag string, present bool, body []byte) (drafts.Result, error) {
	s.publishes = append(s.publishes, publishRouteCall{routeSaveCall: routeSaveCall{companyID: companyID, actorID: actorID, id: id, ifMatch: tag, present: present, body: body}, key: key, keyPresent: keyPresent})
	return s.result, s.err
}
func publicationRoutesRouter(s *publicationRouteStore) http.Handler {
	return newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), publicationHandler: jobshttp.NewPublicationHandler(s)})
}
func TestPublicationRoutesAnonymousNoStore(t *testing.T) {
	for _, method := range []string{"GET", "POST"} {
		t.Run(method, func(t *testing.T) {
			r := doRouteRequest(t, publicationRoutesRouter(&publicationRouteStore{}), method, "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/publication", "{}", nil)
			if r.Code != 401 {
				t.Fatalf("status=%d body=%s want 401", r.Code, r.Body.String())
			}
			assertDraftRouteNoStore(t, r)
		})
	}
}
func TestPublicationRoutesContractEveryStatus(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/publication"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, tc := range []struct {
		name, method, body string
		err                error
		status             int
		code               string
		replay             bool
	}{
		{"readiness", "GET", "", nil, 200, "", false}, {"published", "POST", `{}`, nil, 201, "", false}, {"replay", "POST", `{}`, nil, 201, "", true},
		{"invalid", "POST", `{}`, drafts.ErrInvalidRequest, 400, "invalid_request", false}, {"key required", "POST", `{}`, drafts.ErrIdempotencyKeyRequired, 400, "idempotency_key_required", false}, {"key invalid", "POST", `{}`, drafts.ErrInvalidIdempotencyKey, 400, "invalid_idempotency_key", false},
		{"key conflict", "POST", `{}`, drafts.ErrIdempotencyConflict, 409, "idempotency_conflict", false}, {"already", "POST", `{}`, publication.ErrAlreadyPublished, 409, "already_published", false},
		{"incomplete", "POST", `{}`, errors.Join(errors.New("private"), &publication.Incomplete{Missing: []string{"title_missing", "commitment_date_past"}}), 422, "publication_incomplete", false},
		{"notfound", "POST", `{}`, drafts.ErrNotFound, 404, "not_found", false}, {"unauthenticated", "GET", "", drafts.ErrUnauthenticated, 401, "unauthenticated", false}, {"forbidden", "POST", `{}`, drafts.ErrForbidden, 403, "forbidden", false}, {"inactive", "GET", "", drafts.ErrCompanyInactive, 403, "company_inactive", false}, {"notactive", "POST", `{}`, drafts.ErrCompanyNotActive, 409, "company_not_active", false},
		{"conflict", "POST", `{}`, drafts.ErrVersionConflict, 412, "version_conflict", false}, {"required", "POST", `{}`, drafts.ErrPreconditionRequired, 428, "precondition_required", false}, {"oversize", "POST", strings.Repeat("x", 1048577), nil, 413, "payload_too_large", false}, {"internal", "GET", "", errors.New("private"), 500, "internal_error", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := drafts.Result{Body: []byte(`{"id":"id","status":"published","publishedAt":"2026-10-16T18:00:00Z"}`), ETag: `"draft-tag"`, Replayed: tc.replay}
			if tc.method == "GET" {
				result.Body = []byte(`{"status":"draft","publishedAt":null,"missing":[]}`)
				result.ETag = ""
			}
			s := &publicationRouteStore{result: result, err: tc.err}
			r := doRouteRequest(t, publicationRoutesRouter(s), tc.method, path, tc.body, auth)
			assertDraftRouteNoStore(t, r)
			if r.Code != tc.status {
				t.Fatalf("%d %s", r.Code, r.Body.String())
			}
			if tc.code == "" {
				wantReplay := ""
				if tc.method == "POST" {
					wantReplay = "false"
					if tc.replay {
						wantReplay = "true"
					}
				}
				if r.Body.String() != string(result.Body) || r.Header().Get("ETag") != result.ETag || r.Header().Get("Idempotency-Replayed") != wantReplay {
					t.Fatalf("%v %s", r.Header(), r.Body.String())
				}
			} else {
				var obj map[string]any
				_ = json.Unmarshal(r.Body.Bytes(), &obj)
				keys := 2
				if tc.code == "publication_incomplete" {
					keys = 3
					if !reflect.DeepEqual(obj["missing"], []any{"title_missing", "commitment_date_past"}) {
						t.Fatal(obj)
					}
				}
				if len(obj) != keys || obj["error"] == "" || obj["code"] != tc.code || r.Header().Get("ETag") != "" || r.Header().Get("Idempotency-Replayed") != "" {
					t.Fatalf("%v %s", r.Header(), r.Body.String())
				}
			}
		})
	}
}
func TestPublicationRoutesForwardIdentityAndHeaderShapeToStore(t *testing.T) {
	for _, tc := range []struct {
		name    string
		keys    []string
		want    string
		present bool
	}{{"absent", nil, "", false}, {"empty", []string{""}, "", true}, {"repeated", []string{"first", "second"}, "first,second", true}} {
		t.Run(tc.name, func(t *testing.T) {
			s := &publicationRouteStore{result: drafts.Result{Body: []byte(`{}`), ETag: `"tag"`}}
			req := httptest.NewRequest("POST", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/publication", strings.NewReader(`{}`))
			req.Header.Set("X-Test-Sub", "sub")
			req.Header.Set("X-Test-Role", routeTestRecruiterHeader)
			req.Header.Set("X-Company-Id", uuid.NewString())
			for _, key := range tc.keys {
				req.Header.Add("Idempotency-Key", key)
			}
			req.Header.Add("If-Match", `"first"`)
			req.Header.Add("If-Match", `"second"`)
			r := httptest.NewRecorder()
			publicationRoutesRouter(s).ServeHTTP(r, req)
			want := publishRouteCall{routeSaveCall: routeSaveCall{companyID: routeTestCompanyID, actorID: routeTestActorID, id: routeTestDraftID, ifMatch: `"first","second"`, present: true, body: []byte(`{}`)}, key: tc.want, keyPresent: tc.present}
			if r.Code != 201 || len(s.publishes) != 1 || !reflect.DeepEqual(s.publishes[0], want) {
				t.Fatalf("%d %+v", r.Code, s.publishes)
			}
		})
	}
}
