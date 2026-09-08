package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	chimw "github.com/go-chi/chi/v5/middleware"

	candidatesdtos "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	candidatesusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// --- fakes -----------------------------------------------------------------

// stubCandidateRepo is a hand-rolled stub of the candidates repository
// port. It records the most recent inputs and returns whatever the
// test programmed into it. Kept in this package so the handler tests
// don't need to depend on anything outside.
type stubCandidateRepo struct {
	mu sync.Mutex

	upserted     *entities.CandidateProfile
	upsertErr    error
	getByIDOut   *entities.CandidateProfile
	getByIDErr   error
	listOut      []entities.Language
	listErr      error
	replacedWith []entities.Language
	replaceErr   error

	// Downstream-call counters for the decode-boundary non-vacuity gate:
	// every post-decode repository path must be observable so a test can
	// prove the decoder rejected the body before any use case ran.
	upsertCalls  int
	replaceCalls int
	listCalls    int
}

func (r *stubCandidateRepo) UpsertProfile(_ context.Context, p *entities.CandidateProfile) (*entities.CandidateProfile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.upsertCalls++
	if r.upsertErr != nil {
		return nil, r.upsertErr
	}
	r.upserted = p
	return p, nil
}

func (r *stubCandidateRepo) GetProfileByUserID(_ context.Context, _ uuid.UUID) (*entities.CandidateProfile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.getByIDErr != nil {
		return nil, r.getByIDErr
	}
	if r.getByIDOut != nil {
		return r.getByIDOut, nil
	}
	return nil, entities.ErrProfileNotFound
}

func (r *stubCandidateRepo) ListLanguagesByUserID(_ context.Context, _ uuid.UUID) ([]entities.Language, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listCalls++
	if r.listErr != nil {
		return nil, r.listErr
	}
	if r.listOut == nil {
		return []entities.Language{}, nil
	}
	out := make([]entities.Language, len(r.listOut))
	copy(out, r.listOut)
	return out, nil
}

func (r *stubCandidateRepo) ReplaceLanguagesByUserID(_ context.Context, _ uuid.UUID, langs []entities.Language) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.replaceCalls++
	if r.replaceErr != nil {
		return r.replaceErr
	}
	r.replacedWith = make([]entities.Language, len(langs))
	copy(r.replacedWith, langs)
	return nil
}

// stubUserRepo resolves the JWT subject to a fixed user ID. Setting
// resolved = nil (default) makes GetByCognitoSub return ErrUserNotFound,
// which the use case translates to ErrUnknownSubject → 401.
type stubUserRepo struct {
	mu         sync.Mutex
	resolved   *identityentities.User
	resolveErr error

	// getCalls counts GetByCognitoSub identity resolutions so decode-boundary
	// tests can prove no use case ran on a rejected body.
	getCalls int
}

func (r *stubUserRepo) GetByCognitoSub(_ context.Context, _ string) (*identityentities.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.getCalls++
	if r.resolveErr != nil {
		return nil, r.resolveErr
	}
	if r.resolved == nil {
		return nil, identityentities.ErrUserNotFound
	}
	return r.resolved, nil
}

func (r *stubUserRepo) Create(_ context.Context, _ *identityentities.User) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepo.Create: not used by candidates handler tests")
}

func (r *stubUserRepo) GetByID(_ context.Context, _ uuid.UUID) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepo.GetByID: not used by candidates handler tests")
}

// --- helpers ---------------------------------------------------------------

func newTestHandler(cRepo *stubCandidateRepo, uRepo *stubUserRepo) *CandidateHandler {
	svc := candidatesusecases.NewCandidateService(cRepo, uRepo)
	return NewCandidateHandler(svc)
}

func newTestRouter(h *CandidateHandler) *chi.Mux {
	r := chi.NewRouter()
	// Mount at the same prefix the production main.go uses. Tests that
	// need an authenticated caller attach identitysecurity.ContextWithClaims
	// directly on the request (bypassing the real auth middleware).
	r.Mount("/me/profile", h.Routes())
	return r
}

