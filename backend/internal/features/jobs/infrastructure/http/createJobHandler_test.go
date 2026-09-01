// Unit tests for the POST /jobs create-path HTTP handler.
//
// These tests cover two planes (per task 5.1 in jobs-create/tasks.md):
//
//  1. Business scenarios -- a stub repo records the write flow; the
//     test injects CompanyContext directly (mirroring
//     companies/.../memberHandler_test.go::newMemberRouter).
//
//  2. Route-boundary scenarios -- the gated POST is mounted behind
//     `identityhttp.RequireAuth(failVerifier)` ahead of the handler
//     to prove that:
//     - a request without `Authorization` -> 401 (not 404 / 403);
//     - a POST sent through the PUBLIC `h.Routes()` mount under
//     `/jobs` is NOT matched (chi 404), proving the public mount
//     never serves the create route.
//
// The `classifyError` extension lives in jobHandler.go and is exercised
// indirectly via these tests; a future separate unit-test file could
// pin each branch independently.
package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// --- newCreateJobRouter helper ---------------------------------------

// newCreateJobRouter mounts the gated POST under `/jobs` with the
// supplied CompanyContext injected directly into the request context
// (mirroring newUpdateJobRouter in updateJobHandler_test.go). The
// repo is the test-programmable stub.
func newCreateJobRouter(repo *writeStubHandlerRepo, cc identitysecurity.CompanyContext) http.Handler {
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)

	r := chi.NewRouter()
	if cc.CompanyID != uuid.Nil {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				ctx := identitysecurity.ContextWithCompanyContext(req.Context(), cc)
				next.ServeHTTP(w, req.WithContext(ctx))
			})
		})
	}
	r.Post("/jobs", h.JobHandlers().CreateJob)
	return r
}

// doPost fires a POST request and returns the recorder.
func doPost(t *testing.T, router http.Handler, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var bodyReader *bytes.Reader
	if body != "" {
		bodyReader = bytes.NewReader([]byte(body))
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(http.MethodPost, path, bodyReader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// validCreateBody returns the minimum JSON body every business-scenario
// happy-path test sends. Tests mutate one field to exercise one branch
// at a time.
func validCreateBody() string {
	return `{"title":"Backend Engineer","description":"Go + Postgres","work_mode":"remote","employment_type":"full_time","seniority":"senior"}`
}

// --- business scenarios ---------------------------------------------

// TestCreateJob_MissingCompanyContextReturns500 covers the fail-closed
// invariant: if no CompanyContext is in the request context the
// handler short-circuits 500 (NOT 401 -- a 401 would mislead the
// client into re-authenticating; the real failure is internal and
// must be loud).
func TestCreateJob_MissingCompanyContextReturns500(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	// No CompanyContext injected.
	router := chi.NewRouter()
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	router.Post("/jobs", h.JobHandlers().CreateJob)

	rec := doPost(t, router, "/jobs", validCreateBody(), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 (fail-closed), got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.createCalls != 0 {
		t.Errorf("Create must NOT be called without CompanyContext, got %d calls", repo.createCalls)
	}
	createJobAssertCatalogEnvelope(t, rec, httpjson.CodeInternalError)
}

// TestCreateJob_MalformedBodyReturns400 covers the JSON decode failure:
// a body that doesn't parse returns 400.
func TestCreateJob_MalformedBodyReturns400(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPost(t, router, "/jobs", `not-json{`, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid JSON body") {
		t.Errorf("body must name the failure, got %q", rec.Body.String())
	}
	createJobAssertCatalogEnvelope(t, rec, httpjson.CodeInvalidRequest)
}

// TestCreateJob_SuccessReturns201EditorView covers the spec scenario
// "201 body is the editor view": a successful POST returns 201 with
// the JobEditorViewDto (status=draft, updated_at, company{id,name}).
func TestCreateJob_SuccessReturns201EditorView(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updated := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		createOut: &entities.JobForUpdate{
			ID:             jobID,
			Title:          "Backend Engineer",
			Description:    "Go + Postgres",
			WorkMode:       valueobjects.Remote,
			EmploymentType: valueobjects.FullTime,
			Seniority:      valueobjects.SeniorSeniority,
			JobStatus:      valueobjects.Draft,
			SalaryCurrency: valueobjects.MXN,
			UpdatedAt:      updated,
			Company:        entities.CompanyRef{ID: companyID, Name: "Acme"},
		},
	}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})

	rec := doPost(t, router, "/jobs", validCreateBody(), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var view dtos.JobEditorViewDto
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode 201 body as JobEditorViewDto: %v", err)
	}
	if view.Status != "draft" {
		t.Errorf("view.Status: want %q, got %q", "draft", view.Status)
	}
	if !view.UpdatedAt.Equal(updated) {
		t.Errorf("view.UpdatedAt: want %v, got %v", updated, view.UpdatedAt)
	}
	if view.Company.ID != companyID.String() {
		t.Errorf("view.Company.ID: want %v, got %q", companyID, view.Company.ID)
	}
	if view.Company.Name != "Acme" {
		t.Errorf("view.Company.Name: want %q, got %q", "Acme", view.Company.Name)
	}
	if repo.createCalls != 1 {
		t.Errorf("Create calls: want 1, got %d", repo.createCalls)
	}
}

// TestCreateJob_ErrCompanyNotActiveReturns409 covers the spec scenario
// "non-active company is rejected with 409": the use case surfaces
// ErrCompanyNotActive (the postgres adapter mapped pgx.ErrNoRows to
// it) and the handler renders 409 with the typed body.
func TestCreateJob_ErrCompanyNotActiveReturns409(t *testing.T) {
	repo := &writeStubHandlerRepo{
		createErr: entities.ErrCompanyNotActive,
	}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})

	rec := doPost(t, router, "/jobs", validCreateBody(), nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "company is not active") {
		t.Errorf("body must name the failure, got %q", rec.Body.String())
	}
	createJobAssertCatalogEnvelope(t, rec, httpjson.CodeCompanyNotActive)
}

