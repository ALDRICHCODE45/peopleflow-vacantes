// Package http exposes the companies bounded-context HTTP handlers.
package http

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// CompanyHandler adapts the companies use cases to the HTTP transport.
type CompanyHandler struct {
	service *usecases.CompanyService
}

// NewCompanyHandler builds the handler around the companies use case.
func NewCompanyHandler(service *usecases.CompanyService) *CompanyHandler {
	return &CompanyHandler{service: service}
}

// Routes returns the feature-scoped router, mounted under /companies.
func (h *CompanyHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.createCompany)
	r.Get("/{id}", h.getCompany)
	return r
}

// createCompanyRequest is the JSON body accepted by POST /companies. Optional
// profile fields stay as raw strings/numbers so the use case owns parsing
// and validation against the domain value objects.
type createCompanyRequest struct {
	Name       string  `json:"name"`
	Rfc        string  `json:"rfc"`
	IndustryID string  `json:"industry_id"`
	Website    *string `json:"website"`
	LogoURL    *string `json:"logo_url"`

	Description *string `json:"description"`
	Size        *string `json:"size"`
	FoundedYear *int    `json:"founded_year"`

	City        *string `json:"city"`
	Country     *string `json:"country"`
	LinkedInURL *string `json:"linkedin_url"`

	InstagramURL  *string `json:"instagram_url"`
	FacebookURL   *string `json:"facebook_url"`
	TwitterURL    *string `json:"twitter_url"`
	CoverImageURL *string `json:"cover_image_url"`
}

