// Unit tests for the PATCH /me/company handler (companies-write slice,
// design §6.7 + D12 PATCH flow + D14 wiring).
//
// The handler is intentionally thin (the use case owns the
// validation, transition table, and CAS logic). The handler's only
// "smart" decisions are:
//   - the 500-on-missing-context fail-closed check (requireCompanyContext)
//   - the 409-with-view special-case (because classifyUpdateCompanyError
//     alone would render a generic {"error":"conflict"} body — the
//     spec R3 wire contract requires the editor view on both 200 and
//     409)
//
// Each test pins one of these decisions (or one boundary) so a
// regression surfaces as a single failing test.
package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// --- RED → GREEN scaffolding ----------------------------------------------

// stubUpdateService is a programmable stub of the CompanyService
// interface the PATCH handler depends on. The companies-write slice
// currently exposes the service as a concrete `*CompanyService`
// (no `Updater` interface), so the handler test exercises the
// concrete service via a stubbed repository — the same shape the
// existing companies handler tests use. This keeps the RED tests
// aligned with the production wiring.
type stubUpdateServiceRepo struct {
	mu sync.Mutex

	// Existing fields the concrete service expects:
	saved   *entities.Company
	saveErr error
	getByID *entities.Company
	getErr  error

	// UpdateCompany path fields:
	getForUpdateOut *entities.Company
	getForUpdateErr error

	updateCalls int
	updateID    uuid.UUID
	updatePatch repositories.UpdateCompanyPatch
	updateCas   time.Time
	updateEvent auditentities.AuditEvent
	updateErr   error

	updateView   *dtos.CompanyEditorViewDto
	updateRetErr error
}

func (s *stubUpdateServiceRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
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

func (s *stubUpdateServiceRepo) UpdateCompany(_ context.Context, companyID uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls++
	s.updateID = companyID
	s.updatePatch = patch
	s.updateCas = cas
	s.updateEvent = event
	return s.updateErr
}

// SoftDeleteCompany is not exercised by the PATCH tests; the stub
// returns ErrCompanyNotFound so the handler can never accidentally
// route to it (the handler is PATCH-only).
func (s *stubUpdateServiceRepo) SoftDeleteCompany(_ context.Context, _ uuid.UUID, _ time.Time, _ auditentities.AuditEvent) error {
	return errors.New("stubUpdateServiceRepo.SoftDeleteCompany: PATCH handler must not call SoftDeleteCompany")
}

func (s *stubUpdateServiceRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *stubUpdateServiceRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}

var _ repositories.CompanyRepository = (*stubUpdateServiceRepo)(nil)

// newUpdateRouter mounts a CompanyHandler wired against a real
// CompanyService that uses stubUpdateServiceRepo. The handler tests
// can then program stubUpdateServiceRepo's fields to drive the
// handler through its branches.
func newUpdateRouter(t *testing.T, repo *stubUpdateServiceRepo, cc identitysecurity.CompanyContext) http.Handler {
	t.Helper()
	svc := usecases.NewCompanyService(repo)
	h := NewCompanyHandler(svc)
	handlers := h.CompanyHandlers()
	r := chi.NewRouter()
	r.Route("/me/company", func(r chi.Router) {
		r.Patch("/", handlers.UpdateCompany)
	})
	return r
}

// doPatch issues a PATCH request with the supplied body + optional
// If-Unmodified-Since header. cc is injected into the request context
// (simulating the middleware).
func doPatch(t *testing.T, router http.Handler, body, casHeader string, cc identitysecurity.CompanyContext) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(http.MethodPatch, "/me/company", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(http.MethodPatch, "/me/company", nil)
	}
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

// --- 0. missing actor (uuid.Nil) fails closed with 500 via classifier --------

// TestUpdateCompanyHandler_MissingUserIDReturns500 pins the spec
// scenario "uuid.Nil actor fails closed with 500 and appends zero
// audit rows" (companies-audit design D6). The handler MUST pass the
// injected CompanyContext.UserID to the use case (NOT silently drop
// it). When the use case receives `userID == uuid.Nil`, its FIRST-step
// guard returns `ErrMissingActorIdentity`; the classifier maps the
// sentinel to 500 with a generic body (no existence leak).
//
// The stub's `updateEvent` capture field MUST remain zero-value (the
// use case never reaches `repo.UpdateCompany` on the guard path; the
// adapter would NEVER build the event either way because the use case
// does).
func TestUpdateCompanyHandler_MissingUserIDReturns500(t *testing.T) {
	repo := &stubUpdateServiceRepo{}
	companyID := uuid.New()
	// UserID is uuid.Nil — the FIRST-step guard fires.
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.Nil, Role: valueobjects.OwnerRole}
	router := newUpdateRouter(t, repo, cc)

	rec := doPatch(t, router, `{"name":"Acme"}`, "", cc)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 (fail-closed), got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.UpdateCompany MUST NOT be called on missing actor, got %d calls", repo.updateCalls)
	}
}

