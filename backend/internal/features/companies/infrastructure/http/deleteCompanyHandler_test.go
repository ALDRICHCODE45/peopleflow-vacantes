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
	"log/slog"
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
	rtmiddleware "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
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
	softDeleteEvent auditentities.AuditEvent
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

func (s *stubDeleteServiceRepo) SoftDeleteCompany(_ context.Context, id uuid.UUID, cas time.Time, event auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.softDeleteCalls++
	s.softDeleteID = id
	s.softDeleteCas = cas
	s.softDeleteEvent = event
	return s.softDeleteErr
}

// UpdateCompany must not be called by the DELETE handler.
func (s *stubDeleteServiceRepo) UpdateCompany(_ context.Context, _ uuid.UUID, _ repositories.UpdateCompanyPatch, _ time.Time, _ auditentities.AuditEvent) error {
	return errors.New("stubDeleteServiceRepo.UpdateCompany: DELETE handler must not call UpdateCompany")
}

func (s *stubDeleteServiceRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *stubDeleteServiceRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}

var _ repositories.CompanyRepository = (*stubDeleteServiceRepo)(nil)

// newDeleteRouter mounts a CompanyHandler with a DELETE route wired
// against a stubDeleteServiceRepo.
func newDeleteRouter(t *testing.T, repo *stubDeleteServiceRepo, _ identitysecurity.CompanyContext) http.Handler {
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

// --- 0. missing actor (uuid.Nil) fails closed with 500 via classifier --------

// TestDeleteCompanyHandler_MissingUserIDReturns500 pins the spec
// scenario "uuid.Nil actor fails closed with 500 and appends zero
// audit rows" (companies-audit design D6). The handler passes
// CompanyContext.UserID to the use case; when the use case receives
// `userID == uuid.Nil`, its FIRST-step guard returns
// `ErrMissingActorIdentity`; the classifier maps the sentinel to 500
// with a generic body.
func TestDeleteCompanyHandler_MissingUserIDReturns500(t *testing.T) {
	repo := &stubDeleteServiceRepo{}
	companyID := uuid.New()
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.Nil, Role: valueobjects.OwnerRole}
	router := newDeleteRouter(t, repo, cc)

	rec := doDelete(t, router, "", cc)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 (fail-closed), got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("repo.SoftDeleteCompany MUST NOT be called on missing actor, got %d calls", repo.softDeleteCalls)
	}
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
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode as catalog envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != httpjson.CodeInternalError {
		t.Errorf("code: want %q, got %q", httpjson.CodeInternalError, env.Code)
	}
	if env.Error == "" || strings.Contains(env.Error, "surprise") || strings.Contains(env.Error, "kaboom") {
		t.Errorf("error must be a generic catalog message, got %q", env.Error)
	}
}

// --- 2. CAS conflict returns 409 with catalog envelope --------------------------

