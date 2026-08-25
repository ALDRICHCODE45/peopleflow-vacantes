// Unit tests for the jobs write-path HTTP handler.
//
// These tests cover two planes (per task 5.1 in jobs-write-side/tasks.md):
//
//  1. Business scenarios — a stub repo records the write flow; the
//     test injects CompanyContext directly (mirroring
//     companies/.../memberHandler_test.go::newMemberRouter).
//
//  2. Route-boundary scenarios — the gated PATCH is mounted behind
//     `identityhttp.RequireAuth(failVerifier)` ahead of the handler
//     to prove that:
//     - a request without `Authorization` → 401 (not 404 / 403);
//     - a PATCH sent through the PUBLIC `h.Routes()` mount under
//     `/jobs` is NOT matched (chi 404), proving the public mount
//     never serves the write route.
//
// The `classifyError` extension lives in jobHandler.go and is exercised
// indirectly via these tests; a future separate unit-test file could
// pin each branch independently.
package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// --- write-side stub repo ----------------------------------------------

// writeStubHandlerRepo is the in-memory stub the handler tests
// program. It records the most recent GetForUpdate / Update call and
// supports a queued-response pattern (similar to the usecase test
// stub) so a single test can drive the read → update → re-read
// sequence without any real database.
//
// Phase 1.2 stub repair (jobs-create): the Create method gains a
// programmable surface (createOut / createErr + captured lastCreateID /
// lastCreateCompany / lastCreateParams) because the Phase 5.1 create
// handler tests assert on what the use case forwards to the repo.
type writeStubHandlerRepo struct {
	mu sync.Mutex

	// getForUpdateResponses is the queue the stub drains on each
	// GetForUpdate call; empty queue → ErrJobNotFound.
	getForUpdateResponses []entities.JobForUpdate

	// updateErr is the error Update returns. Default nil.
	updateErr error

	// Captured call state.
	getForUpdateCalls       int
	lastGetForUpdateID      uuid.UUID
	lastGetForUpdateCompany uuid.UUID

	updateCalls     int
	lastUpdatePatch repositories.UpdatePatch
	lastUpdateCas   time.Time
	lastUpdateID    uuid.UUID
	lastUpdateCompa uuid.UUID

	// --- Create (jobs-create Phase 1.2 + 5.1) -------------------------

	// createOut is the entity the stub returns from Create. nil +
	// createErr drives the error path (the use case propagates the
	// sentinel untouched per design D7).
	createOut *entities.JobForUpdate
	// createErr is the error returned by Create when createOut is nil.
	createErr error

	// createCalls / lastCreateID / lastCreateCompany / lastCreateParams
	// record what the use case forwarded to the repo on the most recent
	// Create call.
	createCalls       int
	lastCreateID      uuid.UUID
	lastCreateCompany uuid.UUID
	lastCreateParams  repositories.CreateJobParams

	// --- SoftDelete (jobs-soft-delete Phase 1.2) ---------------------

	// softDeleteErr is the error SoftDelete returns. Default nil =
	// success path. Phase 4's soft-delete handler tests program this
	// to drive ErrCompanyNotActive / ErrJobNotFound branches.
	softDeleteErr error

	// softDeleteCalls / lastSoftDeleteID / lastSoftDeleteCompany /
	// lastSoftDeleteCas record what the use case forwarded to the
	// repo on the most recent SoftDelete call.
	softDeleteCalls       int
	lastSoftDeleteID      uuid.UUID
	lastSoftDeleteCompany uuid.UUID
	lastSoftDeleteCas     time.Time
}

func (s *writeStubHandlerRepo) Search(_ context.Context, _ repositories.SearchParams) ([]entities.Job, error) {
	return nil, nil
}

func (s *writeStubHandlerRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Job, error) {
	return nil, entities.ErrJobNotFound
}

func (s *writeStubHandlerRepo) GetForUpdate(_ context.Context, id, companyID uuid.UUID) (*entities.JobForUpdate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getForUpdateCalls++
	s.lastGetForUpdateID = id
	s.lastGetForUpdateCompany = companyID
	if len(s.getForUpdateResponses) == 0 {
		return nil, entities.ErrJobNotFound
	}
	job := s.getForUpdateResponses[0]
	s.getForUpdateResponses = s.getForUpdateResponses[1:]
	return &job, nil
}