// --- 1. missing CompanyContext fails closed with 500 -------------------------

// TestUpdateCompanyHandler_MissingContextReturns500 pins the
// fail-closed invariant (canonical RequireCompanyContext): if the
// handler is reached without CompanyContext in the request
// (routing misconfiguration), the handler short-circuits with 500.
// The service MUST NOT be called (the company row stays untouched).
func TestUpdateCompanyHandler_MissingContextReturns500(t *testing.T) {
	repo := &stubUpdateServiceRepo{}
	router := newUpdateRouter(t, repo, identitysecurity.CompanyContext{}) // empty cc

	rec := doPatch(t, router, `{"name":"Acme"}`, "", identitysecurity.CompanyContext{})

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 (fail-closed), got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.updateCalls != 0 {
		t.Errorf("service.UpdateCompany MUST NOT be called on missing context, got %d calls", repo.updateCalls)
	}
}

// --- 2. invalid JSON returns 400 --------------------------------------------

// TestUpdateCompanyHandler_InvalidJSONReturns400 pins the malformed-
// body branch. A body with `{"name": 42}` (wrong type — name must be
// a string) returns 400 with body mentioning "invalid JSON body",
// and the service is NEVER called.
func TestUpdateCompanyHandler_InvalidJSONReturns400(t *testing.T) {
	repo := &stubUpdateServiceRepo{}
	companyID := uuid.New()
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newUpdateRouter(t, repo, cc)

	rec := doPatch(t, router, `{"name": 42}`, "", cc)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid JSON") {
		t.Errorf("expected body to mention 'invalid JSON', got: %s", rec.Body.String())
	}
	if repo.updateCalls != 0 {
		t.Errorf("service.UpdateCompany MUST NOT be called on invalid JSON, got %d calls", repo.updateCalls)
	}
}

// --- 3. CAS conflict returns 409 with the editor view ------------------------

// TestUpdateCompanyHandler_CASConflictReturns409WithView pins the
// "stale If-Unmodified-Since → 409 with the latest view" scenario
// (spec R2). The service returns (view, ErrConcurrencyConflict); the
// handler writes the view with 409 — NOT the generic
// {"error":"conflict"} envelope. The view is the redacted public
// shape (D8): NO `rfc`, `industry_id`, `status`, `deleted_at`,
// `created_at`.
func TestUpdateCompanyHandler_CASConflictReturns409WithView(t *testing.T) {
	row := mustCompany(uuid.New())
	repo := &stubUpdateServiceRepo{
		getForUpdateOut: row,
		updateErr:       entities.ErrConcurrencyConflict,
	}
	companyID := row.ID
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newUpdateRouter(t, repo, cc)

	casHeader := row.UpdatedAt.Format(time.RFC3339)

	// Service-side projection returns the editor view via the stub's
	// getForUpdateOut (the handler doesn't have a way to receive a
	// returned view from the service today; the test exercises the
	// spec contract through the unit use-case tests. Here we cover
	// the handler's responsibility: when the service returns
	// ErrConcurrencyConflict, the body MUST be the editor view
	// shape, NOT a {"error":"conflict"} envelope. The handler
	// re-projects via toCompanyEditorView in the service layer
	// (design D12 step 2).

	// For the handler test, we cover the "service returns the
	// sentinel; handler maps to 409 + a body that does NOT contain
	// the generic envelope" branch by asserting the response
	// status is 409 and the body is NOT `{"error":"conflict"}`.
	// The view-shape contract is pinned by the integration test in
	// WU5 + the unit use-case tests in WU4.
	rec := doPatch(t, router, `{"name":"Acme"}`, casHeader, cc)

	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	// The handler MUST write the editor view (not the generic
	// error envelope). The current PATCH stub returns
	// ErrConcurrencyConflict directly from the service; the
	// WU6 handler is expected to re-project toCompanyEditorView
	// in this branch. We assert the body is NOT the generic
	// envelope shape.
	if strings.HasPrefix(rec.Body.String(), `{"error":`) {
		t.Errorf("409 body must be the editor view, not the generic envelope: %s", rec.Body.String())
	}
}