// TestDeleteCompanyHandler_CASConflictReturns409WithEnvelope pins the
// "stale If-Unmodified-Since → 409 with catalog envelope" scenario
// (spec R5 / WS6A-2). The 409 body carries a stable catalog envelope
// `{"error":"conflict","code":"conflict"}` with `data` omitted
// (DELETE asymmetry: the 204 success path has no body, so the 409
// envelope carries only the code for client-logged parity).
func TestDeleteCompanyHandler_CASConflictReturns409WithEnvelope(t *testing.T) {
	row := mustCompany(uuid.New())
	repo := &stubDeleteServiceRepo{
		getForUpdateOut: row,
		softDeleteErr:   entities.ErrConcurrencyConflict,
	}
	companyID := row.ID
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	router := newDeleteRouter(t, repo, cc)

	staleToken := row.UpdatedAt.Add(-1 * time.Hour).Format(time.RFC3339)
	rec := doDelete(t, router, staleToken, cc)

	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode as catalog envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != httpjson.CodeConflict {
		t.Errorf("code: want %q, got %q", httpjson.CodeConflict, env.Code)
	}
	if env.Error == "" {
		t.Errorf("error field must be non-empty")
	}
	if env.Data != nil {
		t.Errorf("data: want omitted (nil), got %v", env.Data)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("service.SoftDeleteCompany MUST NOT be called on CAS mismatch, got %d calls", repo.softDeleteCalls)
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

// --- 3b. handler passes a fully-built CompanyDeleted event to the repo --------

// TestDeleteCompanyHandler_PassesCompanyDeletedEvent pins the
// transport contract: the handler does NOT build the AuditEvent
// value — the use case is the single source of truth (companies-audit
// design D5). The use case builds the CompanyDeleted event via
// `newCompanyDeletedEvent(eventID, companyID, userID)` with
// `Metadata: nil` (the explicit "finalize me" handshake — the
// adapter finalizes the `jobs_closed` scalar after the inline
// `CloseCompanyJobs` returns). The handler-level assertion covers the
// event STRUCTURE; the `jobs_closed` finalization is asserted in the
// unit test for `auditentities.CompanyDeletedMetadata` and the
// integration test for `SoftDeleteCompany`.
//
// The stub's `softDeleteEvent` capture field MUST carry the forwarded
// event with the expected shape:
//
//   - EventType == EventCompanyDeleted
//   - EntityType == EntityCompany (singular)
//   - EntityID == cc.CompanyID
//   - ActorType == ActorTypeUser
//   - ActorID != nil && *ActorID == cc.UserID
//   - Metadata == nil (the use case builds with nil; the adapter
//     finalizes inside the tx)
func TestDeleteCompanyHandler_PassesCompanyDeletedEvent(t *testing.T) {
	companyID := uuid.New()
	userID := uuid.New()
	updatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	row := mustCompany(companyID)
	row.UpdatedAt = updatedAt
	repo := &stubDeleteServiceRepo{
		getForUpdateOut: row,
	}
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: userID, Role: valueobjects.OwnerRole}
	router := newDeleteRouter(t, repo, cc)

	casHeader := updatedAt.Format(time.RFC3339)
	rec := doDelete(t, router, casHeader, cc)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.softDeleteCalls != 1 {
		t.Fatalf("repo.SoftDeleteCompany calls: want 1, got %d", repo.softDeleteCalls)
	}

	got := repo.softDeleteEvent
	if got.EventType != "CompanyDeleted" {
		t.Errorf("EventType: want CompanyDeleted, got %q", got.EventType)
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
	if got.Metadata != nil {
		t.Errorf("Metadata at build time: want nil (adapter finalizes), got %v", got.Metadata)
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
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode as catalog envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != httpjson.CodeConflict {
		t.Errorf("code: want %q, got %q", httpjson.CodeConflict, env.Code)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("service.SoftDeleteCompany MUST NOT be called when CAS is missing, got %d calls", repo.softDeleteCalls)
	}
}

// --- 5b. malformed If-Unmodified-Since returns 409 -----------------------------
//
// WS2D-A: malformed-CAS transport proof alongside the missing-header
// baseline. parseIfUnmodifiedSince collapses non-RFC3339 values to the
// zero time.Time{}; the CAS compare treats zero as a guaranteed
// mismatch — identical behavior to the missing-header case. The 409
// body is the catalog envelope with code=conflict, no data, and the
// repo is never invoked (DELETE 409 has no body per design D4.2 /
// D12 — PATCH 409 carries the redacted DTO in `data`).
func TestDeleteCompanyHandler_MalformedCASReturns409(t *testing.T) {
	row := mustCompany(uuid.New())
	companyID := uuid.New()
	cc := identitysecurity.CompanyContext{CompanyID: companyID, UserID: uuid.New(), Role: valueobjects.OwnerRole}

	cases := []struct {
		name      string
		casHeader string
	}{
		{"non-RFC3339 word", "not-a-timestamp"},
		{"RFC1123 instead of RFC3339", "Mon, 01 Jan 2026 10:00:00 GMT"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubDeleteServiceRepo{getForUpdateOut: row}
			router := newDeleteRouter(t, repo, cc)
			rec := doDelete(t, router, tc.casHeader, cc)

			if rec.Code != http.StatusConflict {
				t.Fatalf("malformed CAS %q: want 409, got %d: %s", tc.casHeader, rec.Code, rec.Body.String())
			}
			var env httpjson.ErrorEnvelope
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
			}
			if env.Code != httpjson.CodeConflict {
				t.Errorf("code: want %q, got %q", httpjson.CodeConflict, env.Code)
			}
			if env.Error == "" {
				t.Errorf("error field must be non-empty")
			}
			if env.Data != nil {
				t.Errorf("data: want omitted (DELETE asymmetry), got %v", env.Data)
			}
			if repo.softDeleteCalls != 0 {
				t.Errorf("service.SoftDeleteCompany MUST NOT be called on malformed CAS, got %d calls", repo.softDeleteCalls)
			}
		})
	}
}

// --- 5c. NotFound returns 404 with NO repo.SoftDeleteCompany call ------------
//
// WS2D-A zero-audit evidence for the 404 outcome. The 404 path
// short-circuits at GetCompanyForUpdate (no row), so the soft-delete
// transaction is never opened and no audit row can be appended. The
// unit-level no-call assertion is the only auditable evidence here;
// the live integration test
// (TestSoftDeleteCompany_LostCASAdapterPathAppendsZeroAudit) covers
// the orthogonal case where the transaction DID open but rolled
// back before the audit append.
func TestDeleteCompanyHandler_NotFoundReturns404NoRepoCall(t *testing.T) {
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
	if repo.softDeleteCalls != 0 {
		t.Errorf("404 path: service.SoftDeleteCompany MUST NOT be called (no transaction opened, no audit append possible), got %d calls", repo.softDeleteCalls)
	}
}

// _ keeps the dtos import referenced even on a no-op file.
var _ = dtos.CompanyEditorViewDto{}

var _ = json.Unmarshal

// --- internal_error branch: bounded, request-correlated, redacted logging ---

// TestDeleteCompanyHandler_InternalErrorLoggingCorrelatedAndRedacted pins the
// write-site logging contract for DELETE /me/company (same contract the
// create/get handlers already pin): when the use case surfaces an unexpected
// error, the handler answers generic 500 + catalog internal_error and emits
// exactly ONE auxiliary log record ("delete company failed") plus the runtime
// RequestObservability completion record. The auxiliary record's key set is
// closed (request_id/method/path/code_class), shares the chi request ID with
// the completion record, uses the matched route pattern as path, and the raw
// error text, the company_id, and any DSN/token detail never reach the logs.
// Mounted through the production-faithful chain chi RequestID → runtime
// RequestObservability → handler. No t.Parallel(): slog capture is
// process-global.
func TestDeleteCompanyHandler_InternalErrorLoggingCorrelatedAndRedacted(t *testing.T) {
	const fixedRequestID = "companies-delete-fixed-request-id"
	const auxMsg = "delete company failed"
	const completionMsg = "http request completed"

	row := mustCompany(uuid.New())
	cc := identitysecurity.CompanyContext{CompanyID: row.ID, UserID: uuid.New(), Role: valueobjects.OwnerRole}
	boom := errors.New("pg: delete failed: postgres://svc:hunter2@db.internal:5432/peopleflow token=abc123")
	repo := &stubDeleteServiceRepo{
		getForUpdateOut: row,
		softDeleteErr:   boom,
	}

	logBuf := captureCompanySlog(t)

	// Production-faithful chain: chi RequestID → runtime
	// RequestObservability → handler.
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(rtmiddleware.RequestObservability(
		slog.New(slog.NewJSONHandler(logBuf, &slog.HandlerOptions{Level: slog.LevelInfo})),
		nil,
	))
	handlers := NewCompanyHandler(usecases.NewCompanyService(repo)).CompanyHandlers()
	r.Delete("/me/company", handlers.DeleteCompany)

	req := httptest.NewRequest(http.MethodDelete, "/me/company", nil)
	req.Header.Set("If-Unmodified-Since", row.UpdatedAt.Format(time.RFC3339))
	req.Header.Set("X-Request-Id", fixedRequestID)
	req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), cc))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// The wire contract is unchanged: generic 500 + catalog internal_error.
	assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)

	// Exactly one auxiliary record + exactly one completion record.
	records := decodeCompanySlogRecords(t, logBuf)
	if len(records) != 2 {
		t.Fatalf("slog records = %d (%s), want exactly 2 (auxiliary + completion)",
			len(records), companyMsgList(records))
	}

	aux := companyRecordByMsg(t, records, auxMsg)
	for k := range aux {
		if !companyAuxAllowedKeys[k] {
			t.Errorf("auxiliary record has unbounded key %q (record %v)", k, aux)
		}
	}
	for k := range companyAuxAllowedKeys {
		if _, ok := aux[k]; !ok {
			t.Errorf("auxiliary record missing bounded key %q (record %v)", k, aux)
		}
	}
	if got, _ := aux["request_id"].(string); got != fixedRequestID {
		t.Errorf("auxiliary request_id = %q, want the fixed chi request ID %q", got, fixedRequestID)
	}
	if got, _ := aux["method"].(string); got != http.MethodDelete {
		t.Errorf("auxiliary method = %q, want %q", got, http.MethodDelete)
	}
	if got, _ := aux["path"].(string); got != "/me/company" {
		t.Errorf("auxiliary path = %q, want the matched chi route pattern %q (raw URL MUST NOT be logged)", got, "/me/company")
	}
	if got, _ := aux["code_class"].(string); got != string(httpjson.CodeInternalError) {
		t.Errorf("auxiliary code_class = %q, want %q", got, httpjson.CodeInternalError)
	}

	// The runtime completion record shares the same fixed request ID.
	comp := companyRecordByMsg(t, records, completionMsg)
	if got, _ := comp["request_id"].(string); got != fixedRequestID {
		t.Errorf("completion request_id = %q, want the same fixed ID %q shared with the auxiliary record", got, fixedRequestID)
	}
	if got, _ := comp["path"].(string); got != "/me/company" {
		t.Errorf("completion path = %q, want the matched chi route pattern %q", got, "/me/company")
	}
	if got, _ := comp["code_class"].(string); got != string(httpjson.CodeInternalError) {
		t.Errorf("completion code_class = %q, want %q", got, httpjson.CodeInternalError)
	}

	// Redaction across every captured log byte: the raw error text and every
	// concrete identifier paired with it never reach the logs.
	for _, forbidden := range []string{
		boom.Error(),
		"postgres://svc:hunter2@db.internal:5432/peopleflow",
		"token=abc123",
		row.ID.String(),
	} {
		if strings.Contains(logBuf.String(), forbidden) {
			t.Errorf("captured logs MUST NOT contain %q; logs=%s", forbidden, logBuf.String())
		}
	}
}