func authedRequest(t *testing.T, method, path, body, sub string) *http.Request {
	t.Helper()
	var bodyReader *strings.Reader
	if body == "" {
		bodyReader = strings.NewReader("")
	} else {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if sub != "" {
		req = req.WithContext(identitysecurity.ContextWithClaims(req.Context(), identitysecurity.Claims{
			Subject: sub,
		}))
	}
	return req
}

func doRequest(t *testing.T, router http.Handler, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// --- tests -----------------------------------------------------------------

// TestGetProfile_Ok covers the spec scenario "GET returns the caller's
// profile" from the HTTP boundary. The handler must read the JWT
// subject, resolve it through the use case, and return 200 with the
// stored profile echoed back.
func TestGetProfile_Ok(t *testing.T) {
	userID := uuid.New()
	stored, err := entities.NewCandidateProfile(userID.String(), entities.CandidateProfileInput{
		EducationLevel: "bachelor",
		Skills:         []string{"go", "aws"},
	})
	if err != nil {
		t.Fatalf("NewCandidateProfile: %v", err)
	}
	title := "Senior Backend Engineer"
	stored.ProfessionalTitle = &title

	cRepo := &stubCandidateRepo{getByIDOut: stored}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	rec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/", "", "sub-abc"))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got candidateProfileResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.UserID != userID.String() {
		t.Errorf("UserID: want %s, got %s", userID, got.UserID)
	}
	if got.ProfessionalTitle == nil || *got.ProfessionalTitle != title {
		t.Errorf("ProfessionalTitle: want %q, got %v", title, got.ProfessionalTitle)
	}
	if got.EducationLevel == nil || *got.EducationLevel != "bachelor" {
		t.Errorf("EducationLevel: want bachelor, got %v", got.EducationLevel)
	}
	if len(got.Skills) != 2 || got.Skills[0] != "go" || got.Skills[1] != "aws" {
		t.Errorf("Skills: %v", got.Skills)
	}
}

// TestGetProfile_NotFound covers the spec scenario "GET without a
// profile returns 404". The repository's ErrProfileNotFound must
// surface as 404 (never 5xx).
func TestGetProfile_NotFound(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{} // default: ErrProfileNotFound
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	rec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/", "", "sub-abc"))
	assertCatalogEnvelope(t, rec, http.StatusNotFound, httpjson.CodeNotFound)
}

// TestGetProfile_UnknownSubjectIsUnauthorized covers the spec scenario
// "unknown cognito_sub is not 5xx". A valid JWT whose sub does not
// match any live users row must surface as 401.
func TestGetProfile_UnknownSubjectIsUnauthorized(t *testing.T) {
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{} // default: ErrUserNotFound
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	rec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/", "", "missing-sub"))
	assertCatalogEnvelope(t, rec, http.StatusUnauthorized, httpjson.CodeUnauthenticated)
}

// TestUpsertProfile_Ok covers the spec scenario "PUT creates on first
// call" / "PUT is idempotent on repeat". The handler returns the
// persisted profile (echo) per the task description.
func TestUpsertProfile_Ok(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{
        "professional_title": "Backend Engineer",
        "education_level": "bachelor",
        "expected_salary_period": "monthly",
        "skills": ["Go", "AWS"]
    }`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got candidateProfileResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.UserID != userID.String() {
		t.Errorf("UserID: want %s, got %s", userID, got.UserID)
	}
	if got.ProfessionalTitle == nil || *got.ProfessionalTitle != "Backend Engineer" {
		t.Errorf("ProfessionalTitle: %v", got.ProfessionalTitle)
	}
	if got.EducationLevel == nil || *got.EducationLevel != "bachelor" {
		t.Errorf("EducationLevel: %v", got.EducationLevel)
	}
	// Skills are normalized to lowercase before write.
	if len(got.Skills) != 2 || got.Skills[0] != "go" || got.Skills[1] != "aws" {
		t.Errorf("Skills: want [go aws], got %v", got.Skills)
	}
}

// TestUpsertProfile_InvalidEducationLevel covers the spec scenario
// "invalid education_level is rejected". 400, no row written.
func TestUpsertProfile_InvalidEducationLevel(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"education_level": "vocational"}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "education") {
		t.Errorf("expected error mentioning education, got: %s", rec.Body.String())
	}
	assertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
}

// TestUpsertProfile_InvalidSalaryPeriod covers the spec scenario
// "invalid salary_period is rejected". 400, no row written.
func TestUpsertProfile_InvalidSalaryPeriod(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"expected_salary_period": "weekly"}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}

	if !strings.Contains(rec.Body.String(), "salary") {
		t.Errorf("expected error mentioning salary, got: %s", rec.Body.String())
	}
	assertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
}

// TestUpsertProfile_MalformedJSONReturns400 covers the spec scenario
// "malformed JSON body is rejected". The handler must decode the request
// body with json.Decoder and return a catalog envelope with
// code:invalid_request before any use-case invocation. An authenticated
// subject is provided so the malformed-body decoding path is reached.
func TestUpsertProfile_MalformedJSONReturns400(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	// Invalid JSON syntax triggers the decode error.
	body := `{bad`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
	assertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	if !strings.Contains(rec.Body.String(), "JSON") && !strings.Contains(rec.Body.String(), "invalid") {
		t.Errorf("expected readable safe error mentioning JSON or invalid, got: %s", rec.Body.String())
	}
}

// TestUpsertProfile_UnknownSubjectIsUnauthorized covers the IDOR
// invariant on PUT too: unknown sub → 401, never 5xx.
func TestUpsertProfile_UnknownSubjectIsUnauthorized(t *testing.T) {
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"professional_title": "Backend Engineer"}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "missing-sub"))
	assertCatalogEnvelope(t, rec, http.StatusUnauthorized, httpjson.CodeUnauthenticated)
}

// TestListLanguages_Ok covers the GET /me/profile/languages path. Empty
// results come back as a non-nil empty slice (JSON `[]`, not `null`).
func TestListLanguages_Ok(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{listOut: []entities.Language{
		{Name: "english", Level: valueobjects.B2},
		{Name: "spanish", Level: valueobjects.C1},
	}}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	rec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/languages/", "", "sub-abc"))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"english"`) {
		t.Errorf("expected response to mention english, got: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"spanish"`) {
		t.Errorf("expected response to mention spanish, got: %s", rec.Body.String())
	}
}

// TestListLanguages_UnknownSubjectIsUnauthorized proves that an unknown JWT
// subject is classified as unauthenticated (401), never as a 5xx.
func TestListLanguages_UnknownSubjectIsUnauthorized(t *testing.T) {
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{} // default: ErrUserNotFound
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	rec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/languages/", "", "missing-sub"))
	assertCatalogEnvelope(t, rec, http.StatusUnauthorized, httpjson.CodeUnauthenticated)
}

// TestListLanguages_EmptyIsBracketedNotNull proves the "[] not null"
// wire-format invariant: handlers downstream JSON-encode the result and
// nil → "null" is a wire surprise clients hate.
func TestListLanguages_EmptyIsBracketedNotNull(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{listOut: nil}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	rec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/languages/", "", "sub-abc"))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"languages":[]`) {
		t.Errorf("expected `\"languages\":[]`, got: %s", body)
	}
	if strings.Contains(body, `"languages":null`) {
		t.Errorf("languages must not be JSON null, got: %s", body)
	}
}

// TestReplaceLanguages_Ok covers the spec scenario "PUT replaces the
// full list atomically" from the HTTP boundary.
func TestReplaceLanguages_Ok(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"languages":[{"name":"english","level":"C1"},{"name":"french","level":"A2"}]}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/languages/", body, "sub-abc"))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(cRepo.replacedWith) != 2 {
		t.Errorf("expected repository to receive 2 languages, got %d", len(cRepo.replacedWith))
	}
}

