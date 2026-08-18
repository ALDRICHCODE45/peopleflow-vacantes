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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// stubRepo is a hand-rolled stub of repositories.CompanyRepository. It records
// the last Create input and returns whatever is programmed into it. We keep it
// in this package so HTTP tests don't have to depend on anything outside.
type stubRepo struct {
	mu      sync.Mutex
	created *entities.Company
	cErr    error
	getID   uuid.UUID
	getOut  *entities.Company
	getErr  error
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

func newTestHandler(repo *stubRepo) *CompanyHandler {
	svc := usecases.NewCompanyService(repo)
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
	repo := &stubRepo{cErr: entities.ErrDuplicateCompany}
	router := newTestRouter(newTestHandler(repo))

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

// ensure dtos.CreateCompanyDto is referenced for compile safety
var _ = dtos.CreateCompanyDto{}