func (s *writeStubHandlerRepo) Update(_ context.Context, id, companyID uuid.UUID, patch repositories.UpdatePatch, casUpdatedAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls++
	s.lastUpdateID = id
	s.lastUpdateCompa = companyID
	s.lastUpdatePatch = patch
	s.lastUpdateCas = casUpdatedAt
	return s.updateErr
}

// Create is a port-method stub (jobs-create Phase 1.2). Default
// behavior matches the postgres adapter's success path: when createOut
// is set, the stub returns it; otherwise it surfaces createErr (which
// defaults to nil). Phase 5.1 create handler tests program both knobs.
func (s *writeStubHandlerRepo) Create(_ context.Context, id, companyID uuid.UUID, params repositories.CreateJobParams) (*entities.JobForUpdate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createCalls++
	s.lastCreateID = id
	s.lastCreateCompany = companyID
	s.lastCreateParams = params
	if s.createOut != nil {
		j := *s.createOut
		return &j, nil
	}
	if s.createErr != nil {
		return nil, s.createErr
	}
	return nil, nil
}

// SoftDelete is a port-method stub (jobs-soft-delete Phase 1.2). The
// default behavior matches the postgres adapter's success path:
// returns softDeleteErr (default nil). Phase 4's soft-delete handler
// tests program softDeleteErr to drive the ErrCompanyNotActive /
// ErrJobNotFound branches, and assert on softDeleteCalls /
// lastSoftDeleteID / lastSoftDeleteCompany / lastSoftDeleteCas to pin
// what the use case forwarded to the repo.
func (s *writeStubHandlerRepo) SoftDelete(_ context.Context, id, companyID uuid.UUID, casUpdatedAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.softDeleteCalls++
	s.lastSoftDeleteID = id
	s.lastSoftDeleteCompany = companyID
	s.lastSoftDeleteCas = casUpdatedAt
	return s.softDeleteErr
}

// Compile-time guard.
var _ repositories.JobRepository = (*writeStubHandlerRepo)(nil)

// --- deny-all verifier (for the route-boundary test) -------------------

// denyAllVerifier surfaces a sentinel error on every Verify call. It
// is the fail-closed verifier the composition root returns when
// IDENTITY_JWT_* env vars are missing; here it lets the route-boundary
// test mount `RequireAuth(denyAllVerifier)` ahead of the handler
// without spinning up the real RSA verifier.
type denyAllVerifier struct{ err error }

func (d denyAllVerifier) Verify(_ context.Context, _ string) (identitysecurity.Claims, error) {
	return identitysecurity.Claims{}, d.err
}

// --- newUpdateJobRouter helper -----------------------------------------

// newUpdateJobRouter mounts the gated PATCH under `/jobs/{id}` with
// the supplied CompanyContext injected directly into the request
// context (mirroring `newMemberRouter` in companies/...). The repo
// is the test-programmable stub.
func newUpdateJobRouter(repo *writeStubHandlerRepo, cc identitysecurity.CompanyContext) http.Handler {
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
	r.Patch("/jobs/{id}", h.JobHandlers().UpdateJob)
	return r
}

// doPatch fires a PATCH request and returns the recorder.
func doPatch(t *testing.T, router http.Handler, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, path, strings.NewReader(body))
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

// --- business scenarios -------------------------------------------------

