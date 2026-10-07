// Unit tests for the private vacancy draft HTTP adapter (T4).
//
// The adapter is a thin transport over drafts.Store: it owns only the HTTP
// shape (strict body budget, header discipline, status/ETag/Idempotency-Replayed
// projection and the no-store cache header) and forwards identity, header and
// body verbatim to the store, which owns authorization, precondition
// comparison and persistence. These tests pin exactly that split with a
// recording fake store.
//
// The fake never reimplements drafts.Store semantics; it records the exact
// forwarded arguments and replays a canned Result/error. Every table entry
// asserts the contract status, the exact catalog code, the absence of error
// data and (for successes) the exact stored bytes.
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

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// --- recording fake store -------------------------------------------------

type draftCreateCall struct {
	CompanyID uuid.UUID
	ActorID   uuid.UUID
	Key       string
	Body      []byte
}

type draftGetCall struct {
	CompanyID uuid.UUID
	ActorID   uuid.UUID
	ID        uuid.UUID
}

type draftSaveCall struct {
	CompanyID uuid.UUID
	ActorID   uuid.UUID
	ID        uuid.UUID
	IfMatch   string
	Present   bool
	Body      []byte
}

type recordingDraftStore struct {
	createResult drafts.Result
	createErr    error
	getResult    drafts.Result
	getErr       error
	saveResult   drafts.Result
	saveErr      error

	creates []draftCreateCall
	gets    []draftGetCall
	saves   []draftSaveCall
}

func (s *recordingDraftStore) Create(_ context.Context, companyID, actorID uuid.UUID, key string, body []byte) (drafts.Result, error) {
	s.creates = append(s.creates, draftCreateCall{CompanyID: companyID, ActorID: actorID, Key: key, Body: bytes.Clone(body)})
	return s.createResult, s.createErr
}

func (s *recordingDraftStore) Get(_ context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	s.gets = append(s.gets, draftGetCall{CompanyID: companyID, ActorID: actorID, ID: id})
	return s.getResult, s.getErr
}

func (s *recordingDraftStore) Save(_ context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	s.saves = append(s.saves, draftSaveCall{CompanyID: companyID, ActorID: actorID, ID: id, IfMatch: ifMatch, Present: present, Body: bytes.Clone(body)})
	return s.saveResult, s.saveErr
}

// totalCalls counts every store invocation so a rejected request can prove it
// never reached persistence.
func (s *recordingDraftStore) totalCalls() int {
	return len(s.creates) + len(s.gets) + len(s.saves)
}

// --- router + request helpers ---------------------------------------------

// draftHandlersRouter mounts the three private routes behind NoStore and
// (when cc is non-nil) an injected CompanyContext, mirroring the production
// middleware order: cache header first, auth/authorization second.
func draftHandlersRouter(store drafts.Store, cc *identitysecurity.CompanyContext) http.Handler {
	handlers := NewDraftHandler(store).DraftHandlers()
	r := chi.NewRouter()
	r.Use(NoStore)
	if cc != nil {
		injected := *cc
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				ctx := identitysecurity.ContextWithCompanyContext(req.Context(), injected)
				next.ServeHTTP(w, req.WithContext(ctx))
			})
		})
	}
	r.Post("/me/company/job-drafts", handlers.CreateDraft)
	r.Get("/me/company/job-drafts/{id}", handlers.GetDraft)
	r.Patch("/me/company/job-drafts/{id}", handlers.SaveDraft)
	return r
}

// draftGatedRouter mounts the routes behind a gate that always answers itself,
// used to prove a pre-handler rejection still carries the no-store header.
func draftGatedRouter(store drafts.Store, gate http.HandlerFunc) http.Handler {
	handlers := NewDraftHandler(store).DraftHandlers()
	r := chi.NewRouter()
	r.Use(NoStore, func(http.Handler) http.Handler { return gate })
	r.Post("/me/company/job-drafts", handlers.CreateDraft)
	r.Get("/me/company/job-drafts/{id}", handlers.GetDraft)
	r.Patch("/me/company/job-drafts/{id}", handlers.SaveDraft)
	return r
}

func doDraft(t *testing.T, router http.Handler, method, path string, body []byte, headers map[string][]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	for key, values := range headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func assertNoStore(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store; body=%s", got, rec.Body.String())
	}
}

