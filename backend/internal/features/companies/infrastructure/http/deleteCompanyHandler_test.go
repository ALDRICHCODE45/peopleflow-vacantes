// Unit tests for the DELETE /me/company handler (companies-write slice,
// design §6.7 + D12 DELETE flow + D14 wiring).
//
// The DELETE handler is intentionally thin (the use case owns the
// CAS + adapter tx). The handler's only "smart" decisions are:
//   - the 500-on-missing-context fail-closed check
//   - the 409-with-empty-body special-case (spec R4 / D12 DELETE
//     asymmetry: PATCH 409 carries the editor view; DELETE 409 is
//     intentionally empty because the success path is 204 and
//     the 409 body would only add transient state to the wire).
//   - the 204-on-success with empty body
//
// Each test pins one of these decisions.
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

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// stubDeleteServiceRepo is the DELETE-handler stub.
type stubDeleteServiceRepo struct {
	mu sync.Mutex

	// Legacy fields:
	saved   *entities.Company
	saveErr error
	getByID *entities.Company
	getErr  error

	// Delete path:
	getForUpdateOut *entities.Company
	getForUpdateErr error

	softDeleteCalls int
	softDeleteID    uuid.UUID
	softDeleteCas   time.Time
	softDeleteErr   error
}

func (s *stubDeleteServiceRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getForUpdateErr != nil {
		return nil, s.getForUpdateErr
	}
	if s.getForUpdateOut != nil {
		copy := *s.getForUpdateOut
		return &copy, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (s *stubDeleteServiceRepo) SoftDeleteCompany(_ context.Context, id uuid.UUID, cas time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.softDeleteCalls++
	s.softDeleteID = id
	s.softDeleteCas = cas
	return s.softDeleteErr
}

// UpdateCompany must not be called by the DELETE handler.
func (s *stubDeleteServiceRepo) UpdateCompany(_ context.Context, _ uuid.UUID, _ repositories.UpdateCompanyPatch, _ time.Time) error {
	return errors.New("stubDeleteServiceRepo.UpdateCompany: DELETE handler must not call UpdateCompany")
}

func (s *stubDeleteServiceRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *stubDeleteServiceRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}

var _ repositories.CompanyRepository = (*stubDeleteServiceRepo)(nil)

// newDeleteRouter mounts a CompanyHandler with a DELETE route wired
// against a stubDeleteServiceRepo.
func newDeleteRouter(t *testing.T, repo *stubDeleteServiceRepo, cc identitysecurity.CompanyContext) http.Handler {
	t.Helper()
	svc := usecases.NewCompanyService(repo)
	h := NewCompanyHandler(svc)
	handlers := h.CompanyHandlers()
	r := chi.NewRouter()
	r.Route("/me/company", func(r chi.Router) {
		r.Delete("/", handlers.DeleteCompany)
	})
	return r
}

func doDelete(t *testing.T, router http.Handler, casHeader string, cc identitysecurity.CompanyContext) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodDelete, "/me/company", nil)
	if casHeader != "" {
		r.Header.Set("If-Unmodified-Since", casHeader)
	}
	if cc.CompanyID != uuid.Nil || cc.UserID != uuid.Nil {
		r = r.WithContext(identitysecurity.ContextWithCompanyContext(r.Context(), cc))
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, r)
	return rec
}

// --- 1. missing CompanyContext fails closed with 500 -------------------------

// TestDeleteCompanyHandler_MissingContextReturns500 pins the
// fail-closed invariant. No service call is made.
func TestDeleteCompanyHandler_MissingContextReturns500(t *testing.T) {
	repo := &stubDeleteServiceRepo{}
	router := newDeleteRouter(t, repo, identitysecurity.CompanyContext{})

	rec := doDelete(t, router, "", identitysecurity.CompanyContext{})

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 (fail-closed), got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("service.SoftDeleteCompany MUST NOT be called on missing context, got %d calls", repo.softDeleteCalls)
	}
}

// --- 2. CAS conflict returns 409 with an EMPTY body ---------------------------

