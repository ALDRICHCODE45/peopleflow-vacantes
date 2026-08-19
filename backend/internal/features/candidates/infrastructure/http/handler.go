// Package http exposes the candidates bounded-context HTTP handlers.
// The handler is mounted by the auth wiring (WU5) under
// /me/profile and /me/profile/languages. It is the thin transport
// adapter: it reads the JWT subject from the request context, hands
// it to the use case, and translates domain errors to HTTP statuses
// via classifyCandidateError.
package http

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
)

// CandidateHandler is the HTTP adapter for the candidates use cases.
// It depends only on the application service; the persistence and
// identity ports are owned by the service.
type CandidateHandler struct {
	service *usecases.CandidateService
}

// NewCandidateHandler wires the handler around the candidates service.
// Composition root (cmd/api/main.go) builds the service and passes it
// in; this constructor does no IO.
func NewCandidateHandler(service *usecases.CandidateService) *CandidateHandler {
	return &CandidateHandler{service: service}
}

// Routes returns the feature-scoped router. The mount prefix in
// main.go is /me/profile, so the full paths are:
//
//	GET    /me/profile/              → getMyProfile
//	PUT    /me/profile/              → upsertMyProfile
//	GET    /me/profile/languages/    → listMyLanguages
//	PUT    /me/profile/languages/    → replaceMyLanguages
//
// No {userID} segment is exposed — path-id IDOR is structurally
// impossible because the JWT subject is the only identifier.
func (h *CandidateHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.getMyProfile)
	r.Put("/", h.upsertMyProfile)
	r.Get("/languages/", h.listMyLanguages)
	r.Put("/languages/", h.replaceMyLanguages)
	return r
}

// --- request / response shapes --------------------------------------------

// upsertProfileRequest is the body for PUT /me/profile. Every field
// is optional; nil means "leave unchanged on update" / "leave NULL on
// insert". Skills is normalized (lowercased, trimmed, deduped) inside
// the use case.
type upsertProfileRequest struct {
	Phone             *string `json:"phone"`
	LinkedInURL       *string `json:"linkedin_url"`
	PortfolioURL      *string `json:"portfolio_url"`
	ProfessionalTitle *string `json:"professional_title"`
	CurrentCompany    *string `json:"current_company"`
	YearsOfExperience *int    `json:"years_of_experience"`
	ProfileSummary    *string `json:"profile_summary"`

	BirthDate *string `json:"birth_date"` // YYYY-MM-DD; parsed by the use case.

	City    *string `json:"city"`
	Country *string `json:"country"`

	EducationLevel *string `json:"education_level"`
	FieldOfStudy   *string `json:"field_of study"`

	Skills []string `json:"skills"`

	CurrentSalaryGross   *int    `json:"current_salary_gross"`
	CurrentSalaryNet     *int    `json:"current_salary_net"`
	ExpectedSalary       *int    `json:"expected_salary"`
	SalaryCurrency       *string `json:"salary_currency"`
	ExpectedSalaryPeriod *string `json:"expected_salary_period"`

	CVS3Key *string `json:"cv_s3_key"`
}