// --- 4. immutable fields are silently dropped --------------------------------

// TestUpdateCompanyHandler_ImmutableFieldsSilentlyDropped pins the
// "rfc/industry_id/status in body are silently dropped" scenario
// (spec R1). The body sends rfc/industry_id/status, but the DTO
// has no such fields; the handler decodes the body into the DTO
// (unknown keys are silently dropped by encoding/json), the patch
// has no rfc/industry_id/status, and the row is updated with the
// non-immutable fields only.
func TestUpdateCompanyHandler_ImmutableFieldsSilentlyDropped(t *testing.T) {
	row := mustCompany(uuid.New())
	repo := &stubUpdateServiceRepo{
		getForUpdateOut: row,
	}
	companyID := row.ID
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newUpdateRouter(t, repo, cc)

	body := `{"rfc":"NEW123","industry_id":"industries_other","status":"suspended","name":"Acme SA de CV"}`
	casHeader := row.UpdatedAt.Format(time.RFC3339)
	rec := doPatch(t, router, body, casHeader, cc)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.updateCalls != 1 {
		t.Fatalf("service.UpdateCompany must be called exactly once, got %d", repo.updateCalls)
	}
	if repo.updatePatch.Name == nil || *repo.updatePatch.Name != "Acme SA de CV" {
		t.Errorf("patch.Name: want %q (passed through), got %v", "Acme SA de CV", repo.updatePatch.Name)
	}
	// The DTO has no rfc/industry_id/status field — the patch
	// cannot carry them; encoding/json silently drops unknown
	// keys.
}

// --- 5. success returns 200 with the view -------------------------------------

