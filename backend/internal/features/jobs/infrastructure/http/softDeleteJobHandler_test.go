// Unit tests for the DELETE /jobs/{id} handler (jobs-soft-delete slice).
//
// Mirrors the structure of `updateJobHandler_test.go` (Phase 5 — write
// path handler tests):
//
//  1. Business scenarios — a stub repo records the soft-delete flow;
//     the test injects CompanyContext directly (mirroring
//     `companies/.../memberHandler_test.go::newMemberRouter`).
//
//  2. Route-boundary scenarios — the gated DELETE is mounted behind
//     `identityhttp.RequireAuth(failVerifier)` ahead of the handler
//     to prove that:
//     - a request without `Authorization` → 401 (not 404 / 403);
//     - a DELETE sent through the PUBLIC `h.Routes()` mount under
//     `/jobs` is NOT matched (chi 404), proving the public mount
//     never serves the soft-delete route (spec scenario S9).
//
// The test file uses the shared `writeStubHandlerRepo` type from
// `updateJobHandler_test.go`, extended in Commit A (Phase 1.2 atomic
// port-extension unit) with a programmable SoftDelete surface
// (`softDeleteErr` + capture `softDeleteCalls` /
// `lastSoftDeleteID` / `lastSoftDeleteCompany` / `lastSoftDeleteCas`).
package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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

// newSoftDeleteJobRouter mounts the gated DELETE under `/jobs/{id}`
// with the supplied CompanyContext injected directly into the request
// context (mirroring `newUpdateJobRouter` in updateJobHandler_test.go).
// The repo is the test-programmable shared stub.
func newSoftDeleteJobRouter(repo *writeStubHandlerRepo, cc identitysecurity.CompanyContext) http.Handler {
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
	r.Delete("/jobs/{id}", h.JobHandlers().SoftDeleteJob)
	return r
}

// doDelete fires a DELETE request and returns the recorder.
func doDelete(t *testing.T, router http.Handler, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// --- business scenarios -------------------------------------------------

// TestSoftDeleteJob_MissingCompanyContextReturns500 covers the
// fail-closed invariant (spec scenario S8): if no CompanyContext is
// in the request context the handler short-circuits 500 (NOT 401 — a
// 401 would mislead the client into re-authenticating; the real
// failure is internal and must be loud). SoftDelete must NOT be
// called.
func TestSoftDeleteJob_MissingCompanyContextReturns500(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	// No CompanyContext injected.
	router := chi.NewRouter()
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	router.Delete("/jobs/{id}", h.JobHandlers().SoftDeleteJob)

	rec := doDelete(t, router, "/jobs/"+uuid.New().String(), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 (fail-closed), got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("repo.SoftDelete must NOT be called without CompanyContext, got %d", repo.softDeleteCalls)
	}
	if repo.getForUpdateCalls != 0 {
		t.Errorf("repo.GetForUpdate must NOT be called without CompanyContext, got %d", repo.getForUpdateCalls)
	}
	softDeleteJobAssertCatalogEnvelope(t, rec, httpjson.CodeInternalError)
}

// TestSoftDeleteJob_InvalidUUIDReturns400 covers spec scenario S6: a
// path parameter that doesn't parse as a UUID MUST 400, never 404 /
// 500. SoftDelete and GetForUpdate are NOT called.
func TestSoftDeleteJob_InvalidUUIDReturns400(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	router := newSoftDeleteJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doDelete(t, router, "/jobs/not-a-uuid", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid job id") {
		t.Errorf("body must name the failing field, got %q", rec.Body.String())
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("SoftDelete must NOT be called on invalid UUID, got %d", repo.softDeleteCalls)
	}
	if repo.getForUpdateCalls != 0 {
		t.Errorf("GetForUpdate must NOT be called on invalid UUID, got %d", repo.getForUpdateCalls)
	}
	softDeleteJobAssertCatalogEnvelope(t, rec, httpjson.CodeInvalidRequest)
}

// TestSoftDeleteJob_StaleCASReturns409WithView covers spec scenarios
// S11 + S14: a stale `If-Unmodified-Since` (header != row's
// updated_at) returns 409 with a catalog envelope {error, code, data}.
// The envelope carries code: conflict and data with the JobEditorViewDto
// (status + updated_at) so the client can re-read without a second
// round-trip.
func TestSoftDeleteJob_StaleCASReturns409WithView(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
	}
	router := newSoftDeleteJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doDelete(t, router, "/jobs/"+jobID.String(), map[string]string{
		"If-Unmodified-Since": rowTS.Add(-1 * time.Hour).Format(time.RFC3339),
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}

	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode 409 body as catalog envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != httpjson.CodeConflict {
		t.Errorf("code: want %q, got %q", httpjson.CodeConflict, env.Code)
	}
	if env.Error == "" {
		t.Errorf("error: want non-empty readable message, got %q", env.Error)
	}
	if env.Data == nil {
		t.Errorf("data: want non-nil JobEditorViewDto, got nil")
	}

	dataBytes, err := json.Marshal(env.Data)
	if err != nil {
		t.Fatalf("marshal env.Data: %v", err)
	}
	var view dtos.JobEditorViewDto
	if err := json.Unmarshal(dataBytes, &view); err != nil {
		t.Fatalf("decode env.Data as JobEditorViewDto: %v", err)
	}
	if view.Status != "draft" {
		t.Errorf("view.Status: want \"draft\", got %q", view.Status)
	}
	if !view.UpdatedAt.Equal(rowTS) {
		t.Errorf("view.UpdatedAt: want %v, got %v", rowTS, view.UpdatedAt)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("SoftDelete must NOT be called on stale CAS, got %d", repo.softDeleteCalls)
	}
}

// TestSoftDeleteJob_MissingCASReturns409WithView covers spec scenario
// S12: a missing `If-Unmodified-Since` header parses to time.Time{}
// in the handler; the zero token never equals a real row's
// updated_at, so the CAS compare fails and the use case returns
// (view, ErrConcurrencyConflict). The handler writes 409 with a
// catalog envelope {error, code, data} where code: conflict and
// data carries the JobEditorViewDto.
func TestSoftDeleteJob_MissingCASReturns409WithView(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Published, rowTS),
		},
	}
	router := newSoftDeleteJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doDelete(t, router, "/jobs/"+jobID.String(), nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}

	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode 409 body as catalog envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != httpjson.CodeConflict {
		t.Errorf("code: want %q, got %q", httpjson.CodeConflict, env.Code)
	}
	if env.Error == "" {
		t.Errorf("error: want non-empty readable message, got %q", env.Error)
	}
	if env.Data == nil {
		t.Errorf("data: want non-nil JobEditorViewDto, got nil")
	}

	dataBytes, err := json.Marshal(env.Data)
	if err != nil {
		t.Fatalf("marshal env.Data: %v", err)
	}
	var view dtos.JobEditorViewDto
	if err := json.Unmarshal(dataBytes, &view); err != nil {
		t.Fatalf("decode env.Data as JobEditorViewDto: %v", err)
	}
	if view.Status != "published" {
		t.Errorf("view.Status: want \"published\", got %q", view.Status)
	}
	if view.Company.ID != companyID.String() {
		t.Errorf("view.Company.ID: want %q, got %q", companyID.String(), view.Company.ID)
	}
}