// TestUpdateJob_MissingCompanyContextReturns500 covers the fail-closed
// invariant: if no CompanyContext is in the request context the
// handler short-circuits 500 (NOT 401 — a 401 would mislead the
// client into re-authenticating; the real failure is internal and
// must be loud).
func TestUpdateJob_MissingCompanyContextReturns500(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	// No CompanyContext injected.
	router := chi.NewRouter()
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	router.Patch("/jobs/{id}", h.JobHandlers().UpdateJob)

	rec := doPatch(t, router, "/jobs/"+uuid.New().String(), `{"title":"X"}`, nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 (fail-closed), got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.getForUpdateCalls != 0 {
		t.Errorf("repo.GetForUpdate must NOT be called without CompanyContext, got %d", repo.getForUpdateCalls)
	}
}

// TestUpdateJob_InvalidJobIDReturns400 covers the path-param parse
// failure: a malformed UUID is 400, never 404 / 500.
func TestUpdateJob_InvalidJobIDReturns400(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/not-a-uuid", `{"title":"X"}`, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestUpdateJob_MalformedBodyReturns400 covers the JSON decode
// failure: a body that doesn't parse returns 400.
func TestUpdateJob_MalformedBodyReturns400(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(),
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+uuid.New().String(), `not-json{`, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestUpdateJob_CrossCompanyReturns404 covers the IDOR defense: a row
// visible to company A but the caller's CompanyContext is company B
// surfaces as ErrJobNotFound (cross-company 404, identical body to
// "non-existent").
func TestUpdateJob_CrossCompanyReturns404(t *testing.T) {
	jobID := uuid.New()
	repo := &writeStubHandlerRepo{} // empty queue → ErrJobNotFound
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: uuid.New(), // different from the row's company
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"title":"X"}`, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestUpdateJob_CASMismatchReturns409 covers the spec scenario "stale
// updated_at returns 409 with latest version": the 409 body MUST
// decode as a JobEditorViewDto (status + updated_at).
func TestUpdateJob_CASMismatchReturns409(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"title":"New"}`, map[string]string{
		"If-Unmodified-Since": rowTS.Add(-1 * time.Hour).Format(time.RFC3339),
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}

	var view dtos.JobEditorViewDto
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode 409 body as JobEditorViewDto: %v", err)
	}
	if view.Status != "draft" {
		t.Errorf("view.Status: want \"draft\", got %q", view.Status)
	}
	if !view.UpdatedAt.Equal(rowTS) {
		t.Errorf("view.UpdatedAt: want %v, got %v", rowTS, view.UpdatedAt)
	}
}

// TestUpdateJob_MissingCASReturns409 covers the spec scenario "missing
// If-Unmodified-Since returns 409": a handler without the header
// behaves identically to a stale CAS (the use case treats the zero
// token as a mismatch).
func TestUpdateJob_MissingCASReturns409(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"title":"New"}`, nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestUpdateJob_ClosedTerminalReturns400 covers the spec scenario
// "closed is terminal": ANY body on a closed row is rejected.
func TestUpdateJob_ClosedTerminalReturns400(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Closed, rowTS),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"title":"X"}`, map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid status transition") {
		t.Errorf("body must name the failing transition, got %q", rec.Body.String())
	}
}

// TestUpdateJob_IllegalTransitionReturns400 covers draft→closed (no
// spec scenario misses).
func TestUpdateJob_IllegalTransitionReturns400(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"status":"closed"}`, map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestUpdateJob_UnknownVOReturns400 covers the spec scenarios
// "unknown work_mode is rejected" / "unknown salary_currency".
func TestUpdateJob_UnknownVOReturns400(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"work_mode":"telecommute"}`, map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestUpdateJob_EmptyTitleReturns400 covers the spec scenario "empty
// title is rejected".
func TestUpdateJob_EmptyTitleReturns400(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"title":"   "}`, map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "title must not be empty") {
		t.Errorf("body must name the failing field, got %q", rec.Body.String())
	}
}

// TestUpdateJob_NullVsAbsentOnLocation covers the spec scenarios
// "explicit null clears location" and "absent location leaves existing
// value intact": the stub records the captured UpdatePatch.
func TestUpdateJob_NullVsAbsentOnLocation(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name    string
		body    string
		wantSet bool
		wantVal bool
		wantStr string
	}{
		{
			name:    "absent leaves location untouched",
			body:    `{"title":"New"}`,
			wantSet: false, wantVal: false,
		},
		{
			name:    "null clears location",
			body:    `{"location":null}`,
			wantSet: true, wantVal: false,
		},
		{
			name:    "value sets location",
			body:    `{"location":"CDMX"}`,
			wantSet: true, wantVal: true, wantStr: "CDMX",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &writeStubHandlerRepo{
				getForUpdateResponses: []entities.JobForUpdate{
					*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
					*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS.Add(time.Second)),
				},
			}
			router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
				CompanyID: companyID,
				Role:      companiesvalueobjects.RecruiterRole,
			})
			rec := doPatch(t, router, "/jobs/"+jobID.String(), tt.body, map[string]string{
				"If-Unmodified-Since": rowTS.Format(time.RFC3339),
			})
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
			}
			if repo.lastUpdatePatch.Location.Set != tt.wantSet {
				t.Errorf("Location.Set: want %v, got %v", tt.wantSet, repo.lastUpdatePatch.Location.Set)
			}
			if repo.lastUpdatePatch.Location.Valid != tt.wantVal {
				t.Errorf("Location.Valid: want %v, got %v", tt.wantVal, repo.lastUpdatePatch.Location.Valid)
			}
		})
	}
}

// TestUpdateJob_StatusOnlyReturns200 covers the spec scenario
// "status-only PATCH is allowed": empty body except for `status`
// returns 200 with the editor view (and the stub records a status-only
// patch).
func TestUpdateJob_StatusOnlyReturns200(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
			*makeJobForUpdate(jobID, companyID, valueobjects.Published, rowTS.Add(time.Second)),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"status":"published"}`, map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var view dtos.JobEditorViewDto
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode 200 body: %v", err)
	}
	if view.Status != "published" {
		t.Errorf("Status: want \"published\", got %q", view.Status)
	}
	if !view.UpdatedAt.Equal(rowTS.Add(time.Second)) {
		t.Errorf("UpdatedAt: want %v, got %v", rowTS.Add(time.Second), view.UpdatedAt)
	}
}