// TestUpdateCompanyHandler_SuccessReturns200 pins the success
// branch: matching CAS, valid body, the service returns nil; the
// handler writes 200 + the editor view (the body MUST carry
// `id`, `name`, `updated_at`; MUST NOT carry `rfc`, `industry_id`,
// `status`, `deleted_at`, `created_at`).
func TestUpdateCompanyHandler_SuccessReturns200(t *testing.T) {
	// The success path requires the stub to also return a
	// re-projected view (the handler re-projects via
	// toCompanyEditorView). Today the stub returns ErrNotFound
	// from GetCompanyForUpdate, so we wire the stub to return a
	// pre-loaded row + nil updateErr; the handler re-projects via
	// toCompanyEditorView after a successful update.
	companyID := uuid.New()
	updatedAt := time.Date(2026, 2, 1, 10, 5, 0, 0, time.UTC)
	row := &entities.Company{
		ID:         companyID,
		Name:       mustHandlerName(t, "Acme SA de CV"),
		Rfc:        mustHandlerRfc(t, "AAA010101AAA"),
		Status:     valueobjects.Active,
		IndustryID: "tech",
		UpdatedAt:  updatedAt,
		CreatedAt:  updatedAt.Add(-24 * time.Hour),
	}
	repo := &sequentialUpdateRepo{
		preUpdate:  row,
		postUpdate: row,
	}
	svc := usecases.NewCompanyService(repo)
	h := NewCompanyHandler(svc)
	handlers := h.CompanyHandlers()
	r := chi.NewRouter()
	r.Route("/me/company", func(r chi.Router) {
		r.Patch("/", handlers.UpdateCompany)
	})

	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	body := `{"name":"Renamed Co"}`
	casHeader := updatedAt.Format(time.RFC3339)
	rec := doPatch(t, r, body, casHeader, cc)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var view dtos.CompanyEditorViewDto
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if view.ID != companyID.String() {
		t.Errorf("view.ID: want %v, got %v", companyID, view.ID)
	}
	if view.Name != "Acme SA de CV" {
		t.Errorf("view.Name: %q", view.Name)
	}
	if !view.UpdatedAt.Equal(updatedAt) {
		t.Errorf("view.UpdatedAt: want %v, got %v", updatedAt, view.UpdatedAt)
	}

	// The wire shape MUST omit rfc / industry_id / status /
	// deleted_at / created_at (design D8 / spec R3).
	bodyStr := rec.Body.String()
	if strings.Contains(bodyStr, `"rfc"`) {
		t.Errorf("200 body must omit rfc: %s", bodyStr)
	}
	if strings.Contains(bodyStr, `"industry_id"`) {
		t.Errorf("200 body must omit industry_id: %s", bodyStr)
	}
	if strings.Contains(bodyStr, `"status"`) {
		t.Errorf("200 body must omit status: %s", bodyStr)
	}
	if strings.Contains(bodyStr, `"deleted_at"`) {
		t.Errorf("200 body must omit deleted_at: %s", bodyStr)
	}
	if strings.Contains(bodyStr, `"created_at"`) {
		t.Errorf("200 body must omit created_at: %s", bodyStr)
	}
}

// sequentialUpdateRepo is the success-path stub: returns preUpdate
// on the first GetCompanyForUpdate call, postUpdate on the second;
// UpdateCompany returns nil and captures the patch.
//
// companies-audit WU2: also captures the audit event the use case
// forwarded (the handler-level "PassesCompanyUpdatedEvent" test
// asserts the captured event shape).
type sequentialUpdateRepo struct {
	preUpdate  *entities.Company
	postUpdate *entities.Company

	mu                sync.Mutex
	getForUpdateCalls int
	updateCalls       int
	updateID          uuid.UUID
	updatePatch       repositories.UpdateCompanyPatch
	updateCas         time.Time
	updateEvent       auditentities.AuditEvent
}