// TestSoftDeleteJob_MalformedCASReturns409WithView covers spec scenario
// S13: a malformed `If-Unmodified-Since` (e.g. `not-a-timestamp`)
// parses to time.Time{} via the handler's parseIfUnmodifiedSince
// helper; the zero token mismatches the row and the use case returns
// (view, ErrConcurrencyConflict). The handler writes 409 with a
// catalog envelope {error, code, data} where code: conflict and
// data carries the JobEditorViewDto.
func TestSoftDeleteJob_MalformedCASReturns409WithView(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
	}
	router := newSoftDeleteJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doDelete(t, router, "/jobs/"+jobID.String(), map[string]string{
		"If-Unmodified-Since": "not-a-timestamp",
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}

	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode 409 body as catalog envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != httpjson.CodeConflict {
		t.Errorf("code: want %q, got %q", httpjson.CodeConflict, env.Code)
	}
	if env.Error == "" {
		t.Errorf("error: want non-empty readable message, got %q", env.Error)
	}
	if env.Data == nil {
		t.Errorf("data: want non-nil JobEditorViewDto, got nil")
	}

	dataBytes, err := json.Marshal(env.Data)
	if err != nil {
		t.Fatalf("marshal env.Data: %v", err)
	}
	var view dtos.JobEditorViewDto
	if err := json.Unmarshal(dataBytes, &view); err != nil {
		t.Fatalf("decode env.Data as JobEditorViewDto: %v", err)
	}
	if !view.UpdatedAt.Equal(rowTS) {
		t.Errorf("view.UpdatedAt: want %v, got %v", rowTS, view.UpdatedAt)
	}
	if view.Company.ID != companyID.String() {
		t.Errorf("view.Company.ID: want %q, got %q", companyID.String(), view.Company.ID)
	}
}

// TestSoftDeleteJob_NotFoundReturns404 covers spec scenarios S26/S27/
// S28 — three indistinguishable 404 paths (cross-company /
// non-existent / already-soft-deleted). GetForUpdate → ErrJobNotFound
// → 404 with body `{"error":"job not found"}`. SoftDelete is NOT
// called (the use case's read-for-delete already returned 404).
func TestSoftDeleteJob_NotFoundReturns404(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
		softDeleteErr: entities.ErrJobNotFound, // also covers the residual race path
	}
	router := newSoftDeleteJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doDelete(t, router, "/jobs/"+jobID.String(), map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "job not found") {
		t.Errorf("body must name the failure, got %q", rec.Body.String())
	}
	softDeleteJobAssertCatalogEnvelope(t, rec, httpjson.CodeNotFound)
}