// TestCreateJob_ErrCompanyGoneReturns409 covers the defense-in-depth
// 23503 sentinel. ErrCompanyGone maps to CodeCompanyNotActive (same
// code as ErrCompanyNotActive) while preserving the distinct domain
// message "company is gone" — proving same outcome class ⇒ same code.
func TestCreateJob_ErrCompanyGoneReturns409(t *testing.T) {
	repo := &writeStubHandlerRepo{
		createErr: entities.ErrCompanyGone,
	}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})

	rec := doPost(t, router, "/jobs", validCreateBody(), nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "company is gone") {
		t.Errorf("body must name the failure, got %q", rec.Body.String())
	}
	// Same outcome class (company inactive/gone) ⇒ same code, different message.
	createJobAssertCatalogEnvelope(t, rec, httpjson.CodeCompanyNotActive)
}

// TestCreateJob_EmptyTitleReturns400 covers the use case step 1
// fail-fast: whitespace title surfaces ErrEmptyTitle -> 400.
func TestCreateJob_EmptyTitleReturns400(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})

	body := `{"title":"   ","description":"Go + Postgres","work_mode":"remote","employment_type":"full_time","seniority":"senior"}`
	rec := doPost(t, router, "/jobs", body, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "title must not be empty") {
		t.Errorf("body must name the failing field, got %q", rec.Body.String())
	}
	createJobAssertCatalogEnvelope(t, rec, httpjson.CodeInvalidRequest)
}

// TestCreateJob_EmptyDescriptionReturns400 mirrors the title case.
func TestCreateJob_EmptyDescriptionReturns400(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})

	body := `{"title":"X","description":"","work_mode":"remote","employment_type":"full_time","seniority":"senior"}`
	rec := doPost(t, router, "/jobs", body, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "description must not be empty") {
		t.Errorf("body must name the failing field, got %q", rec.Body.String())
	}
}

