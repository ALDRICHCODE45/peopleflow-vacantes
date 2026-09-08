package http

import (
	"bytes"
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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	rtmiddleware "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
)

// stubRepo is a hand-rolled stub of repositories.CompanyRepository. It records
// the last Create input and returns whatever is programmed into it. We keep it
// in this package so HTTP tests don't have to depend on anything outside.
//
// WU3 stub repair (companies-write slice, design D16): the port gained
// three methods (`GetCompanyForUpdate`, `UpdateCompany`,
// `SoftDeleteCompany`); the stub gains the same three so the compile
// guard holds. The defaults are the "never called by legacy handler
// tests" shape (`GetCompanyForUpdate` → `ErrCompanyNotFound`;
// `UpdateCompany` / `SoftDeleteCompany` → nil). Tests that need
// different behavior program the new fields directly (WU6 onward).
type stubRepo struct {
	mu      sync.Mutex
	created *entities.Company
	cErr    error
	getID   uuid.UUID
	getOut  *entities.Company
	getErr  error

	getForUpdateOut *entities.Company
	getForUpdateErr error

	updateCalls int
	updateErr   error

	softDeleteCalls int
	softDeleteErr   error
}

func (r *stubRepo) Create(_ context.Context, c *entities.Company) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cErr != nil {
		return r.cErr
	}
	r.created = c
	return nil
}

func (r *stubRepo) GetByID(_ context.Context, id uuid.UUID) (*entities.Company, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.getErr != nil {
		return nil, r.getErr
	}
	if r.getOut != nil {
		r.getID = id
		return r.getOut, nil
	}
	return nil, entities.ErrCompanyNotFound
}

// GetCompanyForUpdate mirrors GetByID's default return shape so legacy
// handler tests stay green (they do not exercise the new method).
func (r *stubRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.getForUpdateErr != nil {
		return nil, r.getForUpdateErr
	}
	if r.getForUpdateOut != nil {
		return r.getForUpdateOut, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (r *stubRepo) UpdateCompany(_ context.Context, _ uuid.UUID, _ repositories.UpdateCompanyPatch, _ time.Time, _ auditentities.AuditEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.updateCalls++
	return r.updateErr
}

func (r *stubRepo) SoftDeleteCompany(_ context.Context, _ uuid.UUID, _ time.Time, _ auditentities.AuditEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.softDeleteCalls++
	return r.softDeleteErr
}

// stubBootstrapRepo and stubUserRepo back the CreateCompanyWithOwner flow in
// the HTTP tests. The handler now resolves the subject → users.id and persists
// company + owner atomically, so the test doubles must implement those ports.
type stubBootstrapRepo struct {
	mu        sync.Mutex
	company   *entities.Company
	owner     *entities.CompanyMember
	createErr error
}

func (r *stubBootstrapRepo) CreateWithOwner(_ context.Context, c *entities.Company, m *entities.CompanyMember) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.createErr != nil {
		return r.createErr
	}
	r.company = c
	r.owner = m
	return nil
}

// stubUserRepo resolves a fixed sub to a users.id (or returns
// identityentities.ErrUserNotFound).
type stubUserRepo struct {
	mu       sync.Mutex
	resolved *identityentities.User
	resErr   error
	getCalls int // every user-repo read (GetByCognitoSub)
}

func (r *stubUserRepo) GetByCognitoSub(_ context.Context, _ string) (*identityentities.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.getCalls++
	if r.resErr != nil {
		return nil, r.resErr
	}
	if r.resolved == nil {
		return nil, identityentities.ErrUserNotFound
	}
	return r.resolved, nil
}

func (r *stubUserRepo) Create(_ context.Context, _ *identityentities.User) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepo.Create: not used")
}

func (r *stubUserRepo) GetByID(_ context.Context, _ uuid.UUID) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepo.GetByID: not used")
}