// TestDeleteCompanyHandler_CASConflictReturns409EmptyBody pins the
// "stale If-Unmodified-Since → 409 with empty body" scenario
// (spec R5 / D12 DELETE asymmetry). The body is INTENTIONALLY empty
// (not the editor view, not the generic {"error":"conflict"}
// envelope) — the client re-reads via GET /me/company.
func TestDeleteCompanyHandler_CASConflictReturns409EmptyBody(t *testing.T) {
	row := mustCompany(uuid.New())
	repo := &stubDeleteServiceRepo{
		getForUpdateOut: row,
		softDeleteErr:   entities.ErrConcurrencyConflict,
	}
	companyID := row.ID
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newDeleteRouter(t, repo, cc)

	// Pass a stale CAS token (older than row.UpdatedAt) so the
	// use case's CAS compare mismatches BEFORE calling
	// SoftDeleteCompany.
	staleToken := row.UpdatedAt.Add(-1 * time.Hour).Format(time.RFC3339)
	rec := doDelete(t, router, staleToken, cc)

	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	// The body MUST be empty (no editor view, no {"error":"..."}).
	if rec.Body.Len() != 0 {
		t.Errorf("409 body MUST be empty (spec R4 / D12 DELETE asymmetry), got %q", rec.Body.String())
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("service.SoftDeleteCompany MUST NOT be called when the CAS mismatches, got %d calls", repo.softDeleteCalls)
	}
}

// --- 3. success returns 204 with empty body -----------------------------------

// TestDeleteCompanyHandler_SuccessReturns204 pins the
// "owner soft-deletes their company" scenario (spec R4). 204 with
// no body; no editor view is projected (D12 step 4).
func TestDeleteCompanyHandler_SuccessReturns204(t *testing.T) {
	row := mustCompany(uuid.New())
	repo := &stubDeleteServiceRepo{
		getForUpdateOut: row,
	}
	companyID := row.ID
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newDeleteRouter(t, repo, cc)

	casHeader := row.UpdatedAt.Format(time.RFC3339)
	rec := doDelete(t, router, casHeader, cc)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("204 body MUST be empty, got %q", rec.Body.String())
	}
	if repo.softDeleteCalls != 1 {
		t.Errorf("service.SoftDeleteCompany calls: want 1, got %d", repo.softDeleteCalls)
	}
	if repo.softDeleteID != companyID {
		t.Errorf("service received id: want %v (CC), got %v", companyID, repo.softDeleteID)
	}
	if !repo.softDeleteCas.Equal(row.UpdatedAt) {
		t.Errorf("service received cas: want %v, got %v", row.UpdatedAt, repo.softDeleteCas)
	}
}

// --- 4. NotFound returns 404 --------------------------------------------------

// TestDeleteCompanyHandler_NotFoundReturns404 pins the
// "non-existent / cross-company / soft-deleted → 404" scenario
// (spec R4 + R7).
func TestDeleteCompanyHandler_NotFoundReturns404(t *testing.T) {
	repo := &stubDeleteServiceRepo{
		getForUpdateErr: entities.ErrCompanyNotFound,
	}
	companyID := uuid.New()
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newDeleteRouter(t, repo, cc)

	rec := doDelete(t, router, "", cc)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "company not found") {
		t.Errorf("want body to mention 'company not found', got: %s", rec.Body.String())
	}
}

// --- 5. missing If-Unmodified-Since returns 409 -------------------------------

// TestDeleteCompanyHandler_MissingCASReturns409 pins the
// "missing If-Unmodified-Since → 409" scenario (spec R5). The
// parseIfUnmodifiedSince helper returns the zero time.Time{} for
// absent headers; the CAS compare then mismatches (a zero token
// never equals a real row's updated_at).
func TestDeleteCompanyHandler_MissingCASReturns409(t *testing.T) {
	repo := &stubDeleteServiceRepo{
		getForUpdateOut: mustCompany(uuid.New()),
	}
	companyID := uuid.New()
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newDeleteRouter(t, repo, cc)

	rec := doDelete(t, router, "", cc) // no CAS header

	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409 (missing CAS), got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("409 body MUST be empty (DELETE asymmetry), got %q", rec.Body.String())
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("service.SoftDeleteCompany MUST NOT be called when CAS is missing, got %d calls", repo.softDeleteCalls)
	}
}

// _ keeps the dtos import referenced even on a no-op file.
var _ = dtos.CompanyEditorViewDto{}

var _ = json.Unmarshal
