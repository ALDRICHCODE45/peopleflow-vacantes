package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/ratelimit"
)

const rateLimitedBody = "{\"error\":\"too many requests\",\"code\":\"rate_limited\"}\n"

func rateLimitRequest(r http.Handler, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.RemoteAddr = "192.0.2.10:1234"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestPsychometricPublicRoutesAreRateLimited(t *testing.T) {
	limiter := ratelimit.NewAssessment(ratelimit.Limits{PerToken: 100, PerIP: 1, UnknownPerIP: 100, Window: time.Minute, MaxKeys: 100}, nil, nil)
	r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth, publicAssessmentLimit: limiter.Middleware})
	const token = "secret-token-value"
	if rec := rateLimitRequest(r, "GET", "/v2/assessments/"+token, nil); rec.Code == 429 {
		t.Fatal("first request limited")
	}
	for _, tc := range []struct{ method, suffix string }{
		{"GET", ""}, {"POST", "/consent"}, {"POST", "/finish"}, {"GET", "/items"}, {"PUT", "/answers/1"}, {"DELETE", "/answers/1"},
	} {
		rec := rateLimitRequest(r, tc.method, "/v2/assessments/"+token+tc.suffix, nil)
		if rec.Code != 429 || rec.Header().Get("Retry-After") != "60" || rec.Body.String() != rateLimitedBody {
			t.Fatalf("%s %s: %d %q %q", tc.method, tc.suffix, rec.Code, rec.Header().Get("Retry-After"), rec.Body.String())
		}
		if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("%s %s: privacy headers missing on 429: %v", tc.method, tc.suffix, rec.Header())
		}
		if strings.Contains(rec.Body.String(), token) {
			t.Fatal("token echoed")
		}
	}
	// The account prefix is never limited by the public limiter.
	for i := 0; i < 3; i++ {
		if rec := rateLimitRequest(r, "GET", "/v2/me/assessments", map[string]string{"X-Test-Sub": "sub"}); rec.Code == 429 {
			t.Fatal("account route limited")
		}
	}
}

func TestPsychometricPublicLimiterDefaultsWhenUnset(t *testing.T) {
	r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth})
	for i := 0; i < 300; i++ {
		if rec := rateLimitRequest(r, "GET", "/v2/assessments/tok", nil); rec.Code == 429 {
			t.Fatal("limited before the contract budget", i)
		}
	}
	if rec := rateLimitRequest(r, "GET", "/v2/assessments/tok", nil); rec.Code != 429 || rec.Body.String() != rateLimitedBody {
		t.Fatalf("default limiter missing: %d %q", rec.Code, rec.Body.String())
	}
}

// Unmatched paths and methods under the public token prefix are limited and
// private like the real routes, and never fall through to chi's plain 404/405.
func TestPsychometricPublicUnmatchedPathsAreLimitedAndPrivate(t *testing.T) {
	limiter := ratelimit.NewAssessment(ratelimit.Limits{PerToken: 100, PerIP: 2, UnknownPerIP: 100, Window: time.Minute, MaxKeys: 100}, nil, nil)
	r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth, publicAssessmentLimit: limiter.Middleware})
	notFound := "{\"error\":\"not found\",\"code\":\"not_found\"}\n"
	for _, tc := range []struct{ method, path string }{
		{"GET", "/v2/assessments/secret/no-such-operation"},
		{"POST", "/v2/assessments/secret"},
	} {
		rec := rateLimitRequest(r, tc.method, tc.path, map[string]string{"X-Real": tc.path})
		if rec.Code != 404 || rec.Body.String() != notFound || rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("%s %s: %d %q %v", tc.method, tc.path, rec.Code, rec.Body.String(), rec.Header())
		}
	}
	for _, tc := range []struct{ method, path string }{
		{"GET", "/v2/assessments/secret/no-such-operation"}, {"GET", "/v2/assessments/secret/consent"}, {"PATCH", "/v2/assessments/secret/answers/1"},
	} {
		if rec := rateLimitRequest(r, tc.method, tc.path, nil); rec.Code != 429 || rec.Body.String() != rateLimitedBody || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: %d %q", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}
}

// The catch-all never shadows a real public route: each registered method
// still reaches the assessment handler (which answers 500 here, nil store),
// while an unregistered method on a real path gets the private 404.
func TestPsychometricPublicCatchAllDoesNotShadowRoutes(t *testing.T) {
	r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth})
	for _, tc := range []struct{ method, suffix string }{
		{"GET", ""}, {"POST", "/consent"}, {"POST", "/finish"}, {"GET", "/items"}, {"PUT", "/answers/1"}, {"DELETE", "/answers/1"},
	} {
		if rec := rateLimitRequest(r, tc.method, "/v2/assessments/tok"+tc.suffix, nil); rec.Code != 500 {
			t.Fatalf("%s %s shadowed: %d %q", tc.method, tc.suffix, rec.Code, rec.Body.String())
		}
	}
	for _, tc := range []struct{ method, suffix string }{{"GET", "/consent"}, {"POST", "/items"}, {"PATCH", "/answers/1"}, {"GET", "/answers/1/extra"}} {
		rec := rateLimitRequest(r, tc.method, "/v2/assessments/tok"+tc.suffix, nil)
		if rec.Code != 404 || rec.Body.String() != "{\"error\":\"not found\",\"code\":\"not_found\"}\n" || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: %d %q", tc.method, tc.suffix, rec.Code, rec.Body.String())
		}
	}
}