func newTestHandler(repo *stubRepo) *CompanyHandler {
	return newTestHandlerWithBootstrap(repo, &stubBootstrapRepo{})
}

func newTestHandlerWithBootstrap(repo *stubRepo, bootstrap *stubBootstrapRepo) *CompanyHandler {
	users := &stubUserRepo{resolved: &identityentities.User{ID: uuid.MustParse("11111111-1111-1111-1111-111111111111"), CognitoSub: "test-sub"}}
	svc := usecases.NewCompanyServiceWithBootstrap(repo, users, bootstrap)
	return NewCompanyHandler(svc)
}

func newTestRouter(h *CompanyHandler) *chi.Mux {
	r := chi.NewRouter()
	r.Mount("/companies", h.Routes())
	return r
}

func doPost(t *testing.T, router http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/companies", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// RequireAuth would inject Claims in production; the handler reads them.
	ctx := security.ContextWithClaims(req.Context(), security.Claims{Subject: "test-sub"})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func doGet(t *testing.T, router http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestCreateCompany_ValidFullBody(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	body := `{
        "name": "Acme SA de CV",
        "rfc": "AAA010101AAA",
        "industry_id": "tech",
        "website": "https://acme.com",
        "logo_url": "https://acme.com/logo.png",
        "description": "Líder en logística",
        "size": "medium",
        "founded_year": 2010,
        "city": "CDMX",
        "country": "MX",
        "linkedin_url": "https://linkedin.com/company/acme",
        "instagram_url": "https://instagram.com/acme",
        "facebook_url": "https://facebook.com/acme",
        "twitter_url": "https://twitter.com/acme",
        "cover_image_url": "https://acme.com/cover.jpg"
    }`

	rec := doPost(t, router, body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var got companyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Name != "Acme SA de CV" {
		t.Errorf("Name: %q", got.Name)
	}
	if got.Rfc != "AAA010101AAA" {
		t.Errorf("Rfc: %q", got.Rfc)
	}
	if got.Status != "active" {
		t.Errorf("Status: %q", got.Status)
	}
	if got.Website == nil || *got.Website != "https://acme.com" {
		t.Errorf("Website: %v", got.Website)
	}
	if got.Description == nil || *got.Description != "Líder en logística" {
		t.Errorf("Description: %v", got.Description)
	}
	if got.Size == nil || *got.Size != "medium" {
		t.Errorf("Size: %v", got.Size)
	}
	if got.FoundedYear == nil || *got.FoundedYear != 2010 {
		t.Errorf("FoundedYear: %v", got.FoundedYear)
	}
	if got.City == nil || *got.City != "CDMX" {
		t.Errorf("City: %v", got.City)
	}
	if got.LinkedInURL == nil || *got.LinkedInURL != "https://linkedin.com/company/acme" {
		t.Errorf("LinkedInURL: %v", got.LinkedInURL)
	}
	if got.CoverImageURL == nil || *got.CoverImageURL != "https://acme.com/cover.jpg" {
		t.Errorf("CoverImageURL: %v", got.CoverImageURL)
	}
}

func TestCreateCompany_RequiredFieldsOnly(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	body := `{
        "name": "Acme SA de CV",
        "rfc": "AAA010101AAA",
        "industry_id": "tech"
    }`
	rec := doPost(t, router, body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var got companyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Website != nil {
		t.Errorf("Website: want nil, got %v", got.Website)
	}
	if got.Description != nil {
		t.Errorf("Description: want nil, got %v", got.Description)
	}
	if got.Size != nil {
		t.Errorf("Size: want nil, got %v", got.Size)
	}
	if got.FoundedYear != nil {
		t.Errorf("FoundedYear: want nil, got %v", got.FoundedYear)
	}
}

func TestCreateCompany_InvalidSize(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	body := `{
        "name": "Acme SA de CV",
        "rfc": "AAA010101AAA",
        "industry_id": "tech",
        "size": "huge"
    }`
	rec := doPost(t, router, body)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "size") {
		t.Errorf("expected error message mentioning size, got: %s", rec.Body.String())
	}
}

func TestCreateCompany_InvalidYear(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	body := `{
        "name": "Acme SA de CV",
        "rfc": "AAA010101AAA",
        "industry_id": "tech",
        "founded_year": 1500
    }`
	rec := doPost(t, router, body)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	// The 400 comes from classifyCreateCompanyError mapping
	// valueobjects.ErrFoundedYearOutOfRange to its raw .Error() string, which
	// reads "el año de fundación está fuera del rango permitido (...)". Assert
	// on a substring that uniquely identifies that message — a single letter
	// would match almost any Spanish body and prove nothing.
	if !strings.Contains(rec.Body.String(), "año") {
		t.Errorf("expected error mentioning year (año), got: %s", rec.Body.String())
	}
}

func TestCreateCompany_OversizedDescription(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	longDesc := strings.Repeat("a", 3001)
	body := `{
        "name": "Acme SA de CV",
        "rfc": "AAA010101AAA",
        "industry_id": "tech",
        "description": "` + longDesc + `"
    }`
	rec := doPost(t, router, body)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "3000") && !strings.Contains(rec.Body.String(), "descripci") {
		t.Errorf("expected error mentioning description length, got: %s", rec.Body.String())
	}
}

func TestCreateCompany_EmptyIndustry(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	body := `{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"   "}`
	rec := doPost(t, router, body)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCreateCompany_Duplicate(t *testing.T) {
	repo := &stubRepo{}
	bootstrap := &stubBootstrapRepo{createErr: entities.ErrDuplicateCompany}
	router := newTestRouter(newTestHandlerWithBootstrap(repo, bootstrap))

	body := `{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech"}`
	rec := doPost(t, router, body)

	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCreateCompany_InvalidJSON(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	rec := doPost(t, router, "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestCreateCompany_MissingSubject(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	// Simulate a request that bypassed RequireAuth: no Claims in context.
	req := httptest.NewRequest(http.MethodPost, "/companies", strings.NewReader(`{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetCompany_RedactsRFCAndStatus(t *testing.T) {
	id := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	now := time.Now().UTC()
	name, _ := valueobjects.NewCompanyName("Acme SA de CV")
	rfc, _ := valueobjects.NewCompanyRfc("AAA010101AAA")
	desc, _ := valueobjects.NewCompanyDescription("Líder en logística")
	cs := valueobjects.MediumSize
	year, _ := valueobjects.NewFoundedYear(2010)
	web := "https://acme.com"
	logo := "https://acme.com/logo.png"
	city := "CDMX"
	linkedin := "https://linkedin.com/company/acme"
	cover := "https://acme.com/cover.jpg"

	stored := &entities.Company{
		ID:            id,
		Name:          name,
		Rfc:           rfc,
		Status:        valueobjects.Active,
		IndustryID:    "tech",
		Website:       &web,
		LogoURL:       &logo,
		Description:   &desc,
		Size:          &cs,
		FoundedYear:   &year,
		City:          &city,
		LinkedInURL:   &linkedin,
		CoverImageURL: &cover,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	repo := &stubRepo{getOut: stored}
	router := newTestRouter(newTestHandler(repo))

	rec := doGet(t, router, "/companies/"+id.String())
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got companyPublicResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID != id.String() {
		t.Errorf("ID: %v", got.ID)
	}
	if got.Name != "Acme SA de CV" {
		t.Errorf("Name: %v", got.Name)
	}
	// Note: Rfc and Status are intentionally absent from companyPublicResponse
	// (compile-time enforcement of the redaction contract). The wire-format
	// check below proves the omission survives JSON marshalling.
	if got.Website == nil || *got.Website != web {
		t.Errorf("Website: %v", got.Website)
	}
	if got.Description == nil || *got.Description != "Líder en logística" {
		t.Errorf("Description: %v", got.Description)
	}
	if got.Size == nil || *got.Size != "medium" {
		t.Errorf("Size: %v", got.Size)
	}
	if got.FoundedYear == nil || *got.FoundedYear != 2010 {
		t.Errorf("FoundedYear: %v", got.FoundedYear)
	}
	if got.City == nil || *got.City != "CDMX" {
		t.Errorf("City: %v", got.City)
	}
	if got.CoverImageURL == nil || *got.CoverImageURL != cover {
		t.Errorf("CoverImageURL: %v", got.CoverImageURL)
	}

	// Defense in depth: scan the raw body for forbidden fields, since
	// `json.Unmarshal` will silently ignore keys it can't bind.
	bodyStr := rec.Body.String()
	if strings.Contains(bodyStr, `"rfc"`) {
		t.Errorf("raw response contains rfc field: %s", bodyStr)
	}
	if strings.Contains(bodyStr, `"status"`) {
		t.Errorf("raw response contains status field: %s", bodyStr)
	}
}

func TestGetCompany_NotFound(t *testing.T) {
	repo := &stubRepo{} // default returns ErrCompanyNotFound
	router := newTestRouter(newTestHandler(repo))

	rec := doGet(t, router, "/companies/"+uuid.New().String())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestGetCompany_InvalidID(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(newTestHandler(repo))

	rec := doGet(t, router, "/companies/not-a-uuid")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestGetCompany_InternalServerErrorOnUnknownError(t *testing.T) {
	repo := &stubRepo{getErr: errors.New("kaboom")}
	router := newTestRouter(newTestHandler(repo))

	rec := doGet(t, router, "/companies/"+uuid.New().String())
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
}

// --- Catalog envelope: V1 code field on all error responses ----------

func doPostWithBootstrap(t *testing.T, bootstrap *stubBootstrapRepo, body string) *httptest.ResponseRecorder {
	t.Helper()
	repo := &stubRepo{}
	router := newTestRouter(newTestHandlerWithBootstrap(repo, bootstrap))
	return doPost(t, router, body)
}

func doGetWithRepo(t *testing.T, repo *stubRepo, path string) *httptest.ResponseRecorder {
	t.Helper()
	router := newTestRouter(newTestHandler(repo))
	return doGet(t, router, path)
}

func assertCatalogEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode httpjson.Code) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("want %d, got %d: %s", wantStatus, rec.Code, rec.Body.String())
	}
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code == "" {
		t.Fatalf("want non-empty code, got empty; body=%s", rec.Body.String())
	}
	if env.Code != wantCode {
		t.Errorf("code: want %q, got %q", wantCode, env.Code)
	}
	if wantCode == httpjson.CodeInternalError {
		if env.Error != "an internal error occurred" {
			t.Errorf("internal_error must use canonical generic message, got %q", env.Error)
		}
	}
}

// assertWaveADecodeEnvelope pins the Wave A decode-failure wire outcome:
// catalog code + exact message — the legacy safe message "invalid JSON body"
// for invalid_request, the canonical never-overridden "payload too large" for
// payload_too_large.
func assertWaveADecodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode httpjson.Code) {
	t.Helper()
	assertCatalogEnvelope(t, rec, wantStatus, wantCode)
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	wantMsg := "invalid JSON body"
	if wantCode == httpjson.CodePayloadTooLarge {
		wantMsg = "payload too large"
	}
	if env.Error != wantMsg {
		t.Errorf("message: want %q, got %q", wantMsg, env.Error)
	}
}

// waveAOversizedBody appends an ignored "pad" field until the body exceeds
// the 1,048,576-byte decode cap.
func waveAOversizedBody(t *testing.T, base string) string {
	t.Helper()
	return strings.TrimSuffix(base, "}") + `,"pad":"` + strings.Repeat("p", 1_048_576) + `"}`
}

// TestCreateCompany_DecodeBoundary (WS6B-2 Wave A): the create endpoint must
// accept exactly one JSON value within the 1,048,576-byte cap — a trailing
// second value yields invalid_request ("invalid JSON body"), ignored padding
// past the cap yields payload_too_large (HTTP 413); neither may reach the use
// case (no CreateWithOwner row).
func TestCreateCompany_DecodeBoundary(t *testing.T) {
	for _, tc := range []struct {
		name   string
		body   string
		status int
		code   httpjson.Code
	}{
		{"trailing second JSON value", `{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech"} {"extra":1}`, http.StatusBadRequest, httpjson.CodeInvalidRequest},
		{"oversized ignored padding", waveAOversizedBody(t, `{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech"}`), http.StatusRequestEntityTooLarge, httpjson.CodePayloadTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bootstrap := &stubBootstrapRepo{}
			users := &stubUserRepo{resolved: &identityentities.User{ID: uuid.MustParse("11111111-1111-1111-1111-111111111111"), CognitoSub: "test-sub"}}
			svc := usecases.NewCompanyServiceWithBootstrap(&stubRepo{}, users, bootstrap)
			router := newTestRouter(NewCompanyHandler(svc))
			rec := doPost(t, router, tc.body)
			if users.getCalls != 0 {
				t.Errorf("user lookup MUST NOT run on decode failure, got %d GetByCognitoSub calls", users.getCalls)
			}
			if bootstrap.company != nil || bootstrap.owner != nil {
				t.Errorf("CreateWithOwner MUST NOT run on decode failure (company=%v owner=%v)", bootstrap.company, bootstrap.owner)
			}
			assertWaveADecodeEnvelope(t, rec, tc.status, tc.code)
		})
	}
}

func TestCreateCompany_CatalogCodeMapping(t *testing.T) {
	tests := []struct {
		name       string
		wantCode   httpjson.Code
		wantStatus int
		wantMsg    string
		body       string
		bootstrap  *stubBootstrapRepo
	}{
		{"400: invalid size", httpjson.CodeInvalidRequest, http.StatusBadRequest, "",
			`{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech","size":"huge"}`,
			&stubBootstrapRepo{}},
		{"409: duplicate RFC", httpjson.CodeAlreadyExists, http.StatusConflict, "",
			`{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech"}`,
			&stubBootstrapRepo{createErr: entities.ErrDuplicateCompany}},
		{"409: industry unavailable (WS2A gate)", httpjson.CodeIndustryUnavailable, http.StatusConflict,
			"industry unavailable",
			`{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"ghost-tech"}`,
			&stubBootstrapRepo{createErr: entities.ErrIndustryUnavailable}},
		{"500: unexpected", httpjson.CodeInternalError, http.StatusInternalServerError, "",
			`{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech"}`,
			&stubBootstrapRepo{createErr: errors.New("surprise")}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := doPostWithBootstrap(t, tc.bootstrap, tc.body)
			assertCatalogEnvelope(t, rec, tc.wantStatus, tc.wantCode)
			if tc.wantMsg != "" {
				if !strings.Contains(rec.Body.String(), tc.wantMsg) {
					t.Errorf("expected body to contain %q, got %s", tc.wantMsg, rec.Body.String())
				}
				// WS2A 409 must stay code-only.
				if strings.Contains(rec.Body.String(), `"data"`) {
					t.Errorf("industry_unavailable must not emit a `data` field; body=%s", rec.Body.String())
				}
			}
		})
	}
}

func TestGetCompany_CatalogCodeMapping(t *testing.T) {
	tests := []struct {
		name       string
		wantCode   httpjson.Code
		path       string
		wantStatus int
		repo       *stubRepo
	}{
		{"404: not found", httpjson.CodeNotFound, "/companies/" + uuid.New().String(),
			http.StatusNotFound, &stubRepo{}},
		{"400: invalid UUID", httpjson.CodeInvalidRequest, "/companies/not-a-uuid",
			http.StatusBadRequest, &stubRepo{}},
		{"500: unexpected", httpjson.CodeInternalError, "/companies/" + uuid.New().String(),
			http.StatusInternalServerError, &stubRepo{getErr: errors.New("kaboom")}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := doGetWithRepo(t, tc.repo, tc.path)
			assertCatalogEnvelope(t, rec, tc.wantStatus, tc.wantCode)
		})
	}
}

// --- Internal-error auxiliary logging: bounded + request-correlated ---------

// companyAuxAllowedKeys is the closed key set for the auxiliary
// "create company failed" / "get company failed" record (time/level/msg are
// emitted by slog's JSONHandler itself). Anything else on the record — a raw
// error, a company_id, a URL — is unbounded and forbidden.
var companyAuxAllowedKeys = map[string]bool{
	"time": true, "level": true, "msg": true,
	"request_id": true, "method": true, "path": true, "code_class": true,
}

// captureCompanySlog installs a JSON slog.Default over a fresh buffer and
// restores the previous default on cleanup. Tests using it MUST NOT call
// t.Parallel(): slog.Default is process-global.
func captureCompanySlog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// decodeCompanySlogRecords parses every captured JSON slog record so tests
// select records by msg instead of relying on a single last line.
func decodeCompanySlogRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("decode slog record: %v; raw=%s", err, buf.String())
		}
		records = append(records, rec)
	}
	return records
}