// TestReplaceLanguages_DuplicateIsRejected covers the spec scenario
// "duplicate language in payload is rejected" — 400, repository not
// invoked.
func TestReplaceLanguages_DuplicateIsRejected(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"languages":[
        {"name":"english","level":"B2"},
        {"name":"english","level":"C1"}
    ]}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/languages/", body, "sub-abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "duplicate") {
		t.Errorf("expected error mentioning duplicate, got: %s", rec.Body.String())
	}
	assertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
}

// TestReplaceLanguages_InvalidCefrIsRejected covers the spec scenario
// "invalid CEFR level is rejected" — 400, repository not invoked.
func TestReplaceLanguages_InvalidCefrIsRejected(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"languages":[{"name":"english","level":"native"}]}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/languages/", body, "sub-abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "CEFR") && !strings.Contains(rec.Body.String(), "cefr") {
		t.Errorf("expected error mentioning CEFR, got: %s", rec.Body.String())
	}
	assertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
}

// TestCandidateHandlers_DecodeBoundary pins the Wave-B decode boundary on
// both candidates body-decoding handlers (upsertMyProfile, replaceMyLanguages):
// a viable first JSON value followed by a second JSON value must be 400
// invalid_request with the exact safe message "invalid JSON body", and a
// viable first value followed by more than 1,048,576 ignored whitespace
// bytes must be 413 payload_too_large ("payload too large"). Every
// downstream counter is asserted zero BEFORE the envelope helper (which
// Fatalfs) so RED cannot pass vacuously: the legacy direct json.Decoder
// admitted trailing/oversized input and ran the use cases.
func TestCandidateHandlers_DecodeBoundary(t *testing.T) {
	oversizedPad := strings.Repeat(" ", 1_048_577) // one byte past the 1,048,576 cap

	tests := []struct {
		name        string
		path        string
		first       string // viable first JSON value so the legacy decoder reaches downstream
		trailing    string // second JSON value, or oversized ignored whitespace
		wantStatus  int
		wantCode    httpjson.Code
		wantMessage string
	}{
		{
			name:        "upsert_profile/trailing_second_json_value",
			path:        "/me/profile/",
			first:       `{}`,
			trailing:    ` {"repeat":true}`,
			wantStatus:  http.StatusBadRequest,
			wantCode:    httpjson.CodeInvalidRequest,
			wantMessage: "invalid JSON body",
		},
		{
			name:        "upsert_profile/oversized_ignored_whitespace",
			path:        "/me/profile/",
			first:       `{}`,
			trailing:    " " + oversizedPad,
			wantStatus:  http.StatusRequestEntityTooLarge,
			wantCode:    httpjson.CodePayloadTooLarge,
			wantMessage: "payload too large",
		},
		{
			name:        "replace_languages/trailing_second_json_value",
			path:        "/me/profile/languages/",
			first:       `{"languages":[]}`,
			trailing:    ` {"repeat":true}`,
			wantStatus:  http.StatusBadRequest,
			wantCode:    httpjson.CodeInvalidRequest,
			wantMessage: "invalid JSON body",
		},
		{
			name:        "replace_languages/oversized_ignored_whitespace",
			path:        "/me/profile/languages/",
			first:       `{"languages":[]}`,
			trailing:    " " + oversizedPad,
			wantStatus:  http.StatusRequestEntityTooLarge,
			wantCode:    httpjson.CodePayloadTooLarge,
			wantMessage: "payload too large",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userID := uuid.New()
			cRepo := &stubCandidateRepo{}
			uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
			router := newTestRouter(newTestHandler(cRepo, uRepo))

			rec := doRequest(t, router, authedRequest(t, http.MethodPut, tt.path, tt.first+tt.trailing, "sub-abc"))

			// Non-vacuity gate: assert every downstream counter is zero BEFORE
			// the envelope helper. Under the legacy direct decoders these were
			// non-zero — the rejected body reached the use cases.
			if uRepo.getCalls != 0 {
				t.Fatalf("user GetByCognitoSub MUST NOT run on decode failure, got %d calls", uRepo.getCalls)
			}
			if cRepo.upsertCalls != 0 {
				t.Fatalf("candidate UpsertProfile MUST NOT run on decode failure, got %d calls", cRepo.upsertCalls)
			}
			if cRepo.replaceCalls != 0 {
				t.Fatalf("candidate ReplaceLanguagesByUserID MUST NOT run on decode failure, got %d calls", cRepo.replaceCalls)
			}
			if cRepo.listCalls != 0 {
				t.Fatalf("candidate ListLanguagesByUserID MUST NOT run on decode failure, got %d calls (post-write read included)", cRepo.listCalls)
			}

			assertCatalogEnvelope(t, rec, tt.wantStatus, tt.wantCode)
			var env httpjson.ErrorEnvelope
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
			}
			if env.Error != tt.wantMessage {
				t.Errorf("message: want %q, got %q", tt.wantMessage, env.Error)
			}
		})
	}
}