// candidateProfileResponse is the JSON shape for /me/profile. It is
// the full entity (no redaction needed — self-service, the caller is
// the owner per the IDOR-resistant sub → id resolution).
type candidateProfileResponse struct {
	UserID string `json:"user_id"`

	Phone             *string `json:"phone,omitempty"`
	LinkedInURL       *string `json:"linkedin_url,omitempty"`
	PortfolioURL      *string `json:"portfolio_url,omitempty"`
	ProfessionalTitle *string `json:"professional_title,omitempty"`
	CurrentCompany    *string `json:"current_company,omitempty"`
	YearsOfExperience *int    `json:"years_of_experience,omitempty"`
	ProfileSummary    *string `json:"profile_summary,omitempty"`

	BirthDate *string `json:"birth_date,omitempty"`
	City      *string `json:"city,omitempty"`
	Country   *string `json:"country,omitempty"`

	EducationLevel *string `json:"education_level,omitempty"`
	FieldOfStudy   *string `json:"field_of_study,omitempty"`

	Skills []string `json:"skills,omitempty"`

	CurrentSalaryGross   *int    `json:"current_salary_gross,omitempty"`
	CurrentSalaryNet     *int    `json:"current_salary_net,omitempty"`
	ExpectedSalary       *int    `json:"expected_salary,omitempty"`
	SalaryCurrency       string  `json:"salary_currency"`
	ExpectedSalaryPeriod *string `json:"expected_salary_period,omitempty"`

	CVS3Key *string `json:"cv_s3_key,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// languageEntry is one item on the languages list response.
type languageEntry struct {
	Name  string `json:"name"`
	Level string `json:"level"`
}

// languagesResponse is the wire shape for /me/profile/languages. The
// slice is always non-nil so the JSON encoder produces "[]" not
// "null" — clients depend on the array shape.
type languagesResponse struct {
	Languages []languageEntry `json:"languages"`
}

// replaceLanguagesRequest is the body for PUT /me/profile/languages.
type replaceLanguagesRequest struct {
	Languages []struct {
		Name  string `json:"name"`
		Level string `json:"level"`
	} `json:"languages"`
}

// --- handlers --------------------------------------------------------------

func (h *CandidateHandler) getMyProfile(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireSub(w, r)
	if !ok {
		return
	}

	profile, err := h.service.GetMyProfile(r.Context(), sub)
	if err != nil {
		status, msg := classifyCandidateError(err)
		if status == http.StatusInternalServerError {
			slog.Error("get my profile failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toProfileResponse(profile))
}

func (h *CandidateHandler) upsertMyProfile(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireSub(w, r)
	if !ok {
		return
	}

	var req upsertProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	profile, err := h.service.UpsertMyProfile(r.Context(), sub, dtos.UpsertMyProfileDto{
		Phone:                req.Phone,
		LinkedInURL:          req.LinkedInURL,
		PortfolioURL:         req.PortfolioURL,
		ProfessionalTitle:    req.ProfessionalTitle,
		CurrentCompany:       req.CurrentCompany,
		YearsOfExperience:    req.YearsOfExperience,
		ProfileSummary:       req.ProfileSummary,
		BirthDate:            req.BirthDate,
		City:                 req.City,
		Country:              req.Country,
		EducationLevel:       req.EducationLevel,
		FieldOfStudy:         req.FieldOfStudy,
		Skills:               req.Skills,
		CurrentSalaryGross:   req.CurrentSalaryGross,
		CurrentSalaryNet:     req.CurrentSalaryNet,
		ExpectedSalary:       req.ExpectedSalary,
		SalaryCurrency:       req.SalaryCurrency,
		ExpectedSalaryPeriod: req.ExpectedSalaryPeriod,
		CVS3Key:              req.CVS3Key,
	})
	if err != nil {
		status, msg := classifyCandidateError(err)
		if status == http.StatusInternalServerError {
			slog.Error("upsert my profile failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toProfileResponse(profile))
}

func (h *CandidateHandler) listMyLanguages(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireSub(w, r)
	if !ok {
		return
	}

	languages, err := h.service.ListMyLanguages(r.Context(), sub)
	if err != nil {
		status, msg := classifyCandidateError(err)
		if status == http.StatusInternalServerError {
			slog.Error("list my languages failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toLanguagesResponse(languages))
}

func (h *CandidateHandler) replaceMyLanguages(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireSub(w, r)
	if !ok {
		return
	}

	var req replaceLanguagesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	dto := dtos.ReplaceMyLanguagesDto{
		Languages: make([]dtos.LanguageDto, 0, len(req.Languages)),
	}
	for _, l := range req.Languages {
		dto.Languages = append(dto.Languages, dtos.LanguageDto{Name: l.Name, Level: l.Level})
	}

	if err := h.service.ReplaceMyLanguages(r.Context(), sub, dto); err != nil {
		status, msg := classifyCandidateError(err)
		if status == http.StatusInternalServerError {
			slog.Error("replace my languages failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	// Echo the canonical, post-normalization list back to the caller so
	// the client can confirm what landed. The repository just stored it.
	fresh, err := h.service.ListMyLanguages(r.Context(), sub)
	if err != nil {
		status, msg := classifyCandidateError(err)
		if status == http.StatusInternalServerError {
			slog.Error("replace my languages: post-write read failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, toLanguagesResponse(fresh))
}

// --- mappers / classifiers -------------------------------------------------

// toProfileResponse maps the domain entity into the response shape. The
// entity's value objects (EducationLevel, SalaryPeriod) are reduced to
// their canonical wire form; the optional pointers stay as-is so the
// JSON encoder drops them with `omitempty`.
func toProfileResponse(p *entities.CandidateProfile) candidateProfileResponse {
	resp := candidateProfileResponse{
		UserID:             p.UserID,
		Phone:              p.Phone,
		LinkedInURL:        p.LinkedInURL,
		PortfolioURL:       p.PortfolioURL,
		ProfessionalTitle:  p.ProfessionalTitle,
		CurrentCompany:     p.CurrentCompany,
		YearsOfExperience:  p.YearsOfExperience,
		ProfileSummary:     p.ProfileSummary,
		City:               p.City,
		Country:            p.Country,
		FieldOfStudy:       p.FieldOfStudy,
		Skills:             p.Skills,
		CurrentSalaryGross: p.CurrentSalaryGross,
		CurrentSalaryNet:   p.CurrentSalaryNet,
		ExpectedSalary:     p.ExpectedSalary,
		SalaryCurrency:     p.SalaryCurrency,
		CVS3Key:            p.CVS3Key,
		CreatedAt:          p.CreatedAt,
		UpdatedAt:          p.UpdatedAt,
	}
	if p.EducationLevel != nil {
		s := p.EducationLevel.String()
		resp.EducationLevel = &s
	}
	if p.ExpectedSalaryPeriod != nil {
		s := p.ExpectedSalaryPeriod.String()
		resp.ExpectedSalaryPeriod = &s
	}
	if p.BirthDate != nil {
		s := p.BirthDate.Format("2006-01-02")
		resp.BirthDate = &s
	}
	return resp
}

func toLanguagesResponse(in []entities.Language) languagesResponse {
	out := languagesResponse{Languages: make([]languageEntry, 0, len(in))}
	for _, l := range in {
		out.Languages = append(out.Languages, languageEntry{
			Name:  l.Name,
			Level: l.Level.String(),
		})
	}
	return out
}

// requireSub extracts the JWT subject from the request context. The
// production wiring places claims via identityhttp.RequireAuth; tests
// inject them directly with identitysecurity.ContextWithClaims. If
// the auth middleware was bypassed (or ran with an empty sub), we
// return 401 here so the handler never reaches the use case with a
// blank subject.
func requireSub(w http.ResponseWriter, r *http.Request) (string, bool) {
	claims := identitysecurity.ClaimsFromContext(r.Context())
	if claims.Subject == "" {
		httpjson.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return "", false
	}
	return claims.Subject, true
}

// classifyCandidateError is the flat errors.Is dispatcher for every
// domain sentinel the use cases can surface. Adding a new sentinel
// means adding one branch here — no other call site needs to change.
func classifyCandidateError(err error) (int, string) {
	switch {
	case errors.Is(err, usecases.ErrUnknownSubject):
		return http.StatusUnauthorized, "unauthorized"
	case errors.Is(err, valueobjects.ErrInvalidCefrLevel),
		errors.Is(err, valueobjects.ErrInvalidEducationLevel),
		errors.Is(err, valueobjects.ErrInvalidSalaryPeriod),
		errors.Is(err, entities.ErrDuplicateLanguage),
		errors.Is(err, entities.ErrEmptyUserIDForProfile):
		return http.StatusBadRequest, err.Error()
	case errors.Is(err, entities.ErrProfileNotFound):
		return http.StatusNotFound, "candidate profile not found"
	default:
		return http.StatusInternalServerError, "internal server error"
	}
}
