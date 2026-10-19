package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	"github.com/google/uuid"
)

type identityRouteUsers struct{}

func (identityRouteUsers) GetByCognitoSub(_ context.Context, sub string) (*entities.User, error) {
	if sub == "unknown" {
		return nil, entities.ErrUserNotFound
	}
	email, _ := valueobjects.NewEmail("route@example.com")
	name, _ := valueobjects.NewFullName("Route User")
	role := valueobjects.UserRecruiter
	if sub == "candidate" {
		role = valueobjects.UserCandidate
	}
	return entities.NewUser(sub, email, name, role)
}
func (identityRouteUsers) Create(context.Context, *entities.User) (*entities.User, error) {
	return nil, errors.New("unexpected write")
}
func (identityRouteUsers) GetByID(context.Context, uuid.UUID) (*entities.User, error) {
	return nil, errors.New("unexpected lookup")
}

type identityRouteVerifier struct{}

func (identityRouteVerifier) Verify(_ context.Context, token string) (security.Claims, error) {
	return security.Claims{Subject: token, Groups: []string{"candidates", "recruiters", "company_admins"}}, nil
}

// §11.2/S21: all legacy candidate endpoints reject before touching a handler.
func TestCandidateIdentityLegacyRoutesRoleGates(t *testing.T) {
	r := newRouter(routerDeps{requireAuth: identityhttp.RequireAuth(identityRouteVerifier{}), requireCandidate: identityhttp.RequireCandidateRole(identityRouteUsers{}), requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth})
	for _, route := range []struct{ method, path string }{
		{"GET", "/me/profile/"}, {"PUT", "/me/profile/"}, {"GET", "/me/profile/languages/"}, {"PUT", "/me/profile/languages/"}, {"GET", "/me/applications"}, {"POST", "/jobs/not-an-id/applications"},
	} {
		for _, actor := range []struct{ subject, code string }{{"recruiter", "wrong_role"}, {"unknown", "account_required"}} {
			t.Run(actor.subject+route.method+route.path, func(t *testing.T) {
				w := httptest.NewRecorder()
				req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
				req.Header.Set("Authorization", "Bearer "+actor.subject)
				r.ServeHTTP(w, req)
				var body map[string]any
				_ = json.Unmarshal(w.Body.Bytes(), &body)
				if w.Code != 403 || len(body) != 2 || body["code"] != actor.code || body["error"] == nil {
					t.Fatalf("got %d %s", w.Code, w.Body.String())
				}
				if w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("missing no-store")
				}
			})
		}
	}
}

// §11.3: these private routes must exist and reject before any dependency runs.
func TestCandidateIdentityRoutesRequireAuthentication(t *testing.T) {
	r := newRouter(routerDeps{requireAuth: identityhttp.RequireAuth(identityRouteVerifier{}), requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth})
	for _, tc := range []struct{ method, path string }{{"GET", "/v2/me"}, {"POST", "/v2/me/candidate-account"}, {"GET", "/me/profile/"}, {"PUT", "/me/profile/"}, {"GET", "/me/profile/languages/"}, {"PUT", "/me/profile/languages/"}, {"GET", "/me/applications"}, {"POST", "/jobs/not-an-id/applications"}} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"full_name":"Ana Pérez"}`)))
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d; want 401 (body %s)", w.Code, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
		})
	}
}

// Regression for the per-method applications mount (L40): through the real
// router, recruiter list/detail/transition still run requireAuth then the
// recruiter gate (never the candidate gate) and keep their previous headers,
// while the candidate POST runs the candidate gate and never the recruiter gate.
func TestApplicationsMountKeepsRecruiterGatesThroughRealRouter(t *testing.T) {
	const recruiterGateStatus = http.StatusTeapot
	recruiterGateHits := 0
	recruiterGate := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			recruiterGateHits++
			w.WriteHeader(recruiterGateStatus)
		})
	}
	r := newRouter(routerDeps{
		requireAuth:      identityhttp.RequireAuth(identityRouteVerifier{}),
		requireCandidate: identityhttp.RequireCandidateRole(identityRouteUsers{}),
		requireRecruiter: recruiterGate,
		requireOwner:     routeRequireAuth,
	})
	jobID := uuid.NewString()
	appID := uuid.NewString()
	recruiterRoutes := []struct{ method, path string }{
		{"GET", "/jobs/" + jobID + "/applications/"},
		{"GET", "/jobs/" + jobID + "/applications/" + appID},
		{"PATCH", "/jobs/" + jobID + "/applications/" + appID + "/transition"},
	}
	for _, route := range recruiterRoutes {
		t.Run("anonymous "+route.method+route.path, func(t *testing.T) {
			before := recruiterGateHits
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`)))
			if w.Code != http.StatusUnauthorized || recruiterGateHits != before {
				t.Fatalf("got %d, recruiter gate hits %d→%d", w.Code, before, recruiterGateHits)
			}
		})
		// A candidate token would pass the candidate gate; reaching the recruiter
		// gate proves the recruiter routes are not candidate-gated.
		for _, subject := range []string{"candidate", "recruiter", "unknown"} {
			t.Run(subject+" "+route.method+route.path, func(t *testing.T) {
				before := recruiterGateHits
				w := httptest.NewRecorder()
				req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
				req.Header.Set("Authorization", "Bearer "+subject)
				r.ServeHTTP(w, req)
				if w.Code != recruiterGateStatus || recruiterGateHits != before+1 {
					t.Fatalf("got %d, recruiter gate hits %d→%d", w.Code, before, recruiterGateHits)
				}
				if got := w.Header().Get("Cache-Control"); got != "" {
					t.Fatalf("recruiter route gained Cache-Control %q", got)
				}
			})
		}
	}
	t.Run("candidate POST never reaches the recruiter gate", func(t *testing.T) {
		before := recruiterGateHits
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/jobs/"+jobID+"/applications", strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer recruiter")
		r.ServeHTTP(w, req)
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != http.StatusForbidden || body["code"] != "wrong_role" || recruiterGateHits != before {
			t.Fatalf("got %d %s, recruiter gate hits %d→%d", w.Code, w.Body.String(), before, recruiterGateHits)
		}
	})
}