func (s *sequentialUpdateRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getForUpdateCalls++
	if s.getForUpdateCalls == 1 && s.preUpdate != nil {
		copy := *s.preUpdate
		return &copy, nil
	}
	if s.getForUpdateCalls >= 2 && s.postUpdate != nil {
		copy := *s.postUpdate
		return &copy, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (s *sequentialUpdateRepo) UpdateCompany(_ context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls++
	s.updateID = id
	s.updatePatch = patch
	s.updateCas = cas
	s.updateEvent = event
	return nil
}

func (s *sequentialUpdateRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *sequentialUpdateRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}
func (s *sequentialUpdateRepo) SoftDeleteCompany(_ context.Context, _ uuid.UUID, _ time.Time, _ auditentities.AuditEvent) error {
	return nil
}

var _ repositories.CompanyRepository = (*sequentialUpdateRepo)(nil)

// --- 5b. handler passes a fully-built CompanyUpdated event to the repo --------

// TestUpdateCompanyHandler_PassesCompanyUpdatedEvent pins the
// transport contract: the handler does NOT build the AuditEvent
// value — the use case is the single source of truth (companies-audit
// design D5; spec scenario "handler does not build the event; use
// case is the single source of truth"). The handler passes
// CompanyContext.UserID and the request inputs to the use case; the
// use case builds the event via `newCompanyUpdatedEvent(eventID,
// companyID, userID)` and forwards it to `repo.UpdateCompany`. The
// stub captures the forwarded event; the test asserts the captured
// event has the expected shape:
//
//   - EventType == EventCompanyUpdated
//   - EntityType == EntityCompany (singular)
//   - EntityID == cc.CompanyID
//   - ActorType == ActorTypeUser
//   - ActorID != nil && *ActorID == cc.UserID
//   - Metadata is non-nil AND empty (the PATCH event carries no
//     diff; the 200 OK body already carries the post-write state)
func TestUpdateCompanyHandler_PassesCompanyUpdatedEvent(t *testing.T) {
	companyID := uuid.New()
	userID := uuid.New()
	updatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	row := &entities.Company{
		ID:         companyID,
		Name:       mustHandlerName(t, "Acme SA de CV"),
		Rfc:        mustHandlerRfc(t, "AAA010101AAA"),
		Status:     valueobjects.Active,
		IndustryID: "tech",
		UpdatedAt:  updatedAt,
		CreatedAt:  updatedAt.Add(-24 * time.Hour),
	}
	repo := &sequentialUpdateRepo{
		preUpdate:  row,
		postUpdate: row,
	}
	svc := usecases.NewCompanyService(repo)
	h := NewCompanyHandler(svc)
	handlers := h.CompanyHandlers()
	r := chi.NewRouter()
	r.Route("/me/company", func(r chi.Router) {
		r.Patch("/", handlers.UpdateCompany)
	})

	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: userID, Role: valueobjects.OwnerRole}
	body := `{"name":"Renamed Co"}`
	casHeader := updatedAt.Format(time.RFC3339)
	rec := doPatch(t, r, body, casHeader, cc)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	if repo.updateCalls != 1 {
		t.Fatalf("repo.UpdateCompany calls: want 1, got %d", repo.updateCalls)
	}

	got := repo.updateEvent
	if got.EventType != "CompanyUpdated" {
		t.Errorf("EventType: want CompanyUpdated, got %q", got.EventType)
	}
	if got.EntityType != "company" {
		t.Errorf("EntityType: want company (singular), got %q", got.EntityType)
	}
	if got.EntityID != companyID {
		t.Errorf("EntityID: want %v, got %v", companyID, got.EntityID)
	}
	if got.ActorType.String() != "user" {
		t.Errorf("ActorType: want user, got %q", got.ActorType.String())
	}
	if got.ActorID == nil {
		t.Fatalf("ActorID: want non-nil (user actor)")
	}
	if *got.ActorID != userID {
		t.Errorf("ActorID: want %v, got %v", userID, *got.ActorID)
	}
	if got.Metadata == nil {
		t.Fatal("Metadata: want non-nil empty map (JSONB `{}` invariant), got nil")
	}
	if len(got.Metadata) != 0 {
		t.Errorf("Metadata: want empty (len == 0), got %d keys: %v", len(got.Metadata), got.Metadata)
	}
}

// --- 6. company_id in body is ignored (IDOR defense) -------------------------

// TestUpdateCompanyHandler_CompanyIDInBodyIgnored pins the
// IDOR-resistant boundary (spec R1 — "company_id in body is
// ignored"). The body sends company_id=Y; the handler reads
// company_id exclusively from CompanyContext (which carries X).
// The PATCH targets company X only.
func TestUpdateCompanyHandler_CompanyIDInBodyIgnored(t *testing.T) {
	row := mustCompany(uuid.New())
	repo := &stubUpdateServiceRepo{
		getForUpdateOut: row,
	}
	companyID := row.ID
	foreignID := uuid.New()
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newUpdateRouter(t, repo, cc)

	body := `{"company_id":"` + foreignID.String() + `","name":"Acme"}`
	casHeader := row.UpdatedAt.Format(time.RFC3339)
	rec := doPatch(t, router, body, casHeader, cc)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.updateID != companyID {
		t.Errorf("service received id: want %v (CC), got %v (body — IGNORED)", companyID, repo.updateID)
	}
	if repo.updateID == foreignID {
		t.Errorf("service received foreign id — IDOR defense failed")
	}
}

// --- 7. NotFound returns 404 -------------------------------------------------

// TestUpdateCompanyHandler_NotFoundReturns404 pins the
// "non-existent / cross-company / soft-deleted → 404" scenario
// (spec R4 + R7). The service returns ErrCompanyNotFound from
// GetCompanyForUpdate; the handler maps to 404.
func TestUpdateCompanyHandler_NotFoundReturns404(t *testing.T) {
	repo := &stubUpdateServiceRepo{
		getForUpdateErr: entities.ErrCompanyNotFound,
	}
	companyID := uuid.New()
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newUpdateRouter(t, repo, cc)

	rec := doPatch(t, router, `{"name":"Acme"}`, "", cc)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "company not found") {
		t.Errorf("want body to mention 'company not found', got: %s", rec.Body.String())
	}
}