// TestUpsertProfile_UnexpectedErrorReturnsInternalError proves the
// default/unexpected classifier path yields code:internal_error with the
// generic non-leaking message. Any error type not explicitly handled by
// the handler's classifyAndWriteError falls through to Resolve(default),
// which returns CodeInternalError with "an internal error occurred".
// The stub injects an unexpected error through the upsert path; injected
// DB detail must NOT appear in the response body.
func TestUpsertProfile_UnexpectedErrorReturnsInternalError(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{
		upsertErr: errors.New("db: connection refused"),
	}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"professional_title": "Backend Engineer"}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d: %s", rec.Code, rec.Body.String())
	}
	assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Error != "an internal error occurred" {
		t.Errorf("canonical message: want %q, got %q", "an internal error occurred", env.Error)
	}
	if strings.Contains(rec.Body.String(), "connection refused") {
		t.Errorf("response must not leak injected detail, got: %s", rec.Body.String())
	}
}

// TestRoutes_OnlyMeMount covers the spec scenario "path id is ignored":
// the candidate handler's Routes() does NOT expose a {userID} segment.
// Hitting a path that looks like an IDOR attempt must 404 from the
// router itself, not reach the handler.
func TestRoutes_OnlyMeMount(t *testing.T) {
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	// Path-id IDOR attempt: caller passes a sub that resolves, but
	// they try to read /me/profile/<some-other-uuid>. The router has
	// no /{id} segment so this must 404.
	rec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/"+uuid.New().String()+"/", "", "sub-abc"))
	if rec.Code == http.StatusOK {
		t.Fatalf("path-id IDOR attempt must not return 200, got: %d body=%s", rec.Code, rec.Body.String())
	}
}