// TestCreateJob_UnknownVOReturns400 covers the use case step 2
// fail-fast: an unknown VO surfaces the matching sentinel -> 400.
func TestCreateJob_UnknownVOReturns400(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "unknown work_mode",
			body: `{"title":"X","description":"Y","work_mode":"telecommute","employment_type":"full_time","seniority":"senior"}`,
			want: "invalid work_mode",
		},
		{
			name: "unknown employment_type",
			body: `{"title":"X","description":"Y","work_mode":"remote","employment_type":"freelance","seniority":"senior"}`,
			want: "invalid employment_type",
		},
		{
			name: "unknown seniority",
			body: `{"title":"X","description":"Y","work_mode":"remote","employment_type":"full_time","seniority":"principal"}`,
			want: "invalid seniority",
		},
		{
			name: "unknown salary_currency",
			body: `{"title":"X","description":"Y","work_mode":"remote","employment_type":"full_time","seniority":"senior","salary_currency":"EUR"}`,
			want: "invalid salary_currency",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &writeStubHandlerRepo{}
			router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
				CompanyID: uuid.New(),
				Role:      companiesvalueobjects.RecruiterRole,
			})
			rec := doPost(t, router, "/jobs", tt.body, nil)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.want) {
				t.Errorf("body must contain %q, got %q", tt.want, rec.Body.String())
			}
		if repo.createCalls != 0 {
			t.Errorf("Create must NOT be called on bad VO, got %d calls", repo.createCalls)
		}
		createJobAssertCatalogEnvelope(t, rec, httpjson.CodeInvalidRequest)
		})
	}
}

// TestCreateJob_SalaryRangeReturns400 covers the use case step 4
// fail-fast: salary_min > salary_max (both present) -> 400.
func TestCreateJob_SalaryRangeReturns400(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})

	body := `{"title":"X","description":"Y","work_mode":"remote","employment_type":"full_time","seniority":"senior","salary_min":10000,"salary_max":5000}`
	rec := doPost(t, router, "/jobs", body, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "salary_min must be less than or equal to salary_max") {
		t.Errorf("body must name the failing rule, got %q", rec.Body.String())
	}
}

// TestCreateJob_BodyCompanyIDIgnored covers the spec scenario
// "company_id from body is ignored": the body carries a company_id
// field which the DTO silently drops; the use case never sees it;
// the repo receives the caller's CompanyContext company, not the body
// value.
func TestCreateJob_BodyCompanyIDIgnored(t *testing.T) {
	callerCompany := uuid.New()
	bodyCompany := uuid.New()
	jobID := uuid.New()
	updated := time.Now().UTC()

	repo := &writeStubHandlerRepo{
		createOut: &entities.JobForUpdate{
			ID:             jobID,
			Title:          "Backend Engineer",
			Description:    "Go + Postgres",
			WorkMode:       valueobjects.Remote,
			EmploymentType: valueobjects.FullTime,
			Seniority:      valueobjects.SeniorSeniority,
			JobStatus:      valueobjects.Draft,
			SalaryCurrency: valueobjects.MXN,
			UpdatedAt:      updated,
			Company:        entities.CompanyRef{ID: callerCompany, Name: "Acme"},
		},
	}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: callerCompany,
		Role:      companiesvalueobjects.RecruiterRole,
	})

	body := fmt.Sprintf(`{"title":"X","description":"Y","work_mode":"remote","employment_type":"full_time","seniority":"senior","company_id":"%s"}`, bodyCompany)
	rec := doPost(t, router, "/jobs", body, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.lastCreateCompany != callerCompany {
		t.Errorf("Create companyID: want callerCompany %v, got %v (body must be ignored)",
			callerCompany, repo.lastCreateCompany)
	}
}