func companyRecordByMsg(t *testing.T, records []map[string]any, msg string) map[string]any {
	t.Helper()
	for _, rec := range records {
		if rec["msg"] == msg {
			return rec
		}
	}
	t.Fatalf("no slog record with msg %q; captured msgs=%s", msg, companyMsgList(records))
	return nil
}

func companyMsgList(records []map[string]any) string {
	msgs := make([]string, 0, len(records))
	for _, rec := range records {
		m, _ := rec["msg"].(string)
		msgs = append(msgs, m)
	}
	return strings.Join(msgs, ", ")
}

// TestCompanyTransport_UnexpectedErrors_CorrelatedAndRedacted drives the two
// reachable unexpected-error sites (POST /companies create, GET
// /companies/{id} get) through the production-faithful chain chi RequestID →
// runtime RequestObservability → handler, with a fixed X-Request-Id. Behavior
// under test: the response stays exactly 500 + catalog internal_error with the
// canonical generic message, the handler emits exactly ONE auxiliary record
// ("create company failed" / "get company failed") whose fields are bounded
// and request-correlated (request_id shared with the completion record, HTTP
// method, matched chi route pattern, code_class=internal_error), and the raw
// error / concrete URL / UUID / request body (name, RFC) never reach any
// captured log line. No t.Parallel(): slog capture is process-global.
func TestCompanyTransport_UnexpectedErrors_CorrelatedAndRedacted(t *testing.T) {
	const fixedRequestID = "companies-fixed-request-id"
	const completionMsg = "http request completed"

	cases := []struct {
		name      string
		method    string
		path      string
		body      string
		handler   func() *CompanyHandler
		auxMsg    string
		wantRoute string
		// forbidden substrings that must not appear in any captured log byte
		forbidden []string
	}{
		{
			name:   "create: unexpected bootstrap error",
			method: http.MethodPost,
			path:   "/companies",
			body:   `{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech"}`,
			handler: func() *CompanyHandler {
				boom := errors.New("pq: create failed: postgres://svc:hunter2@db.internal:5432/peopleflow")
				return newTestHandlerWithBootstrap(&stubRepo{}, &stubBootstrapRepo{createErr: boom})
			},
			auxMsg:    "create company failed",
			wantRoute: "/companies",
			forbidden: []string{
				"postgres://svc:hunter2@db.internal:5432/peopleflow",
				"Acme SA de CV",
				"AAA010101AAA",
			},
		},
		{
			name:   "get: unexpected repository error",
			method: http.MethodGet,
			path:   "/companies/88888888-8888-8888-8888-888888888888",
			handler: func() *CompanyHandler {
				boom := errors.New("pg: read timeout while scanning company row token=abc123")
				return newTestHandler(&stubRepo{getErr: boom})
			},
			auxMsg:    "get company failed",
			wantRoute: "/companies/{id}",
			forbidden: []string{
				"pg: read timeout while scanning company row token=abc123",
				"88888888-8888-8888-8888-888888888888",
				"token=abc123",
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logBuf := captureCompanySlog(t)
			h := tc.handler()

			// Production-faithful chain: chi RequestID → runtime
			// RequestObservability → handler, mounted exactly like
			// cmd/api/router.go (GET /companies/{id}, POST /companies).
			r := chi.NewRouter()
			r.Use(chimw.RequestID)
			r.Use(rtmiddleware.RequestObservability(
				slog.New(slog.NewJSONHandler(logBuf, &slog.HandlerOptions{Level: slog.LevelInfo})),
				nil,
			))
			hh := h.CompanyHandlers()
			r.Post("/companies", hh.CreateCompany)
			r.Get("/companies/{id}", hh.GetCompany)

			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("X-Request-Id", fixedRequestID)
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			if tc.method == http.MethodPost {
				// RequireAuth would inject Claims in production; the handler reads them.
				req = req.WithContext(security.ContextWithClaims(req.Context(), security.Claims{Subject: "test-sub"}))
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			// The wire contract is unchanged: generic 500 + catalog internal_error
			// with the canonical generic message (no injected detail).
			assertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)

			// Exactly one auxiliary record + exactly one completion record.
			records := decodeCompanySlogRecords(t, logBuf)
			if len(records) != 2 {
				t.Fatalf("slog records = %d (%s), want exactly 2 (auxiliary + completion)",
					len(records), companyMsgList(records))
			}

			aux := companyRecordByMsg(t, records, tc.auxMsg)
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
			if got, _ := aux["method"].(string); got != tc.method {
				t.Errorf("auxiliary method = %q, want %q", got, tc.method)
			}
			if got, _ := aux["path"].(string); got != tc.wantRoute {
				t.Errorf("auxiliary path = %q, want the matched chi route pattern %q (raw URL/UUID MUST NOT be logged)", got, tc.wantRoute)
			}
			if got, _ := aux["code_class"].(string); got != string(httpjson.CodeInternalError) {
				t.Errorf("auxiliary code_class = %q, want %q", got, httpjson.CodeInternalError)
			}

			// The runtime completion record: same fixed request ID, matched
			// route pattern, status 500, internal_error class.
			comp := companyRecordByMsg(t, records, completionMsg)
			if got, _ := comp["request_id"].(string); got != fixedRequestID {
				t.Errorf("completion request_id = %q, want the same fixed ID %q shared with the auxiliary record", got, fixedRequestID)
			}
			if got, _ := comp["path"].(string); got != tc.wantRoute {
				t.Errorf("completion path = %q, want the matched chi route pattern %q", got, tc.wantRoute)
			}
			if s, ok := comp["status"].(float64); !ok || int(s) != http.StatusInternalServerError {
				t.Errorf("completion status = %v (%T), want %d", comp["status"], comp["status"], http.StatusInternalServerError)
			}
			if got, _ := comp["code_class"].(string); got != string(httpjson.CodeInternalError) {
				t.Errorf("completion code_class = %q, want %q", got, httpjson.CodeInternalError)
			}

			// Redaction across every captured log byte: the raw error text and
			// every concrete identifier paired with it never reach the logs.
			for _, forbidden := range tc.forbidden {
				if strings.Contains(logBuf.String(), forbidden) {
					t.Errorf("captured logs MUST NOT contain %q; logs=%s", forbidden, logBuf.String())
				}
			}
		})
	}
}