// assertCatalogEnvelope verifies the response carries a stable V1 error envelope
// with the expected HTTP status and catalog code.
func assertCatalogEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode httpjson.Code) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("want %d, got %d: %s", wantStatus, rec.Code, rec.Body.String())
	}
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code != wantCode {
		t.Errorf("code: want %q, got %q", wantCode, env.Code)
	}
}

// --- WS3A contract tests -----------------------------------------------------

// handlerSource reads handler.go from disk so tag-contract tests pin the
// wire names against DTO drift.
func handlerSource(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	src, err := os.ReadFile(filepath.Join(filepath.Dir(file), "handler.go"))
	if err != nil {
		t.Fatalf("read handler.go: %v", err)
	}
	return string(src)
}

// TestProfileWireContract_StaticScan pins the spec rules: field_of_study is
// the wire name on BOTH request and response bodies, and cv_s3_key never
// crosses the candidate HTTP boundary.
func TestProfileWireContract_StaticScan(t *testing.T) {
	src := handlerSource(t)
	if got := strings.Count(src, "field_of_study"); got < 2 {
		t.Errorf("request AND response structs must both carry the exact wire name field_of_study, found %d occurrences", got)
	}
	if strings.Contains(src, "field_of study") {
		t.Error("defective request tag `field_of study` must not exist; it silently drops client input")
	}
	if strings.Contains(src, `json:"cv_s3_key"`) {
		t.Error("cv_s3_key is a reserved column: it must not appear as a request or response JSON field")
	}
	if strings.Contains(src, "CVS3Key") {
		t.Error("CVS3Key must not cross the candidate HTTP boundary in either direction")
	}
}

// TestUpsertProfile_CvS3KeyNotClientWritable covers the spec scenarios
// "client-supplied cv_s3_key is not persisted" and "cv_s3_key is omitted
// from wire responses": the reserved column has no API write path and no
// wire exposure.
func TestUpsertProfile_CvS3KeyNotClientWritable(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"professional_title": "Backend Engineer", "cv_s3_key": "resumes/fake.pdf"}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "cv_s3_key") {
		t.Errorf("PUT response must not expose reserved cv_s3_key, got: %s", rec.Body.String())
	}
	if cRepo.upserted == nil {
		t.Fatal("expected profile to reach the repository")
	}
	if cRepo.upserted.CVS3Key != nil {
		t.Errorf("client-supplied cv_s3_key must be ignored, got %q", *cRepo.upserted.CVS3Key)
	}

	// A preexisting reserved value on the stored entity must also stay off
	// the wire (GET /me/profile).
	reserved := "resumes/reserved.pdf"
	cRepo.upserted.CVS3Key = &reserved
	cRepo.getByIDOut = cRepo.upserted
	getRec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/", "", "sub-abc"))
	if getRec.Code != http.StatusOK || strings.Contains(getRec.Body.String(), "cv_s3_key") {
		t.Fatalf("GET must be 200 without reserved cv_s3_key, got %d: %s", getRec.Code, getRec.Body.String())
	}
}

// TestFieldOfStudy_RoundTrip covers the spec scenarios "field_of_study
// binds on the request and round-trips" and "field_of_study wire names
// are pinned against drift".
func TestFieldOfStudy_RoundTrip(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"field_of_study": "Computer Science"}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var putResp candidateProfileResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &putResp); err != nil {
		t.Fatalf("decode PUT response: %v", err)
	}
	if putResp.FieldOfStudy == nil || *putResp.FieldOfStudy != "Computer Science" {
		t.Errorf("PUT response field_of_study: want %q, got %v", "Computer Science", putResp.FieldOfStudy)
	}

	// GET reads back the persisted row.
	cRepo.getByIDOut = cRepo.upserted
	getRec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/", "", "sub-abc"))
	var getResp candidateProfileResponse
	if err := json.Unmarshal(getRec.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if getResp.FieldOfStudy == nil || *getResp.FieldOfStudy != "Computer Science" {
		t.Errorf("GET response field_of_study must round-trip unchanged, got %v", getResp.FieldOfStudy)
	}
}