// TestCreateJob_StatusFieldIgnored covers the spec scenario
// "status field is not accepted on create": a body with status
// "published" still produces status=draft on the response.
func TestCreateJob_StatusFieldIgnored(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updated := time.Now().UTC()

	repo := &writeStubHandlerRepo{
		createOut: &entities.JobForUpdate{
			ID:             jobID,
			Title:          "Backend Engineer",
			Description:    "Go + Postgres",
			WorkMode:       valueobjects.Remote,
			EmploymentType: valueobjects.FullTime,
			Seniority:      valueobjects.SeniorSeniority,
			JobStatus:      valueobjects.Draft,
			SalaryCurrency: valueobjects.MXN,
			UpdatedAt:      updated,
			Company:        entities.CompanyRef{ID: companyID, Name: "Acme"},
		},
	}
	router := newCreateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})

	body := `{"title":"X","description":"Y","work_mode":"remote","employment_type":"full_time","seniority":"senior","status":"published"}`
	rec := doPost(t, router, "/jobs", body, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var view dtos.JobEditorViewDto
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode 201 body: %v", err)
	}
	if view.Status != "draft" {
		t.Errorf("view.Status: want %q (body status ignored), got %q", "draft", view.Status)
	}
}

// --- route-boundary scenarios --------------------------------------

// TestCreateJob_UnauthenticatedReturns401 covers the spec scenario
// "no Authorization header returns 401". The gated POST must mount
// behind RequireAuth ahead of the handler.
func TestCreateJob_UnauthenticatedReturns401(t *testing.T) {
	repo := &writeStubHandlerRepo{}

	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	denyV := denyAllVerifier{err: errors.New("denied")}
	authMW := identityRequireAuth(denyV)

	r := chi.NewRouter()
	r.With(authMW).Post("/jobs", h.JobHandlers().CreateJob)

	rec := doPost(t, r, "/jobs", validCreateBody(), nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.createCalls != 0 {
		t.Errorf("Create must NOT be called without auth, got %d calls", repo.createCalls)
	}
}

// TestCreateJob_POSTNotServedByPublicMount covers the spec scenario
// "POST /jobs is not reachable through the public mount": a POST
// against `/jobs` through the public `Routes()` mount (no gates)
// yields chi 405 (Method Not Allowed), proving the create route is
// NOT served by the public mount -- chi matches the path but no
// method for the mount's registered GET handlers. The spec phrase
// "not matched and the response is 404" applies to the global chi
// router when the path is completely unknown; when the path is
// known but the method isn't, chi returns 405. Both prove the
// route is not served by the public mount.
func TestCreateJob_POSTNotServedByPublicMount(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	r := chi.NewRouter()
	r.Mount("/jobs", h.Routes()) // PUBLIC mount only

	rec := doPost(t, r, "/jobs", validCreateBody(), nil)
	if rec.Code != http.StatusMethodNotAllowed && rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 or 405 (chi: POST not served by public mount), got %d: %s", rec.Code, rec.Body.String())
	}
	// Critically: the stub repo must NOT have been called -- the
	// handler never ran.
	if repo.createCalls != 0 {
		t.Errorf("Create must NOT be called when POST is routed through public mount, got %d calls", repo.createCalls)
	}
}

// TestCreateJob_GETStillPublicAfterHoist proves that the public read
// mount still serves GETs after the gated POST is added elsewhere.
// (The integration test in memberHandler_test.go also pins this; this
// is the jobs-side analog.)
func TestCreateJob_GETStillPublicAfterHoist(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	r := chi.NewRouter()
	r.Mount("/jobs", h.Routes())

	req := httptest.NewRequest(http.MethodGet, "/jobs", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("GET through public mount: want 200, got %d", rec.Code)
	}
}

// --- prevent unused-import drift -----------------------------------

// _ = bytes.NewReader keeps the bytes import live if a future test
// refactor drops the explicit body reader.
var _ = bytes.NewReader

// _ context.Context keeps the import live across test refactors.
var _ context.Context

// createJobAssertCatalogEnvelope checks that rec carries the catalog code field.
func createJobAssertCatalogEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantCode httpjson.Code) {
t.Helper()
var env httpjson.ErrorEnvelope
if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
t.Fatalf("body not JSON: %v", err)
}
if env.Code != wantCode {
t.Errorf("code: want %q, got %q", wantCode, env.Code)
}
}