// --- 8. VO failures map to 400 via the classifier ---------------------------

// TestUpdateCompanyHandler_VOFailureReturns400 is parameterized over
// every VO-level sentinel the use case can surface. The handler
// classifies each via classifyUpdateCompanyError (D14 mapping).
func TestUpdateCompanyHandler_VOFailureReturns400(t *testing.T) {
	tests := []struct {
		name    string
		repoErr error
		wantMsg string
	}{
		{"ErrCompanyNameTooShort → 400", valueobjects.ErrCompanyNameTooShort, "el nombre"},
		{"ErrInvalidCompanySize → 400", valueobjects.ErrInvalidCompanySize, "size"},
		{"ErrFoundedYearOutOfRange → 400", valueobjects.ErrFoundedYearOutOfRange, "fundación"},
		{"ErrCompanyDescriptionTooLong → 400", valueobjects.ErrCompanyDescriptionTooLong, "descripción"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			row := mustCompany(uuid.New())
			repo := &stubUpdateServiceRepo{
				getForUpdateOut: row,
				updateErr:       tc.repoErr,
			}
			companyID := row.ID
			cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
			router := newUpdateRouter(t, repo, cc)

			casHeader := row.UpdatedAt.Format(time.RFC3339)
			rec := doPatch(t, router, `{"name":"Acme"}`, casHeader, cc)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("want 400, got %d: %s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(strings.ToLower(rec.Body.String()), strings.ToLower(tc.wantMsg)) {
				t.Errorf("want body to mention %q, got: %s", tc.wantMsg, rec.Body.String())
			}
		})
	}
}

// --- helpers ---------------------------------------------------------------

// mustCompany builds a well-formed Company entity the stub can
// return from GetCompanyForUpdate so the use case proceeds past
// the read step into the VO check / update step.
func mustCompany(id uuid.UUID) *entities.Company {
	name, _ := valueobjects.NewCompanyName("Acme SA de CV")
	rfc, _ := valueobjects.NewCompanyRfc("AAA010101AAA")
	return &entities.Company{
		ID:         id,
		Name:       name,
		Rfc:        rfc,
		Status:     valueobjects.Active,
		IndustryID: "tech",
		UpdatedAt:  time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC),
	}
}

// silence unused import warnings on a no-op test surface.
var _ = bytes.NewBuffer

// mustHandlerName / mustHandlerRfc are local helpers (the http
// package cannot import the application/usecases test helpers
// directly; the value-object constructors are package-public).
func mustHandlerName(t *testing.T, raw string) valueobjects.CompanyName {
	t.Helper()
	n, err := valueobjects.NewCompanyName(raw)
	if err != nil {
		t.Fatalf("NewCompanyName(%q): %v", raw, err)
	}
	return n
}

func mustHandlerRfc(t *testing.T, raw string) valueobjects.CompanyRfc {
	t.Helper()
	r, err := valueobjects.NewCompanyRfc(raw)
	if err != nil {
		t.Fatalf("NewCompanyRfc(%q): %v", raw, err)
	}
	return r
}