// TestUpsertProfile_FullReplacementContract pins the PUT full-replacement
// semantics: omitted or JSON-null nullable fields persist NULL, omitted or
// null skills become an empty list, omitted or null salary_currency
// becomes MXN, malformed birth_date rejects before any write, and
// server-managed fields in the body are ignored.
func TestUpsertProfile_FullReplacementContract(t *testing.T) {
	userID := uuid.New()
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}

	t.Run("omitted fields become NULL and defaults", func(t *testing.T) {
		cRepo := &stubCandidateRepo{}
		router := newTestRouter(newTestHandler(cRepo, uRepo))
		rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", `{}`, "sub-abc"))
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		p := cRepo.upserted
		if p == nil {
			t.Fatal("expected profile to reach the repository")
		}
		if p.Phone != nil || p.LinkedInURL != nil || p.City != nil || p.Country != nil || p.FieldOfStudy != nil {
			t.Errorf("omitted nullable fields must persist NULL, got phone=%v linkedin_url=%v city=%v country=%v field_of_study=%v", p.Phone, p.LinkedInURL, p.City, p.Country, p.FieldOfStudy)
		}
		if p.Skills == nil || len(p.Skills) != 0 {
			t.Errorf("omitted skills must become an empty list, got %v", p.Skills)
		}
		if p.SalaryCurrency != "MXN" {
			t.Errorf("omitted salary_currency must default to MXN, got %q", p.SalaryCurrency)
		}
		if p.BirthDate != nil || p.EducationLevel != nil || p.ExpectedSalaryPeriod != nil {
			t.Error("omitted birth_date/education_level/expected_salary_period must stay unset")
		}
	})

	t.Run("explicit nulls behave like omission", func(t *testing.T) {
		cRepo := &stubCandidateRepo{}
		router := newTestRouter(newTestHandler(cRepo, uRepo))
		body := `{"phone": null, "years_of_experience": null, "skills": null, "salary_currency": null, "birth_date": null}`
		rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		p := cRepo.upserted
		if p == nil {
			t.Fatal("expected profile to reach the repository")
		}
		if p.Phone != nil || p.YearsOfExperience != nil || p.BirthDate != nil {
			t.Error("explicit-null fields must persist NULL")
		}
		if p.Skills == nil || len(p.Skills) != 0 {
			t.Errorf("null skills must become an empty list, got %v", p.Skills)
		}
		if p.SalaryCurrency != "MXN" {
			t.Errorf("null salary_currency must default to MXN, got %q", p.SalaryCurrency)
		}
	})

	t.Run("malformed birth_date rejects without write", func(t *testing.T) {
		cRepo := &stubCandidateRepo{}
		router := newTestRouter(newTestHandler(cRepo, uRepo))
		rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", `{"birth_date": "not-a-date"}`, "sub-abc"))
		assertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
		if cRepo.upserted != nil {
			t.Error("malformed birth_date must reject before the repository is invoked")
		}
	})

	t.Run("server-managed fields are ignored", func(t *testing.T) {
		cRepo := &stubCandidateRepo{}
		router := newTestRouter(newTestHandler(cRepo, uRepo))
		body := `{"user_id": "` + uuid.New().String() + `", "created_at": "1999-01-01T00:00:00Z", "updated_at": "1999-01-01T00:00:00Z", "city": "CDMX"}`
		rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub-abc"))
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var got candidateProfileResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if got.UserID != userID.String() {
			t.Errorf("user_id is server-managed: want %s, got %s", userID, got.UserID)
		}
		if cRepo.upserted.City == nil || *cRepo.upserted.City != "CDMX" {
			t.Errorf("client-owned fields must still bind, got %v", cRepo.upserted.City)
		}
	})
}

// --- WS6C-7B: unexpected-error log correlation & redaction -----------------

// captureCandidateSlogJSON swaps the process-global default slog logger for
// a JSON handler writing into the returned buffer and registers the restore
// via t.Cleanup. Tests using it MUST stay non-parallel (slog.Default is
// shared state), mirroring the committed jobs handler contract tests.
func captureCandidateSlogJSON(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// decodeCandidateSlogRecords splits a captured JSON slog stream into one
// key/value map per emitted record.
func decodeCandidateSlogRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("captured slog line is not JSON: %v: %q", err, line)
		}
		records = append(records, rec)
	}
	return records
}

// upsertSensitiveMarkers carries one synthetic marker per forbidden class:
// DSN, bearer token, email, CV key, filesystem path, query string. None of
// them may ever appear in captured logs or on the wire.
var upsertSensitiveMarkers = []string{
	"postgres://svc:hunter2@db.internal:5432/peopleflow",
	"tok-synthetic-0f3a9c",
	"candidate.personal@example.com",
	"resumes/cv-synthetic-key.pdf",
	"/var/private/leaky-path",
	"query=classified-leak",
}