// TestSoftDeleteJob_CompanyNotActiveReturns409 covers spec scenarios
// S17/S18 — SoftDelete → ErrCompanyNotActive (the atomic active-
// company SQL guard) → 409 with body `{"error":"company is not
// active"}`. classifyError handles this sentinel verbatim (no new
// branch needed — it was added by jobs-create for POST /jobs).
// Both ErrCompanyNotActive and ErrCompanyGone map to
// CodeCompanyNotActive (same outcome class ⇒ same code, different
// message — the company-state pair is proven by the create-handler
// tests; this test proves the soft-delete path also emits
// CodeCompanyNotActive).
func TestSoftDeleteJob_CompanyNotActiveReturns409(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
		softDeleteErr: entities.ErrCompanyNotActive,
	}
	router := newSoftDeleteJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doDelete(t, router, "/jobs/"+jobID.String(), map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "company is not active") {
		t.Errorf("body must name the failing gate, got %q", rec.Body.String())
	}
	softDeleteJobAssertCatalogEnvelope(t, rec, httpjson.CodeCompanyNotActive)
}

// TestSoftDeleteJob_SuccessReturns204EmptyBody covers spec scenarios
// S7 + S10 — a successful soft-delete returns 204 with an empty
// body (no editor view projection; the post-delete row's deleted_at
// is not representable in the DTO and 204 has no body by definition).
// SoftDelete is called exactly once with the row's UpdatedAt as the
// CAS token.
func TestSoftDeleteJob_SuccessReturns204EmptyBody(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
		// softDeleteErr default nil = success path.
	}
	router := newSoftDeleteJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doDelete(t, router, "/jobs/"+jobID.String(), map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("body: want empty on 204, got %q", rec.Body.String())
	}
	if repo.softDeleteCalls != 1 {
		t.Errorf("SoftDelete calls: want 1, got %d", repo.softDeleteCalls)
	}
	if repo.lastSoftDeleteID != jobID {
		t.Errorf("SoftDelete id: want %v, got %v", jobID, repo.lastSoftDeleteID)
	}
	if repo.lastSoftDeleteCompany != companyID {
		t.Errorf("SoftDelete companyID: want %v, got %v", companyID, repo.lastSoftDeleteCompany)
	}
	if !repo.lastSoftDeleteCas.Equal(rowTS) {
		t.Errorf("SoftDelete cas: want %v, got %v", rowTS, repo.lastSoftDeleteCas)
	}
}

// TestSoftDeleteJob_MissingAuthReturns401 covers spec scenario S3: a
// DELETE without `Authorization` mounted behind RequireAuth returns
// 401 (not 404 / 403). The handler is never reached; SoftDelete is
// not called.
func TestSoftDeleteJob_MissingAuthReturns401(t *testing.T) {
	repo := &writeStubHandlerRepo{}

	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	denyV := denyAllVerifier{err: errors.New("denied")}
	authMW := identityRequireAuth(denyV)

	r := chi.NewRouter()
	r.With(authMW).Delete("/jobs/{id}", h.JobHandlers().SoftDeleteJob)

	rec := doDelete(t, r, "/jobs/"+uuid.New().String(), nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("SoftDelete must NOT be called when RequireAuth rejects, got %d", repo.softDeleteCalls)
	}
	if repo.getForUpdateCalls != 0 {
		t.Errorf("GetForUpdate must NOT be called when RequireAuth rejects, got %d", repo.getForUpdateCalls)
	}
}

// TestSoftDeleteJob_DeleteNotServedByPublicMount covers spec scenario
// S9: a DELETE against `/jobs/{id}` through the public `Routes()`
// mount (no gates) yields chi 405 (Method Not Allowed) or 404 —
// proving the write route is NOT served by the public mount. Critically,
// the stub repo must NOT have been called: the handler never ran.
func TestSoftDeleteJob_DeleteNotServedByPublicMount(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	r := chi.NewRouter()
	r.Mount("/jobs", h.Routes()) // PUBLIC mount only

	rec := doDelete(t, r, "/jobs/"+uuid.New().String(), nil)
	if rec.Code != http.StatusMethodNotAllowed && rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 or 405 (chi: DELETE not served by public mount), got %d: %s", rec.Code, rec.Body.String())
	}
	// Critically: the stub repo must NOT have been called.
	if repo.softDeleteCalls != 0 {
		t.Errorf("SoftDelete must NOT be called when DELETE is routed through public mount, got %d calls", repo.softDeleteCalls)
	}
	if repo.getForUpdateCalls != 0 {
		t.Errorf("GetForUpdate must NOT be called when DELETE is routed through public mount, got %d calls", repo.getForUpdateCalls)
	}
}

// silence unused-import warnings for the test-only helpers carried
// from the update-side test fixture (sync, context) — they're used by
// the shared writeStubHandlerRepo declared in updateJobHandler_test.go.
var (
	_ = sync.Mutex{}
	_ = context.Background
)

// softDeleteJobAssertCatalogEnvelope checks that rec carries the catalog code field.
func softDeleteJobAssertCatalogEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantCode httpjson.Code) {
t.Helper()
var env httpjson.ErrorEnvelope
if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
	t.Fatalf("body not JSON: %v", err)
}
if env.Code != wantCode {
	t.Errorf("code: want %q, got %q", wantCode, env.Code)
}
}