// companyResponse is the JSON shape returned by the create endpoint. It is the
// full record (including rfc/status) because the creator just submitted it.
type companyResponse struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Rfc        string    `json:"rfc"`
	IndustryID string    `json:"industry_id"`
	Status     string    `json:"status"`

	Website *string `json:"website,omitempty"`
	LogoURL *string `json:"logo_url,omitempty"`

	Description *string `json:"description,omitempty"`
	Size        *string `json:"size,omitempty"`
	FoundedYear *int    `json:"founded_year,omitempty"`

	City        *string `json:"city,omitempty"`
	Country     *string `json:"country,omitempty"`
	LinkedInURL *string `json:"linkedin_url,omitempty"`

	InstagramURL  *string `json:"instagram_url,omitempty"`
	FacebookURL   *string `json:"facebook_url,omitempty"`
	TwitterURL    *string `json:"twitter_url,omitempty"`
	CoverImageURL *string `json:"cover_image_url,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// companyPublicResponse is the redacted JSON shape for the public company
// profile (candidate-facing). It omits rfc (tax ID) and status (internal)
// but exposes all the public-facing profile fields.
type companyPublicResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IndustryID string `json:"industry_id"`

	Website *string `json:"website,omitempty"`
	LogoURL *string `json:"logo_url,omitempty"`

	Description *string `json:"description,omitempty"`
	Size        *string `json:"size,omitempty"`
	FoundedYear *int    `json:"founded_year,omitempty"`

	City        *string `json:"city,omitempty"`
	Country     *string `json:"country,omitempty"`
	LinkedInURL *string `json:"linkedin_url,omitempty"`

	InstagramURL  *string `json:"instagram_url,omitempty"`
	FacebookURL   *string `json:"facebook_url,omitempty"`
	TwitterURL    *string `json:"twitter_url,omitempty"`
	CoverImageURL *string `json:"cover_image_url,omitempty"`
}

func (h *CompanyHandler) createCompany(w http.ResponseWriter, r *http.Request) {
	var req createCompanyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	company, err := h.service.CreateCompany(r.Context(), dtos.CreateCompanyDto{
		Name:          req.Name,
		Rfc:           req.Rfc,
		IndustryID:    req.IndustryID,
		Website:       req.Website,
		LogoURL:       req.LogoURL,
		Description:   req.Description,
		Size:          req.Size,
		FoundedYear:   req.FoundedYear,
		City:          req.City,
		Country:       req.Country,
		LinkedInURL:   req.LinkedInURL,
		InstagramURL:  req.InstagramURL,
		FacebookURL:   req.FacebookURL,
		TwitterURL:    req.TwitterURL,
		CoverImageURL: req.CoverImageURL,
	})
	if err != nil {
		status, msg := classifyCreateCompanyError(err)
		if status == http.StatusInternalServerError {
			slog.Error("create company failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	httpjson.WriteJSON(w, http.StatusCreated, toCompanyResponse(company))
}

func (h *CompanyHandler) getCompany(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid company id")
		return
	}

	company, err := h.service.GetCompanyByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, entities.ErrCompanyNotFound) {
			httpjson.WriteError(w, http.StatusNotFound, "company not found")
			return
		}

		slog.Error("get company failed", "error", err)
		httpjson.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toCompanyPublicResponse(company))
}

// toCompanyResponse maps the domain entity into the create response shape.
func toCompanyResponse(c *entities.Company) companyResponse {
	return companyResponse{
		ID:            c.ID.String(),
		Name:          c.Name.Value(),
		Rfc:           c.Rfc.Value(),
		IndustryID:    c.IndustryID,
		Status:        c.Status.String(),
		Website:       c.Website,
		LogoURL:       c.LogoURL,
		Description:   descriptionToStringPtr(c.Description),
		Size:          sizeToStringPtr(c.Size),
		FoundedYear:   foundedYearToIntPtr(c.FoundedYear),
		City:          c.City,
		Country:       c.Country,
		LinkedInURL:   c.LinkedInURL,
		InstagramURL:  c.InstagramURL,
		FacebookURL:   c.FacebookURL,
		TwitterURL:    c.TwitterURL,
		CoverImageURL: c.CoverImageURL,
		CreatedAt:     c.CreatedAt,
		UpdatedAt:     c.UpdatedAt,
	}
}

// toCompanyPublicResponse maps the domain entity into the redacted public shape.
func toCompanyPublicResponse(c *entities.Company) companyPublicResponse {
	return companyPublicResponse{
		ID:            c.ID.String(),
		Name:          c.Name.Value(),
		IndustryID:    c.IndustryID,
		Website:       c.Website,
		LogoURL:       c.LogoURL,
		Description:   descriptionToStringPtr(c.Description),
		Size:          sizeToStringPtr(c.Size),
		FoundedYear:   foundedYearToIntPtr(c.FoundedYear),
		City:          c.City,
		Country:       c.Country,
		LinkedInURL:   c.LinkedInURL,
		InstagramURL:  c.InstagramURL,
		FacebookURL:   c.FacebookURL,
		TwitterURL:    c.TwitterURL,
		CoverImageURL: c.CoverImageURL,
	}
}

func descriptionToStringPtr(d *valueobjects.CompanyDescription) *string {
	if d == nil {
		return nil
	}
	v := d.Value()
	return &v
}

func sizeToStringPtr(s *valueobjects.CompanySize) *string {
	if s == nil {
		return nil
	}
	v := s.String()
	return &v
}

func foundedYearToIntPtr(y *valueobjects.FoundedYear) *int {
	if y == nil {
		return nil
	}
	v := y.Value()
	return &v
}

// classifyCreateCompanyError maps a use-case error to an HTTP status and a
// client-safe message. Domain validation → 400, conflict → 409, anything else
// → 500 with a generic message (the real error is logged separately).
func classifyCreateCompanyError(err error) (int, string) {
	switch {
	case errors.Is(err, entities.ErrEmptyIndustry),
		errors.Is(err, valueobjects.ErrCompanyNameTooShort),
		errors.Is(err, valueobjects.ErrCompanyRfcInvalidLength),
		errors.Is(err, valueobjects.ErrInvalidCompanySize),
		errors.Is(err, valueobjects.ErrFoundedYearOutOfRange),
		errors.Is(err, valueobjects.ErrCompanyDescriptionTooLong),
		errors.Is(err, entities.ErrIndustryNotFound):
		return http.StatusBadRequest, err.Error()
	case errors.Is(err, entities.ErrDuplicateCompany):
		return http.StatusConflict, err.Error()
	default:
		return http.StatusInternalServerError, "internal server error"
	}
}
