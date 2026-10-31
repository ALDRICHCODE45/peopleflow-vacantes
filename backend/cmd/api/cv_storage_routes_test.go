package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	apphttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/v2"
	cvapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	cvshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/http/cvs"
	identityusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type storageRouteIdentity struct{ identityRouteUsers }

func (storageRouteIdentity) CreateCandidate(context.Context, *entities.User) (*entities.User, bool, error) {
	return nil, false, errors.New("unexpected write")
}

type storageRouteApplications struct{ applyCalls, listCalls int }

func (s *storageRouteApplications) Apply(context.Context, string, uuid.UUID, uuid.UUID, app.Request) (app.Result, error) {
	s.applyCalls++
	return app.Result{Body: []byte(`{"status":"submitted"}`)}, nil
}
func (s *storageRouteApplications) List(context.Context, string, app.Query) (app.Page, error) {
	s.listCalls++
	return app.Page{Items: []app.Item{}}, nil
}

func (s *storageRouteApplications) MarkMessageRead(context.Context, string, uuid.UUID, time.Time) error {
	return nil
}

type storageRouteCVs struct{ cvapp.Library }

func (storageRouteCVs) List(context.Context, string) ([]cvapp.CV, error) { return []cvapp.CV{}, nil }
func TestCVStorageConfiguredRouteUnchanged(t *testing.T) {
	r := newRouter(routerDeps{
		requireAuth: identityhttp.RequireAuth(identityRouteVerifier{}), requireCandidate: identityhttp.RequireCandidateRole(identityRouteUsers{}), requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth,
		cvHandler: cvshttp.NewHandler(storageRouteCVs{}, draftjson.Decode),
	})
	req := httptest.NewRequest("GET", "/v2/me/cvs", nil)
	req.Header.Set("Authorization", "Bearer candidate")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var page cvapp.Page
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || page.Items == nil || len(page.Items) != 0 || page.Limits.MaxCVs != 10 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("configured library changed: %d %s", w.Code, w.Body.String())
	}
}
func TestCVStorageDisabledRoutesAndUnrelatedServices(t *testing.T) {
	applications := &storageRouteApplications{}
	r := newRouter(routerDeps{
		requireAuth: identityhttp.RequireAuth(identityRouteVerifier{}), requireCandidate: identityhttp.RequireCandidateRole(identityRouteUsers{}), requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth,
		identityHandler:      identityhttp.NewCandidateIdentityHandler(identityusecases.NewCandidateIdentity(storageRouteIdentity{}, nil)),
		publicJobsHandler:    jobshttp.NewPublicJobsHandler(publicjobs.NewCatalog(publicRouteReader{})),
		participationHandler: apphttp.NewHandler(applications, draftjson.Decode),
		// No CV handler/storage: the production disabled configuration.
	})
	for _, route := range []struct {
		method, path string
		status       int
		code         string
	}{
		{"GET", "/v2/me/cvs", 503, "cv_storage_unavailable"},
		{"POST", "/v2/me/cvs", 503, "cv_storage_unavailable"},
		{"PATCH", "/v2/me/cvs/not-an-id", 503, "cv_storage_unavailable"},
		{"DELETE", "/v2/me/cvs/not-an-id", 503, "cv_storage_unavailable"},
		{"GET", "/v2/me/cvs/not-an-id/file", 503, "cv_storage_unavailable"},
		{"GET", "/v2/jobs", 200, ""}, {"GET", "/v2/me", 200, ""},
		{"GET", "/v2/jobs/11111111-1111-4111-8111-111111111111/screening", 404, "not_found"},
		{"POST", "/v2/jobs/11111111-1111-4111-8111-111111111111/applications", 201, ""},
		{"GET", "/v2/me/applications", 200, ""},
		{"PUT", "/v2/me/applications/11111111-1111-4111-8111-111111111111/message-read", 204, ""},
	} {
		t.Run(route.method+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{"cv_id":"11111111-1111-4111-8111-111111111111","questionnaire_revision":"r","answers":[]}`))
			if route.method == "PUT" {
				req = httptest.NewRequest(route.method, route.path, strings.NewReader(`{"updated_at":"2026-10-01T09:00:00Z"}`))
			}
			req.Header.Set("Authorization", "Bearer candidate")
			req.Header.Set("Idempotency-Key", uuid.NewString())
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if route.status == 204 {
				if w.Code != 204 || w.Body.Len() != 0 || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal(w.Code, w.Body.String(), w.Header())
				}
				return
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("status %d: invalid JSON", w.Code)
			}
			if w.Code != route.status || (route.code != "" && body["code"] != route.code) {
				t.Fatalf("got %d %s", w.Code, w.Body.String())
			}
			if route.status == 503 && (len(body) != 2 || body["error"] == nil || w.Header().Get("Cache-Control") != "no-store") {
				t.Fatal("unavailable envelope/headers", body, w.Header())
			}
		})
	}
	if applications.applyCalls != 1 || applications.listCalls != 1 {
		t.Fatal("unrelated application services not called", applications)
	}
}