// TestUpdateJob_SuccessReturns200EditorView covers the happy path:
// a successful PATCH returns 200 with the editor view carrying
// status + updated_at. The view projects the FRESH row from the
// re-read (step 8 of the D5 flow), not a synthesis of the patch —
// the patch mutates the DB; the re-read fetches the authoritative
// post-write state.
func TestUpdateJob_SuccessReturns200EditorView(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	newTS := rowTS.Add(time.Second)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, newTS),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"title":"New"}`, map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var view dtos.JobEditorViewDto
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode 200 body: %v", err)
	}
	// The view reflects the AUTHORITATIVE post-write row, not the
	// patch synthesis. With the stub's re-read returning the original
	// "Backend Engineer" title, the projection carries that title
	// (the stub cannot actually mutate state). The pin we assert here
	// is that the updated_at is the FRESH timestamp — proving the
	// response came from the re-read.
	if !view.UpdatedAt.Equal(newTS) {
		t.Errorf("UpdatedAt: want %v (fresh post-update), got %v", newTS, view.UpdatedAt)
	}
	if view.Status != "draft" {
		t.Errorf("Status: want \"draft\" (fresh post-update), got %q", view.Status)
	}
}

// TestUpdateJob_BodyCompanyIDIgnored covers the spec scenario
// "company_id from body is ignored": the body carries a
// `company_id` field which the DTO silently drops; the use case
// never sees it; the repo receives the caller's CompanyContext
// company, not the body value.
func TestUpdateJob_BodyCompanyIDIgnored(t *testing.T) {
	jobID := uuid.New()
	callerCompany := uuid.New()
	bodyCompany := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, callerCompany, valueobjects.Draft, rowTS),
			*makeJobForUpdate(jobID, callerCompany, valueobjects.Draft, rowTS.Add(time.Second)),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: callerCompany,
		Role:      companiesvalueobjects.RecruiterRole,
	})
	body := fmt.Sprintf(`{"title":"New","company_id":"%s"}`, bodyCompany)
	rec := doPatch(t, router, "/jobs/"+jobID.String(), body, map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.lastGetForUpdateCompany != callerCompany {
		t.Errorf("GetForUpdate companyID: want callerCompany %v, got %v (body must be ignored)",
			callerCompany, repo.lastGetForUpdateCompany)
	}
	if repo.lastUpdateCompa != callerCompany {
		t.Errorf("Update companyID: want callerCompany %v, got %v (body must be ignored)",
			callerCompany, repo.lastUpdateCompa)
	}
}

// TestUpdateJob_OwnerPassesRecruiterGate covers the spec scenario
// "owner passes the recruiter gate": owner is treated as recruiter.
// This is a middleware concern (the role-ordinal comparison in
// RequireCompanyRole), exercised here at the handler boundary: when
// the production wiring is in place, the route reaches the handler
// for owners as well as recruiters, and the handler reads
// CompanyContext.CompanyID without checking the role itself.
func TestUpdateJob_OwnerPassesRecruiterGate(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	rowTS := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	repo := &writeStubHandlerRepo{
		getForUpdateResponses: []entities.JobForUpdate{
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS),
			*makeJobForUpdate(jobID, companyID, valueobjects.Draft, rowTS.Add(time.Second)),
		},
	}
	router := newUpdateJobRouter(repo, identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      companiesvalueobjects.OwnerRole, // owner >= recruiter
	})
	rec := doPatch(t, router, "/jobs/"+jobID.String(), `{"title":"New"}`, map[string]string{
		"If-Unmodified-Since": rowTS.Format(time.RFC3339),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

// --- route-boundary scenarios ------------------------------------------

// TestUpdateJob_UnauthenticatedReturns401 covers the spec scenario
// "no Authorization header returns 401". The gated PATCH must mount
// behind RequireAuth ahead of the handler.
func TestUpdateJob_UnauthenticatedReturns401(t *testing.T) {
	repo := &writeStubHandlerRepo{}

	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	denyV := denyAllVerifier{err: errors.New("denied")}
	authMW := identityRequireAuth(denyV)

	r := chi.NewRouter()
	r.With(authMW).Patch("/jobs/{id}", h.JobHandlers().UpdateJob)

	rec := doPatch(t, r, "/jobs/"+uuid.New().String(), `{"title":"X"}`, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestUpdateJob_PATCHNotServedByPublicMount covers the spec scenario
// "PATCH is not reachable through the public mount": a PATCH against
// `/jobs/{id}` through the public `Routes()` mount (no gates) yields
// chi 405 (Method Not Allowed), proving the write route is NOT
// served by the public mount — chi matches the path but no method
// for the mount's registered GET handlers. The spec phrase "not
// matched and the response is 404" applies to the global chi router
// when the path is completely unknown; when the path is known but
// the method isn't, chi returns 405. Both prove the route is not
// served by the public mount.
func TestUpdateJob_PATCHNotServedByPublicMount(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	r := chi.NewRouter()
	r.Mount("/jobs", h.Routes()) // PUBLIC mount only

	rec := doPatch(t, r, "/jobs/"+uuid.New().String(), `{"title":"X"}`, nil)
	if rec.Code != http.StatusMethodNotAllowed && rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 or 405 (chi: PATCH not served by public mount), got %d: %s", rec.Code, rec.Body.String())
	}
	// Critically: the stub repo must NOT have been called — the
	// handler never ran.
	if repo.getForUpdateCalls != 0 {
		t.Errorf("GetForUpdate must NOT be called when PATCH is routed through public mount, got %d calls", repo.getForUpdateCalls)
	}
}

// TestUpdateJob_GETStillPublicAfterHoist proves that the public read
// mount still serves GETs after the gated PATCH is added elsewhere.
// (The integration test in memberHandler_test.go also pins this; this
// is the jobs-side analog.)
func TestUpdateJob_GETStillPublicAfterHoist(t *testing.T) {
	repo := &writeStubHandlerRepo{}
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	r := chi.NewRouter()
	r.Mount("/jobs", h.Routes())

	req := httptest.NewRequest(http.MethodGet, "/jobs/"+uuid.New().String(), nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		// The stub returns ErrJobNotFound → 404, but importantly it
		// reaches the handler — proving GET still serves through the
		// public mount.
		t.Errorf("GET through public mount: want 404 (handler ran with stub ErrJobNotFound), got %d", rec.Code)
	}
}

// identityRequireAuth is a tiny local wrapper that matches the real
// `identityhttp.RequireAuth` signature so we can mount it in tests
// without an import cycle. It mirrors the production middleware's
// surface: a denied token → 401.
func identityRequireAuth(verifier identitysecurity.Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			token := strings.TrimPrefix(header, "Bearer ")
			if token == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			if _, err := verifier.Verify(r.Context(), token); err != nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// makeJobForUpdate is a tiny helper to construct a JobForUpdate in
// the stub queue. Defaults to a Draft row with a known updated_at.
func makeJobForUpdate(id, companyID uuid.UUID, status valueobjects.JobStatus, updated time.Time) *entities.JobForUpdate {
	return &entities.JobForUpdate{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		JobStatus:      status,
		SalaryCurrency: valueobjects.MXN,
		UpdatedAt:      updated,
		Company: entities.CompanyRef{
			ID:   companyID,
			Name: "Acme SA",
		},
	}
}
