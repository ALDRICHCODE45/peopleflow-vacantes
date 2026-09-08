// Package http exposes the candidates bounded-context HTTP handlers.
// The handler is mounted by the auth wiring (WU5) under
// /me/profile and /me/profile/languages. It is the thin transport
// adapter: it reads the JWT subject from the request context, hands
// it to the use case, and translates domain errors to HTTP statuses
// via classifyCandidateError.
package http

import (
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
	chimw "github.com/go-chi/chi/v5/middleware"
)

// maxJSONBodyBytes is the package-local request-body decode cap shared by
// every JSON-accepting handler in this package (WS6B-2 Wave B).
const maxJSONBodyBytes int64 = 1_048_576

// writeDecodeFailure writes a shared-decoder failure through the single
// candidates encoding point: invalid_request keeps the exact safe message
// ("invalid JSON body"); every other code — notably payload_too_large —
// is written with its canonical catalog message.
func writeDecodeFailure(w http.ResponseWriter, def *httpjson.Definition) {
	if def.Code == httpjson.CodeInvalidRequest {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(*def, "invalid JSON body"))
		return
	}
	httpjson.WriteCatalogError(w, *def)
}

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

// upsertProfileRequest is the body for PUT /me/profile. PUT has
// full-replacement semantics: every client-owned field is optional on
// the wire, and an omitted or JSON-null nullable field is persisted as
// SQL NULL (never "left unchanged"). Skills is normalized (lowercased,
// trimmed, deduped) inside the use case. The reserved cv_s3_key column
// has no request field: a client-supplied value is ignored.
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
	FieldOfStudy   *string `json:"field_of_study"`

	Skills []string `json:"skills"`

	CurrentSalaryGross   *int    `json:"current_salary_gross"`
	CurrentSalaryNet     *int    `json:"current_salary_net"`
	ExpectedSalary       *int    `json:"expected_salary"`
	SalaryCurrency       *string `json:"salary_currency"`
	ExpectedSalaryPeriod *string `json:"expected_salary_period"`
}

// candidateProfileResponse is the JSON shape for /me/profile. It is
// the full entity minus server-managed identity/timestamps handling —
// self-service, the caller is the owner per the IDOR-resistant sub →
// id resolution. The reserved cv_s3_key is never exposed on the wire,
// even when a value exists in the DB.
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
		def := classifyCandidateError(err)
		if def.Code == httpjson.CodeInternalError {
			// Bounded unexpected-error record (WS6C-7C, mirroring the
			// committed WS6C-7B upsert): fixed message + catalog code_class,
			// plus request_id read ONLY from the existing chi request-ID
			// context and omitted when no RequestID middleware set one.
			// No method, path, or raw error content — the request
			// middleware owns bounded request correlation.
			attrs := []any{"code_class", def.Code}
			if reqID := chimw.GetReqID(r.Context()); reqID != "" {
				attrs = append(attrs, "request_id", reqID)
			}
			slog.Error("get my profile failed", attrs...)
		}
		httpjson.WriteCatalogError(w, def)
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
	if def := httpjson.DecodeJSON(w, r, &req, maxJSONBodyBytes); def != nil {
		writeDecodeFailure(w, def)
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
	})
	if err != nil {
		def := classifyCandidateError(err)
		if def.Code == httpjson.CodeInternalError {
			// Bounded unexpected-error record (WS6C-7B, mirroring the
			// committed jobs handler): fixed message + catalog code_class,
			// plus request_id read ONLY from the existing chi request-ID
			// context and omitted when no RequestID middleware set one.
			// No method, path, or raw error content — the request
			// middleware owns bounded request correlation.
			attrs := []any{"code_class", def.Code}
			if reqID := chimw.GetReqID(r.Context()); reqID != "" {
				attrs = append(attrs, "request_id", reqID)
			}
			slog.Error("upsert my profile failed", attrs...)
		}
		httpjson.WriteCatalogError(w, def)
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
		def := classifyCandidateError(err)
		if def.Code == httpjson.CodeInternalError {
			// Bounded unexpected-error record (WS6C-7D, mirroring the
			// committed WS6C-7B/7C upsert and get): fixed message + catalog
			// code_class, plus request_id read ONLY from the existing chi
			// request-ID context and omitted when no RequestID middleware
			// set one. No method, path, or raw error content — the request
			// middleware owns bounded request correlation.
			attrs := []any{"code_class", def.Code}
			if reqID := chimw.GetReqID(r.Context()); reqID != "" {
				attrs = append(attrs, "request_id", reqID)
			}
			slog.Error("list my languages failed", attrs...)
		}
		httpjson.WriteCatalogError(w, def)
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
	if def := httpjson.DecodeJSON(w, r, &req, maxJSONBodyBytes); def != nil {
		writeDecodeFailure(w, def)
		return
	}

	dto := dtos.ReplaceMyLanguagesDto{
		Languages: make([]dtos.LanguageDto, 0, len(req.Languages)),
	}
	for _, l := range req.Languages {
		dto.Languages = append(dto.Languages, dtos.LanguageDto{Name: l.Name, Level: l.Level})
	}

	if err := h.service.ReplaceMyLanguages(r.Context(), sub, dto); err != nil {
		def := classifyCandidateError(err)
		if def.Code == httpjson.CodeInternalError {
			slog.Error("replace my languages failed", "error", err)
		}
		httpjson.WriteCatalogError(w, def)
		return
	}

	// Echo the canonical, post-normalization list back to the caller so
	// the client can confirm what landed. The repository just stored it.
	fresh, err := h.service.ListMyLanguages(r.Context(), sub)
	if err != nil {
		def := classifyCandidateError(err)
		if def.Code == httpjson.CodeInternalError {
			slog.Error("replace my languages: post-write read failed", "error", err)
		}
		httpjson.WriteCatalogError(w, def)
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
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeUnauthenticated), "missing authenticated subject"))
		return "", false
	}
	return claims.Subject, true
}

// classifyCandidateError maps a domain sentinel to a V1 catalog Definition.
// Adding a new sentinel means adding one branch here — no other call site
// needs to change.
func classifyCandidateError(err error) httpjson.Definition {
	switch {
	case errors.Is(err, usecases.ErrUnknownSubject):
		return httpjson.Resolve(httpjson.CodeUnauthenticated)
	case errors.Is(err, valueobjects.ErrInvalidCefrLevel),
		errors.Is(err, valueobjects.ErrInvalidEducationLevel),
		errors.Is(err, valueobjects.ErrInvalidSalaryPeriod),
		errors.Is(err, usecases.ErrInvalidBirthDate),
		errors.Is(err, entities.ErrDuplicateLanguage),
		errors.Is(err, entities.ErrEmptyUserIDForProfile):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), err.Error())
	case errors.Is(err, entities.ErrProfileNotFound):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeNotFound), "candidate profile not found")
	default:
		return httpjson.Resolve(httpjson.CodeInternalError)
	}
}