// assertNoSensitiveMarker fails when any synthetic marker appears in raw.
func assertNoSensitiveMarker(t *testing.T, what, raw string) {
	t.Helper()
	for _, m := range upsertSensitiveMarkers {
		if strings.Contains(raw, m) {
			t.Errorf("%s must not contain synthetic marker %q", what, m)
		}
	}
}

// runUpsertUnexpectedErrorScenario fires PUT /me/profile with a valid
// subject and body while the repository injects an unexpected error laden
// with synthetic sensitive markers. When useRequestID is true the real chi
// RequestID middleware runs ahead of the runtime RequestObservability
// middleware; the captured slog default is installed BEFORE middleware
// construction so RequestObservability(nil, nil) binds the capturing logger
// (metrics fall back to the bounded no-op runtime default).
func runUpsertUnexpectedErrorScenario(t *testing.T, useRequestID bool, requestIDHeader string) (*bytes.Buffer, *httptest.ResponseRecorder, *stubCandidateRepo, *stubUserRepo) {
	t.Helper()
	userID := uuid.New()
	cRepo := &stubCandidateRepo{upsertErr: fmt.Errorf("db: %s", strings.Join(upsertSensitiveMarkers, "; "))}
	uRepo := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-abc"}}

	buf := captureCandidateSlogJSON(t)

	router := chi.NewRouter()
	if useRequestID {
		router.Use(chimw.RequestID)
	}
	router.Use(middleware.RequestObservability(nil, nil))
	router.Mount("/me/profile", newTestHandler(cRepo, uRepo).Routes())

	req := authedRequest(t, http.MethodPut, "/me/profile/", `{"professional_title": "Backend Engineer"}`, "sub-abc")
	if requestIDHeader != "" {
		req.Header.Set("X-Request-Id", requestIDHeader)
	}
	rec := doRequest(t, router, req)
	return buf, rec, cRepo, uRepo
}

