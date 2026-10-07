// Production-router boundary tests for the private vacancy draft routes (T4).
//
// Unlike the handler unit tests, these tests build the REAL newRouter with the
// real route table and the real middleware ordering (NoStore -> requireAuth ->
// requireRecruiter). They pin the contract that every private response —
// including a 401/403 produced before the handler — carries Cache-Control:
// no-store, and that no public route gained the header.
//
// The auth gates are replaced by fakes because the real gates resolve JWTs and
// query PostgreSQL; the route table, the no-store middleware and the
// composition shape are the real ones.
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	runtimemetrics "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

const (
	routeTestRecruiterHeader = "recruiter"
	routeTestOwnerHeader     = "owner"
)

var (
	routeTestCompanyID = uuid.MustParse("22222222-2222-2222-2222-222222222222")
	routeTestActorID   = uuid.MustParse("33333333-3333-3333-3333-333333333333")
	routeTestDraftID   = uuid.MustParse("11111111-1111-1111-1111-111111111111")
)

const (
	routeTestBody = `{"schema_version":1,"id":"11111111-1111-1111-1111-111111111111","status":"draft","version":"1","fields":{}}`
	routeTestETag = `"jd-r1-11111111-1111-1111-1111-111111111111-v1"`
)

type routeCreateCall struct {
	companyID, actorID uuid.UUID
	key                string
	body               []byte
}

type routeGetCall struct {
	companyID, actorID, id uuid.UUID
}

type routeSaveCall struct {
	companyID, actorID, id uuid.UUID
	ifMatch                string
	present                bool
	body                   []byte
}

type routeDraftStore struct {
	createResult drafts.Result
	createErr    error
	getResult    drafts.Result
	getErr       error
	saveResult   drafts.Result
	saveErr      error

	creates []routeCreateCall
	gets    []routeGetCall
	saves   []routeSaveCall
}

func (s *routeDraftStore) Create(_ context.Context, companyID, actorID uuid.UUID, key string, body []byte) (drafts.Result, error) {
	s.creates = append(s.creates, routeCreateCall{companyID: companyID, actorID: actorID, key: key, body: body})
	return s.createResult, s.createErr
}

func (s *routeDraftStore) Get(_ context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	s.gets = append(s.gets, routeGetCall{companyID: companyID, actorID: actorID, id: id})
	return s.getResult, s.getErr
}

func (s *routeDraftStore) Save(_ context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	s.saves = append(s.saves, routeSaveCall{companyID: companyID, actorID: actorID, id: id, ifMatch: ifMatch, present: present, body: body})
	return s.saveResult, s.saveErr
}

func (s *routeDraftStore) total() int { return len(s.creates) + len(s.gets) + len(s.saves) }

func routeRequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Test-Sub") == "" {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func routeRoleGate(role companiesvalueobjects.MemberRole, header string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Test-Role") != header {
				httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeForbidden), "insufficient role"))
				return
			}
			cc := identitysecurity.CompanyContext{CompanyID: routeTestCompanyID, UserID: routeTestActorID, Role: role}
			next.ServeHTTP(w, r.WithContext(identitysecurity.ContextWithCompanyContext(r.Context(), cc)))
		})
	}
}

// newDraftRoutesTestRouter builds the real router with the real draft routes
// and no-store middleware; only the auth gates and the store are fakes.
func newDraftRoutesTestRouter(store drafts.Store) http.Handler {
	return newRouter(routerDeps{
		requireAuth:      routeRequireAuth,
		requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader),
		requireOwner:     routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader),
		draftHandler:     jobshttp.NewDraftHandler(store),
		httpMetrics:      runtimemetrics.Default,
	})
}

func doRouteRequest(t *testing.T, router http.Handler, method, path string, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func routeCatalogCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var env struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("response is not a catalog envelope: %v; body=%s", err, rec.Body.String())
	}
	return env.Code
}

func assertDraftRouteNoStore(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store; body=%s", got, rec.Body.String())
	}
}

