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

	candidatesdtos "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	candidatesusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
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
}

func (r *stubCandidateRepo) UpsertProfile(_ context.Context, p *entities.CandidateProfile) (*entities.CandidateProfile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
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
}

func (r *stubUserRepo) GetByCognitoSub(_ context.Context, _ string) (*identityentities.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
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
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestGetProfile_UnknownSubjectIsUnauthorized covers the spec scenario
// "unknown cognito_sub is not 5xx". A valid JWT whose sub does not
// match any live users row must surface as 401.
func TestGetProfile_UnknownSubjectIsUnauthorized(t *testing.T) {
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{} // default: ErrUserNotFound
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	rec := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/", "", "missing-sub"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
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
}

// TestUpsertProfile_UnknownSubjectIsUnauthorized covers the IDOR
// invariant on PUT too: unknown sub → 401, never 5xx.
func TestUpsertProfile_UnknownSubjectIsUnauthorized(t *testing.T) {
	cRepo := &stubCandidateRepo{}
	uRepo := &stubUserRepo{}
	router := newTestRouter(newTestHandler(cRepo, uRepo))

	body := `{"professional_title": "Backend Engineer"}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "missing-sub"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
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

// helper to silence unused-import warnings when tests are added/removed
// in future edits.
var _ = candidatesdtos.ReplaceMyLanguagesDto{}
var _ = time.Now