// TestUpsertProfile_UnexpectedErrorLogCorrelationAndRedaction pins the
// WS6C-7B bounded unexpected-error contract for PUT /me/profile: the
// auxiliary ERROR record carries exactly time/level/msg/code_class plus the
// correlated request_id (omitted entirely when no RequestID middleware ran,
// never fabricated or re-read from headers), the completion INFO record
// names the matched chi route pattern — never the raw URL — and no
// sensitive marker from the injected error reaches the logs or the wire.
// Non-regression note: this record has never carried a path attribute; the
// exact-key assertions pin that absence rather than claiming a removal.
func TestUpsertProfile_UnexpectedErrorLogCorrelationAndRedaction(t *testing.T) {
	const suppliedID = "req-supplied-fixed-7b"
	const auxMsg = "upsert my profile failed"
	const completionMsg = "http request completed"

	t.Run("supplied_request_id_correlated_and_redacted", func(t *testing.T) {
		buf, rec, cRepo, uRepo := runUpsertUnexpectedErrorScenario(t, true, suppliedID)

		// Wire: canonical 500 internal_error envelope, nothing else leaks.
		assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
		var env httpjson.ErrorEnvelope
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode envelope: %v", err)
		}
		if env.Error != "an internal error occurred" {
			t.Errorf("canonical message: want %q, got %q", "an internal error occurred", env.Error)
		}
		assertNoSensitiveMarker(t, "wire body", rec.Body.String())

		// Exactly one identity resolution and exactly one upsert attempt.
		if uRepo.getCalls != 1 {
			t.Errorf("identity resolutions = %d, want exactly 1", uRepo.getCalls)
		}
		if cRepo.upsertCalls != 1 {
			t.Errorf("upsert attempts = %d, want exactly 1", cRepo.upsertCalls)
		}

		// Exactly two records: one auxiliary ERROR + one completion INFO.
		records := decodeCandidateSlogRecords(t, buf)
		var auxRecords, completions []map[string]any
		for _, r := range records {
			switch r["msg"] {
			case auxMsg:
				auxRecords = append(auxRecords, r)
			case completionMsg:
				completions = append(completions, r)
			}
		}
		if len(records) != 2 {
			t.Fatalf("captured records = %d, want exactly 2 (%s ERROR + %s INFO): %v", len(records), auxMsg, completionMsg, records)
		}
		if len(auxRecords) != 1 || len(completions) != 1 {
			t.Fatalf("want exactly 1 %q ERROR and 1 %q INFO, got %d aux / %d completion: %v", auxMsg, completionMsg, len(auxRecords), len(completions), records)
		}
		aux, completion := auxRecords[0], completions[0]

		// Auxiliary record: exact bounded key set — no path, no raw error.
		wantAux := map[string]bool{"time": true, "level": true, "msg": true, "code_class": true, "request_id": true}
		for k := range aux {
			if !wantAux[k] {
				t.Errorf("auxiliary record has unbounded key %q (record: %v)", k, aux)
			}
			delete(wantAux, k)
		}
		for k := range wantAux {
			t.Errorf("auxiliary record is missing required key %q (record: %v)", k, aux)
		}
		if got, _ := aux["level"].(string); got != slog.LevelError.String() {
			t.Errorf("aux level = %v, want %q", aux["level"], slog.LevelError.String())
		}
		if got, _ := aux["code_class"].(string); got != string(httpjson.CodeInternalError) {
			t.Errorf("aux code_class = %v, want %q", aux["code_class"], httpjson.CodeInternalError)
		}
		if got, _ := aux["request_id"].(string); got != suppliedID {
			t.Errorf("aux request_id = %v, want supplied header value %q", aux["request_id"], suppliedID)
		}

		// Completion record: matched chi route pattern (bounded), never the
		// raw URL — chi resolves the mount as "/me/profile" while the raw
		// request URL here is "/me/profile/", so the equality proves bounded
		// route naming — same request ID, propagated canonical catalog class.
		if got, _ := completion["path"].(string); got != "/me/profile" {
			t.Errorf("completion path = %v, want matched route pattern %q (never the raw URL %q)", completion["path"], "/me/profile", "/me/profile/")
		}
		if got, _ := completion["request_id"].(string); got != suppliedID {
			t.Errorf("completion request_id = %v, want %q", completion["request_id"], suppliedID)
		}
		if got, _ := completion["level"].(string); got != slog.LevelInfo.String() {
			t.Errorf("completion level = %v, want %q", completion["level"], slog.LevelInfo.String())
		}
		if got, _ := completion["code_class"].(string); got != string(httpjson.CodeInternalError) {
			t.Errorf("completion code_class = %v, want %q", completion["code_class"], httpjson.CodeInternalError)
		}

		assertNoSensitiveMarker(t, "captured logs", buf.String())
	})

	t.Run("generated_request_id_when_header_absent", func(t *testing.T) {
		buf, rec, _, _ := runUpsertUnexpectedErrorScenario(t, true, "")
		assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
		records := decodeCandidateSlogRecords(t, buf)
		var aux, completion map[string]any
		for _, r := range records {
			switch r["msg"] {
			case auxMsg:
				aux = r
			case completionMsg:
				completion = r
			}
		}
		if len(records) != 2 || aux == nil || completion == nil {
			t.Fatalf("want exactly 2 records (auxiliary ERROR + completion INFO), got %d: %v", len(records), records)
		}
		auxID, _ := aux["request_id"].(string)
		completionID, _ := completion["request_id"].(string)
		if auxID == "" || completionID == "" || auxID != completionID {
			t.Errorf("chi RequestID middleware must generate one nonempty ID shared by both records, got aux=%q completion=%q", auxID, completionID)
		}
		assertNoSensitiveMarker(t, "captured logs", buf.String())
	})

	t.Run("missing_request_id_middleware_omits_request_id", func(t *testing.T) {
		buf, rec, _, _ := runUpsertUnexpectedErrorScenario(t, false, "req-header-must-be-ignored")
		assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
		found := false
		for _, r := range decodeCandidateSlogRecords(t, buf) {
			if r["msg"] != auxMsg {
				continue
			}
			found = true
			if _, ok := r["request_id"]; ok {
				t.Errorf("request_id must be omitted entirely when no RequestID middleware ran (never fabricated, never re-read from headers): %v", r)
			}
			want := map[string]bool{"time": true, "level": true, "msg": true, "code_class": true}
			for k := range r {
				if !want[k] {
					t.Errorf("auxiliary record has unbounded key %q (record: %v)", k, r)
				}
				delete(want, k)
			}
			for k := range want {
				t.Errorf("auxiliary record is missing required key %q (record: %v)", k, r)
			}
			if got, _ := r["code_class"].(string); got != string(httpjson.CodeInternalError) {
				t.Errorf("code_class = %v, want %q", r["code_class"], httpjson.CodeInternalError)
			}
		}
		if !found {
			t.Fatal("no auxiliary 'upsert my profile failed' record captured")
		}
		assertNoSensitiveMarker(t, "captured logs", buf.String())
	})
}

// helpers to silence unused-import warnings when tests are added/removed.
var _ = candidatesdtos.ReplaceMyLanguagesDto{}
var _ = candidatesusecases.NewCandidateService