func TestPrivateDraftRoutes_NoStoreOnEveryFailureAndSuccess(t *testing.T) {
	authorized := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}

	tests := []struct {
		name         string
		method       string
		path         string
		body         string
		headers      map[string]string
		store        routeDraftStore
		wantStatus   int
		wantCode     string
		wantETag     string
		wantReplayed string
		wantBody     string
		wantStoreMin int
	}{
		{
			name: "401 unauthenticated", method: http.MethodPost, path: "/me/company/job-drafts",
			body: `{"fields":{}}`, headers: map[string]string{"Idempotency-Key": "k"},
			wantStatus: http.StatusUnauthorized, wantCode: "unauthenticated",
		},
		{
			name: "403 forbidden", method: http.MethodPost, path: "/me/company/job-drafts",
			body: `{"fields":{}}`, headers: map[string]string{"X-Test-Sub": "sub", "Idempotency-Key": "k"},
			wantStatus: http.StatusForbidden, wantCode: "forbidden",
		},
		{
			name: "400 idempotency_key_required", method: http.MethodPost, path: "/me/company/job-drafts",
			body: `{"fields":{}}`, headers: authorized,
			wantStatus: http.StatusBadRequest, wantCode: "idempotency_key_required",
		},
		{
			name: "404 not_found", method: http.MethodGet, path: "/me/company/job-drafts/" + routeTestDraftID.String(),
			headers: authorized, store: routeDraftStore{getErr: drafts.ErrNotFound},
			wantStatus: http.StatusNotFound, wantCode: "not_found", wantStoreMin: 1,
		},
		{
			name: "428 precondition_required", method: http.MethodPatch, path: "/me/company/job-drafts/" + routeTestDraftID.String(),
			body: `{"fields":{}}`, headers: authorized, store: routeDraftStore{saveErr: drafts.ErrPreconditionRequired},
			wantStatus: http.StatusPreconditionRequired, wantCode: "precondition_required", wantStoreMin: 1,
		},
		{
			name: "412 version_conflict", method: http.MethodPatch, path: "/me/company/job-drafts/" + routeTestDraftID.String(),
			body: `{"fields":{}}`, headers: authorized, store: routeDraftStore{saveErr: drafts.ErrVersionConflict},
			wantStatus: http.StatusPreconditionFailed, wantCode: "version_conflict", wantStoreMin: 1,
		},
		{
			name: "201 create success", method: http.MethodPost, path: "/me/company/job-drafts",
			body: `{"fields":{}}`, headers: map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "Idempotency-Key": "k"},
			store:      routeDraftStore{createResult: drafts.Result{Body: []byte(routeTestBody), ETag: routeTestETag}},
			wantStatus: http.StatusCreated, wantETag: routeTestETag, wantReplayed: "false", wantBody: routeTestBody, wantStoreMin: 1,
		},
		{
			name: "201 create replay", method: http.MethodPost, path: "/me/company/job-drafts",
			body: `{"fields":{}}`, headers: map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "Idempotency-Key": "k"},
			store:      routeDraftStore{createResult: drafts.Result{Body: []byte(routeTestBody), ETag: routeTestETag, Replayed: true}},
			wantStatus: http.StatusCreated, wantETag: routeTestETag, wantReplayed: "true", wantBody: routeTestBody, wantStoreMin: 1,
		},
		{
			name: "200 get success", method: http.MethodGet, path: "/me/company/job-drafts/" + routeTestDraftID.String(),
			headers: authorized, store: routeDraftStore{getResult: drafts.Result{Body: []byte(routeTestBody), ETag: routeTestETag}},
			wantStatus: http.StatusOK, wantETag: routeTestETag, wantBody: routeTestBody, wantStoreMin: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := tt.store
			rec := doRouteRequest(t, newDraftRoutesTestRouter(&store), tt.method, tt.path, tt.body, tt.headers)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			assertDraftRouteNoStore(t, rec)
			if tt.wantCode != "" {
				if got := routeCatalogCode(t, rec); got != tt.wantCode {
					t.Fatalf("code = %q, want %q; body=%s", got, tt.wantCode, rec.Body.String())
				}
			}
			if tt.wantETag != "" {
				if got := rec.Header().Get("ETag"); got != tt.wantETag {
					t.Fatalf("ETag = %q, want %q", got, tt.wantETag)
				}
			}
			if tt.wantReplayed != "" {
				if got := rec.Header().Get("Idempotency-Replayed"); got != tt.wantReplayed {
					t.Fatalf("Idempotency-Replayed = %q, want %q", got, tt.wantReplayed)
				}
			}
			if tt.wantBody != "" && rec.Body.String() != tt.wantBody {
				t.Fatalf("body = %q, want the exact stored bytes %q", rec.Body.String(), tt.wantBody)
			}
			if len(store.creates)+len(store.gets)+len(store.saves) < tt.wantStoreMin {
				t.Fatalf("store calls = %d, want at least %d", store.total(), tt.wantStoreMin)
			}
			if tt.wantStoreMin == 0 && store.total() != 0 {
				t.Fatalf("rejected request must not reach the store; got %d calls", store.total())
			}
		})
	}
}

// TestPrivateDraftRoutes_ForwardSessionIdentity proves the router boundary
// never lets a client-supplied company/actor reach the store: the only
// identity the store sees is the one the gate injected.
func TestPrivateDraftRoutes_ForwardSessionIdentity(t *testing.T) {
	store := &routeDraftStore{getResult: drafts.Result{Body: []byte(routeTestBody), ETag: routeTestETag}}
	rec := doRouteRequest(t, newDraftRoutesTestRouter(store), http.MethodGet,
		"/me/company/job-drafts/"+routeTestDraftID.String(),
		"", map[string]string{
			"X-Test-Sub":    "sub",
			"X-Test-Role":   routeTestRecruiterHeader,
			"X-Company-Id":  uuid.New().String(),
			"X-Actor-Id":    uuid.New().String(),
			"X-Impersonate": routeTestActorID.String(),
		})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(store.gets) != 1 {
		t.Fatalf("want one Get; got %d", len(store.gets))
	}
	call := store.gets[0]
	if call.companyID != routeTestCompanyID || call.actorID != routeTestActorID || call.id != routeTestDraftID {
		t.Fatalf("forwarded (%s,%s,%s), want the session context (%s,%s,%s)",
			call.companyID, call.actorID, call.id, routeTestCompanyID, routeTestActorID, routeTestDraftID)
	}
}

// TestPublicRoutes_NoNoStoreHeader pins that the private cache middleware was
// not applied globally: an existing public route keeps its historical headers.
func TestPublicRoutes_NoNoStoreHeader(t *testing.T) {
	router := newDraftRoutesTestRouter(&routeDraftStore{})
	rec := doRouteRequest(t, router, http.MethodGet, "/healthz", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Fatalf("public GET /healthz must not carry Cache-Control (got %q); no-store is scoped to the private draft routes", got)
	}
}