// assertCatalogError checks status, exact code, no response data and no-store.
func assertCatalogError(t *testing.T, rec *httptest.ResponseRecorder, status int, code httpjson.Code) {
	t.Helper()
	assertNoStore(t, rec)
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, status, rec.Body.String())
	}
	var env struct {
		Error string          `json:"error"`
		Code  string          `json:"code"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("error body is not a catalog envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != string(code) {
		t.Fatalf("code = %q, want %q; body=%s", env.Code, code, rec.Body.String())
	}
	if env.Error == "" {
		t.Fatalf("error message must be present; body=%s", rec.Body.String())
	}
	if len(env.Data) != 0 {
		t.Fatalf("draft error responses must carry no data (no DTO/editor leak); body=%s", rec.Body.String())
	}
}

const draftResponseBody = `{"schema_version":1,"id":"11111111-1111-1111-1111-111111111111","status":"draft","version":"1","fields":{}}`
const draftETag = `"jd-r1-11111111-1111-1111-1111-111111111111-v1"`

func draftTestContext() identitysecurity.CompanyContext {
	return identitysecurity.CompanyContext{
		CompanyID: uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		UserID:    uuid.MustParse("33333333-3333-3333-3333-333333333333"),
		Role:      companiesvalueobjects.RecruiterRole,
	}
}

// --- Create ---------------------------------------------------------------

func TestDraftHandler_Create_Success(t *testing.T) {
	store := &recordingDraftStore{createResult: drafts.Result{Body: []byte(draftResponseBody), ETag: draftETag}}
	cc := draftTestContext()
	rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPost, "/me/company/job-drafts",
		[]byte(`{"fields":{"title":"Go"}}`), map[string][]string{"Idempotency-Key": {"abc-123"}})

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != draftResponseBody {
		t.Fatalf("body = %q, want the exact stored bytes %q", rec.Body.String(), draftResponseBody)
	}
	if got := rec.Header().Get("ETag"); got != draftETag {
		t.Fatalf("ETag = %q, want %q", got, draftETag)
	}
	if got := rec.Header().Get("Idempotency-Replayed"); got != "false" {
		t.Fatalf("Idempotency-Replayed = %q, want \"false\"", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	assertNoStore(t, rec)

	if len(store.creates) != 1 || store.totalCalls() != 1 {
		t.Fatalf("store calls = %d total, %d create; want exactly one Create", store.totalCalls(), len(store.creates))
	}
	call := store.creates[0]
	if call.CompanyID != cc.CompanyID {
		t.Errorf("forwarded companyID = %s, want %s", call.CompanyID, cc.CompanyID)
	}
	if call.ActorID != cc.UserID {
		t.Errorf("forwarded actorID = %s, want %s", call.ActorID, cc.UserID)
	}
	if call.Key != "abc-123" {
		t.Errorf("forwarded key = %q, want %q", call.Key, "abc-123")
	}
	if string(call.Body) != `{"fields":{"title":"Go"}}` {
		t.Errorf("forwarded body = %q, want the raw request body", call.Body)
	}
}

func TestDraftHandler_Create_Replay(t *testing.T) {
	store := &recordingDraftStore{createResult: drafts.Result{Body: []byte(draftResponseBody), ETag: draftETag, Replayed: true}}
	cc := draftTestContext()
	rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPost, "/me/company/job-drafts",
		[]byte(`{"fields":{}}`), map[string][]string{"Idempotency-Key": {"abc-123"}})

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != draftResponseBody {
		t.Fatalf("replay body = %q, want the original stored bytes", rec.Body.String())
	}
	if got := rec.Header().Get("Idempotency-Replayed"); got != "true" {
		t.Fatalf("Idempotency-Replayed = %q, want \"true\"", got)
	}
	assertNoStore(t, rec)
}

func TestDraftHandler_Create_IdempotencyKeyRequired(t *testing.T) {
	store := &recordingDraftStore{}
	cc := draftTestContext()
	rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPost, "/me/company/job-drafts",
		[]byte(`{"fields":{}}`), nil)

	assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeIdempotencyKeyRequired)
	if store.totalCalls() != 0 {
		t.Fatalf("store must not be called without an idempotency key; got %d calls", store.totalCalls())
	}
}

func TestDraftHandler_Create_InvalidIdempotencyKey(t *testing.T) {
	tests := []struct {
		name    string
		headers map[string][]string
	}{
		{name: "present but empty", headers: map[string][]string{"Idempotency-Key": {""}}},
		{name: "duplicate lines", headers: map[string][]string{"Idempotency-Key": {"one", "two"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &recordingDraftStore{}
			cc := draftTestContext()
			rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPost, "/me/company/job-drafts",
				[]byte(`{"fields":{}}`), tt.headers)
			assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeInvalidIdempotencyKey)
			if store.totalCalls() != 0 {
				t.Fatalf("store must not be called for a malformed idempotency key; got %d calls", store.totalCalls())
			}
		})
	}
}

func TestDraftHandler_Create_BodyBudgetBeforeStore(t *testing.T) {
	store := &recordingDraftStore{}
	cc := draftTestContext()
	oversized := bytes.Repeat([]byte("a"), draftinput.MaxBodyBytes+1)
	rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPost, "/me/company/job-drafts",
		oversized, map[string][]string{"Idempotency-Key": {"abc-123"}})

	assertCatalogError(t, rec, http.StatusRequestEntityTooLarge, httpjson.CodePayloadTooLarge)
	if store.totalCalls() != 0 {
		t.Fatalf("an oversized body must be rejected before the store; got %d calls", store.totalCalls())
	}
}

func TestDraftHandler_Create_MissingCompanyContext(t *testing.T) {
	store := &recordingDraftStore{}
	rec := doDraft(t, draftHandlersRouter(store, nil), http.MethodPost, "/me/company/job-drafts",
		[]byte(`{"fields":{}}`), map[string][]string{"Idempotency-Key": {"abc-123"}})

	assertCatalogError(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	if store.totalCalls() != 0 {
		t.Fatalf("store must not be called without CompanyContext; got %d calls", store.totalCalls())
	}
}

// --- Get ------------------------------------------------------------------

func TestDraftHandler_Get_Success(t *testing.T) {
	store := &recordingDraftStore{getResult: drafts.Result{Body: []byte(draftResponseBody), ETag: draftETag}}
	cc := draftTestContext()
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodGet, "/me/company/job-drafts/"+id.String(), nil, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != draftResponseBody {
		t.Fatalf("body = %q, want the exact stored bytes", rec.Body.String())
	}
	if got := rec.Header().Get("ETag"); got != draftETag {
		t.Fatalf("ETag = %q, want %q", got, draftETag)
	}
	if got := rec.Header().Get("Idempotency-Replayed"); got != "" {
		t.Fatalf("GET must not set Idempotency-Replayed; got %q", got)
	}
	assertNoStore(t, rec)

	if len(store.gets) != 1 || store.totalCalls() != 1 {
		t.Fatalf("want exactly one Get; got %d total calls", store.totalCalls())
	}
	call := store.gets[0]
	if call.CompanyID != cc.CompanyID || call.ActorID != cc.UserID || call.ID != id {
		t.Fatalf("forwarded (%s,%s,%s), want (%s,%s,%s)", call.CompanyID, call.ActorID, call.ID, cc.CompanyID, cc.UserID, id)
	}
}

func TestDraftHandler_Get_MalformedID(t *testing.T) {
	store := &recordingDraftStore{}
	cc := draftTestContext()
	rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodGet, "/me/company/job-drafts/not-a-uuid", nil, nil)

	assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	if store.totalCalls() != 0 {
		t.Fatalf("store must not be called for a malformed id; got %d calls", store.totalCalls())
	}
}

// --- Save -----------------------------------------------------------------

func TestDraftHandler_Save_Success(t *testing.T) {
	store := &recordingDraftStore{saveResult: drafts.Result{Body: []byte(draftResponseBody), ETag: draftETag}}
	cc := draftTestContext()
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPatch, "/me/company/job-drafts/"+id.String(),
		[]byte(`{"fields":{"title":"Go"}}`), map[string][]string{"If-Match": {draftETag}})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != draftResponseBody {
		t.Fatalf("body = %q, want the exact stored bytes", rec.Body.String())
	}
	if got := rec.Header().Get("ETag"); got != draftETag {
		t.Fatalf("ETag = %q, want %q", got, draftETag)
	}
	assertNoStore(t, rec)

	if len(store.saves) != 1 || store.totalCalls() != 1 {
		t.Fatalf("want exactly one Save; got %d total calls", store.totalCalls())
	}
	call := store.saves[0]
	if call.CompanyID != cc.CompanyID || call.ActorID != cc.UserID || call.ID != id {
		t.Fatalf("forwarded identity/id = (%s,%s,%s), want (%s,%s,%s)", call.CompanyID, call.ActorID, call.ID, cc.CompanyID, cc.UserID, id)
	}
	if call.IfMatch != draftETag || !call.Present {
		t.Fatalf("forwarded If-Match = (%q,%v), want (%q,true)", call.IfMatch, call.Present, draftETag)
	}
	if string(call.Body) != `{"fields":{"title":"Go"}}` {
		t.Fatalf("forwarded body = %q, want the raw request body", call.Body)
	}
}

func TestDraftHandler_Save_IfMatchForwarding(t *testing.T) {
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	tests := []struct {
		name        string
		headers     map[string][]string
		wantValue   string
		wantPresent bool
	}{
		{name: "absent", headers: nil, wantValue: "", wantPresent: false},
		{name: "present empty", headers: map[string][]string{"If-Match": {""}}, wantValue: "", wantPresent: true},
		{name: "repeated lines are flattened, never Header.Get", headers: map[string][]string{"If-Match": {`"a"`, `"b"`}}, wantValue: `"a","b"`, wantPresent: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &recordingDraftStore{}
			cc := draftTestContext()
			rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPatch, "/me/company/job-drafts/"+id.String(),
				[]byte(`{"fields":{}}`), tt.headers)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if len(store.saves) != 1 {
				t.Fatalf("want exactly one Save; got %d", len(store.saves))
			}
			if got := store.saves[0].IfMatch; got != tt.wantValue {
				t.Fatalf("forwarded If-Match = %q, want %q", got, tt.wantValue)
			}
			if got := store.saves[0].Present; got != tt.wantPresent {
				t.Fatalf("forwarded present = %v, want %v", got, tt.wantPresent)
			}
		})
	}
}

func TestDraftHandler_Save_MalformedID(t *testing.T) {
	store := &recordingDraftStore{}
	cc := draftTestContext()
	rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPatch, "/me/company/job-drafts/not-a-uuid",
		[]byte(`{"fields":{}}`), map[string][]string{"If-Match": {draftETag}})

	assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	if store.totalCalls() != 0 {
		t.Fatalf("store must not be called for a malformed id; got %d calls", store.totalCalls())
	}
}

// --- store sentinel projection --------------------------------------------

func TestClassifyDraftError_ContractMapping(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   httpjson.Code
	}{
		{name: "unauthenticated", err: drafts.ErrUnauthenticated, status: 401, code: httpjson.CodeUnauthenticated},
		{name: "forbidden", err: drafts.ErrForbidden, status: 403, code: httpjson.CodeForbidden},
		{name: "company inactive", err: drafts.ErrCompanyInactive, status: 403, code: httpjson.CodeCompanyInactive},
		{name: "company not active", err: drafts.ErrCompanyNotActive, status: 409, code: httpjson.CodeCompanyNotActive},
		{name: "not found", err: drafts.ErrNotFound, status: 404, code: httpjson.CodeNotFound},
		{name: "payload too large", err: drafts.ErrPayloadTooLarge, status: 413, code: httpjson.CodePayloadTooLarge},
		{name: "invalid request", err: drafts.ErrInvalidRequest, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "validation", err: drafts.ErrValidation, status: 400, code: httpjson.CodeValidationError},
		{name: "empty patch", err: drafts.ErrEmptyPatch, status: 400, code: httpjson.CodeEmptyPatch},
		{name: "idempotency key required", err: drafts.ErrIdempotencyKeyRequired, status: 400, code: httpjson.CodeIdempotencyKeyRequired},
		{name: "invalid idempotency key", err: drafts.ErrInvalidIdempotencyKey, status: 400, code: httpjson.CodeInvalidIdempotencyKey},
		{name: "idempotency conflict", err: drafts.ErrIdempotencyConflict, status: 409, code: httpjson.CodeIdempotencyConflict},
		{name: "precondition required", err: drafts.ErrPreconditionRequired, status: 428, code: httpjson.CodePreconditionRequired},
		{name: "version conflict", err: drafts.ErrVersionConflict, status: 412, code: httpjson.CodeVersionConflict},
		{name: "version overflow is a server fault", err: drafts.ErrVersionOverflow, status: 500, code: httpjson.CodeInternalError},
		{name: "unknown error is a server fault", err: errors.New("boom"), status: 500, code: httpjson.CodeInternalError},
		{name: "wrapped sentinel still matches", err: fmt.Errorf("store: %w", drafts.ErrNotFound), status: 404, code: httpjson.CodeNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := classifyDraftError(tt.err)
			if def.Status != tt.status || def.Code != tt.code {
				t.Fatalf("classifyDraftError(%v) = %d/%s, want %d/%s", tt.err, def.Status, def.Code, tt.status, tt.code)
			}
		})
	}
}

func TestDraftHandler_StoreErrorsProjectedWithoutData(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   httpjson.Code
	}{
		{name: "not found", err: drafts.ErrNotFound, status: 404, code: httpjson.CodeNotFound},
		{name: "precondition required", err: drafts.ErrPreconditionRequired, status: 428, code: httpjson.CodePreconditionRequired},
		{name: "version conflict", err: drafts.ErrVersionConflict, status: 412, code: httpjson.CodeVersionConflict},
		{name: "idempotency conflict", err: drafts.ErrIdempotencyConflict, status: 409, code: httpjson.CodeIdempotencyConflict},
		{name: "validation", err: drafts.ErrValidation, status: 400, code: httpjson.CodeValidationError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &recordingDraftStore{getErr: tt.err, saveErr: tt.err}
			cc := draftTestContext()
			id := uuid.MustParse("11111111-1111-1111-1111-111111111111")

			getRec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodGet, "/me/company/job-drafts/"+id.String(), nil, nil)
			assertCatalogError(t, getRec, tt.status, tt.code)

			saveRec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPatch, "/me/company/job-drafts/"+id.String(),
				[]byte(`{"fields":{}}`), map[string][]string{"If-Match": {draftETag}})
			assertCatalogError(t, saveRec, tt.status, tt.code)
		})
	}
}

// --- no-store on pre-handler rejection ------------------------------------

func TestDraftHandler_NoStoreOnMiddlewareRejection(t *testing.T) {
	tests := []struct {
		name   string
		gate   http.HandlerFunc
		status int
		code   httpjson.Code
	}{
		{
			name: "401 unauthenticated",
			gate: func(w http.ResponseWriter, _ *http.Request) {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
			},
			status: http.StatusUnauthorized, code: httpjson.CodeUnauthenticated,
		},
		{
			name: "403 forbidden",
			gate: func(w http.ResponseWriter, _ *http.Request) {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeForbidden))
			},
			status: http.StatusForbidden, code: httpjson.CodeForbidden,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &recordingDraftStore{}
			rec := doDraft(t, draftGatedRouter(store, tt.gate), http.MethodPost, "/me/company/job-drafts",
				[]byte(`{"fields":{}}`), map[string][]string{"Idempotency-Key": {"abc-123"}})
			assertCatalogError(t, rec, tt.status, tt.code)
			if store.totalCalls() != 0 {
				t.Fatalf("a gated rejection must not reach the store; got %d calls", store.totalCalls())
			}
		})
	}
}

// --- body budget boundary -------------------------------------------------

func TestDraftHandler_BodyBudgetBoundary(t *testing.T) {
	tests := []struct {
		name   string
		length int
		status int
	}{
		{name: "exactly the budget is forwarded", length: draftinput.MaxBodyBytes, status: http.StatusCreated},
		{name: "one byte over is rejected", length: draftinput.MaxBodyBytes + 1, status: http.StatusRequestEntityTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &recordingDraftStore{createResult: drafts.Result{Body: []byte(draftResponseBody), ETag: draftETag}}
			cc := draftTestContext()
			body := []byte(`{"fields":{}}` + strings.Repeat(" ", tt.length-len(`{"fields":{}}`)))
			rec := doDraft(t, draftHandlersRouter(store, &cc), http.MethodPost, "/me/company/job-drafts",
				body, map[string][]string{"Idempotency-Key": {"abc-123"}})
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d", rec.Code, tt.status)
			}
			assertNoStore(t, rec)
			if tt.length == draftinput.MaxBodyBytes && string(store.creates[0].Body) != string(body) {
				t.Fatalf("an in-budget body must be forwarded verbatim")
			}
			if tt.length > draftinput.MaxBodyBytes && store.totalCalls() != 0 {
				t.Fatalf("an oversized body must not reach the store; got %d calls", store.totalCalls())
			}
		})
	}
}
