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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
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

// CompanyHandlers exposes each endpoint as a public http.HandlerFunc so the
// composition root (cmd/api/main.go) can apply per-method middleware. This
// mirrors the MemberHandlers pattern in memberHandler.go: the company write
// (POST) needs RequireAuth to resolve the creator subject, while the read
// (GET) stays public, so a single chi.Mount(Routes()) subrouter can't express
// the split — the parent must mount each handler with its own gate.
//
// Companies-write (WU6) adds the two owner-only write endpoints behind
// `r.With(requireOwner)` (see cmd/api/main.go). They share the existing
// `requireCompanyContext` helper (memberHandler.go, same package — no
// duplication per design D14) and the per-method gating style.
type CompanyHandlers struct {
	CreateCompany http.HandlerFunc
	GetCompany    http.HandlerFunc
	UpdateCompany http.HandlerFunc
	DeleteCompany http.HandlerFunc
}

// CompanyHandlers returns the per-endpoint http.HandlerFunc surface for
// main.go to mount with per-method middleware. The returned struct shares
// state with the receiver.
func (h *CompanyHandler) CompanyHandlers() CompanyHandlers {
	return CompanyHandlers{
		CreateCompany: http.HandlerFunc(h.createCompany),
		GetCompany:    http.HandlerFunc(h.getCompany),
		UpdateCompany: http.HandlerFunc(h.updateCompany),
		DeleteCompany: http.HandlerFunc(h.deleteCompany),
	}
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
	ID         string `json:"id"`
	Name       string `json:"name"`
	Rfc        string `json:"rfc"`
	IndustryID string `json:"industry_id"`
	Status     string `json:"status"`

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
	// The company creator is the authenticated subject; RequireAuth (mounted in
	// main.go) has already placed Claims into the request context. A missing
	// subject means the middleware was mis-wired — refuse rather than create an
	// ownerless company.
	claims := security.ClaimsFromContext(r.Context())
	if claims.Subject == "" {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeUnauthenticated), "missing authenticated subject"))
		return
	}

	var req createCompanyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid JSON body"))
		return
	}

	company, err := h.service.CreateCompanyWithOwner(r.Context(), claims.Subject, dtos.CreateCompanyDto{
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
		def := classifyCreateCompanyError(err)
		if def.Code == httpjson.CodeInternalError {
			slog.Error("create company failed", "error", err)
		}
		httpjson.WriteCatalogError(w, def)
		return
	}

	httpjson.WriteJSON(w, http.StatusCreated, toCompanyResponse(company))
}

func (h *CompanyHandler) getCompany(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid company id"))
		return
	}

	company, err := h.service.GetCompanyByID(r.Context(), id)
	if err != nil {
		def := classifyGetCompanyError(err)
		if def.Code == httpjson.CodeInternalError {
			slog.Error("get company failed", "error", err)
		}
		httpjson.WriteCatalogError(w, def)
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

// classifyCreateCompanyError maps a use-case error to a V1 catalog Definition.
// Domain validation → invalid_request, duplicate → already_exists, anything else
// → internal_error. The caller logs the real error when Code is internal_error.
func classifyCreateCompanyError(err error) httpjson.Definition {
	switch {
	case errors.Is(err, entities.ErrUnknownSubject):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeUnauthenticated), err.Error())
	case errors.Is(err, entities.ErrEmptyIndustry),
		errors.Is(err, valueobjects.ErrCompanyNameTooShort),
		errors.Is(err, valueobjects.ErrCompanyRfcInvalidLength),
		errors.Is(err, valueobjects.ErrInvalidCompanySize),
		errors.Is(err, valueobjects.ErrFoundedYearOutOfRange),
		errors.Is(err, valueobjects.ErrCompanyDescriptionTooLong),
		errors.Is(err, entities.ErrIndustryNotFound):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), err.Error())
	case errors.Is(err, entities.ErrDuplicateCompany):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeAlreadyExists), err.Error())
	default:
		return httpjson.Resolve(httpjson.CodeInternalError)
	}
}

// classifyGetCompanyError maps a get-company error to a V1 catalog Definition.
func classifyGetCompanyError(err error) httpjson.Definition {
	switch {
	case errors.Is(err, entities.ErrCompanyNotFound):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeNotFound), err.Error())
	default:
		return httpjson.Resolve(httpjson.CodeInternalError)
	}
}

// --- WU6: PATCH / DELETE /me/company handlers + helpers ---------------------

// updateCompany implements PATCH /me/company (companies-write slice,
// design D12 PATCH flow + D14 wiring). It is mounted in main.go
// behind `r.With(requireOwner).Patch("/me/company", ...)`.
//
// Flow (mirrors the jobs PATCH handler):
//  1. requireCompanyContext (fail-closed 500 if missing).
//  2. Decode the body as dtos.UpdateCompanyDto (400 on malformed JSON).
//  3. Parse `If-Unmodified-Since` via parseIfUnmodifiedSince (RFC
//     3339; absent/malformed → zero time.Time{}).
//  4. Invoke CompanyService.UpdateCompany — passing `cc.UserID` as
//     the second argument so the use case can build the
//     CompanyUpdated audit event with the right actor
//     (companies-audit design D2 / D7).
//  5. ErrConcurrencyConflict → re-project via toCompanyEditorView
//     and write 409 with the editor view as the body (spec R3 —
//     the 409 body MUST use the same shape as the 200).
//  6. Success → 200 + the editor view.
//  7. Other errors → classifyUpdateCompanyError (D14 mapping).
//
// The handler is intentionally thin: the use case owns the
// validation, transition table, CAS logic, and audit event building.
// The handler NEVER builds an `AuditEvent`; the `cc.UserID` is the
// sole actor provenance the use case sees.
func (h *CompanyHandler) updateCompany(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	var in dtos.UpdateCompanyDto
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid JSON body"))
		return
	}

	ifUnmodifiedSince := parseIfUnmodifiedSince(r.Header.Get("If-Unmodified-Since"))

	view, err := h.service.UpdateCompany(r.Context(), cc.CompanyID, cc.UserID, in, ifUnmodifiedSince)
	if err != nil {
		if errors.Is(err, entities.ErrConcurrencyConflict) {
			// 409 envelope carries editor view in data; nil guard handles
			// re-read-after-conflict returning no row (code only, no data).
			if view != nil {
				httpjson.WriteCatalogErrorData(w, httpjson.Resolve(httpjson.CodeConflict), view)
			} else {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeConflict))
			}
			return
		}
		def := classifyUpdateCompanyError(err)
		if def.Code == httpjson.CodeInternalError {
			slog.Error("update company failed", "company_id", cc.CompanyID, "error", err)
		}
		httpjson.WriteCatalogError(w, def)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, view)
}

// deleteCompany implements DELETE /me/company (companies-write slice,
// design D12 DELETE flow + D14 wiring). It is mounted in main.go
// behind `r.With(requireOwner).Delete("/me/company", ...)`.
//
// Flow:
//  1. requireCompanyContext (fail-closed 500 if missing).
//  2. Parse `If-Unmodified-Since` (RFC 3339; absent/malformed →
//     zero time.Time{}, which the CAS compare treats as a
//     guaranteed mismatch).
//  3. Invoke CompanyService.SoftDeleteCompany — passing `cc.UserID`
//     so the use case can build the CompanyDeleted audit event with
//     the right actor (companies-audit design D2 / D7).
//  4. ErrConcurrencyConflict → 409 with EMPTY body (spec R4 / D12
//     DELETE asymmetry: PATCH 409 carries the editor view; DELETE
//     409 is intentionally empty because the success path is 204
//     and a structured 409 body would only add transient state to
//     the wire).
//  5. Success → 204 No Content with empty body (no editor view
//     projected — D12 step 4).
//  6. Other errors → classifyDeleteCompanyError (including the
//     `ErrMissingActorIdentity → 500` branch added in WU2 per D6).
//
// The handler NEVER builds an `AuditEvent`; the `cc.UserID` is the
// sole actor provenance the use case sees.
func (h *CompanyHandler) deleteCompany(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	ifUnmodifiedSince := parseIfUnmodifiedSince(r.Header.Get("If-Unmodified-Since"))

	if err := h.service.SoftDeleteCompany(r.Context(), cc.CompanyID, cc.UserID, ifUnmodifiedSince); err != nil {
		if errors.Is(err, entities.ErrConcurrencyConflict) {
			// 409: catalog envelope, no data (DELETE asymmetry from PATCH).
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeConflict))
			return
		}
		def := classifyDeleteCompanyError(err)
		if def.Code == httpjson.CodeInternalError {
			slog.Error("delete company failed", "company_id", cc.CompanyID, "error", err)
		}
		httpjson.WriteCatalogError(w, def)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// parseIfUnmodifiedSince parses the `If-Unmodified-Since` header
// value as RFC 3339 (companies-write slice, design D14).
//
// Absent or malformed headers collapse to the zero `time.Time{}` so
// the use case's CAS compare sees a guaranteed mismatch (a zero
// token never equals a real row's `UpdatedAt`) — same outcome as a
// stale CAS, which is exactly the spec scenarios "missing
// If-Unmodified-Since returns 409" and "malformed If-Unmodified-Since
// returns 409".
//
// The function is intentionally duplicated from
// `jobs/infrastructure/http/jobHandler.go::parseIfUnmodifiedSince`
// (~10 lines, RFC 3339 whole-second parse). The companies handler
// MUST NOT import the jobs handler across the jobs/companies
// boundary — per design D14, the duplication keeps each slice
// self-contained.
func parseIfUnmodifiedSince(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return t
}

// classifyUpdateCompanyError maps PATCH errors to V1 catalog Definition
// (design D14 + companies-audit D6).
func classifyUpdateCompanyError(err error) httpjson.Definition {
	switch {
	case errors.Is(err, usecases.ErrMissingActorIdentity):
		return httpjson.Resolve(httpjson.CodeInternalError)
	case errors.Is(err, entities.ErrConcurrencyConflict):
		return httpjson.Resolve(httpjson.CodeConflict)
	case errors.Is(err, entities.ErrCompanyNotFound):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeNotFound), err.Error())
	case errors.Is(err, valueobjects.ErrCompanyNameTooShort),
		errors.Is(err, valueobjects.ErrInvalidCompanySize),
		errors.Is(err, valueobjects.ErrFoundedYearOutOfRange),
		errors.Is(err, valueobjects.ErrCompanyDescriptionTooLong),
		errors.Is(err, entities.ErrInvalidCompanyStatusTransition):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), err.Error())
	default:
		return httpjson.Resolve(httpjson.CodeInternalError)
	}
}

// classifyDeleteCompanyError maps DELETE errors to V1 catalog Definition
// (design D14 + companies-audit D6).
func classifyDeleteCompanyError(err error) httpjson.Definition {
	switch {
	case errors.Is(err, usecases.ErrMissingActorIdentity):
		return httpjson.Resolve(httpjson.CodeInternalError)
	case errors.Is(err, entities.ErrConcurrencyConflict):
		return httpjson.Resolve(httpjson.CodeConflict)
	case errors.Is(err, entities.ErrCompanyNotFound):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeNotFound), err.Error())
	case errors.Is(err, entities.ErrInvalidCompanyStatusTransition):
		return httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), err.Error())
	default:
		return httpjson.Resolve(httpjson.CodeInternalError)
	}
}

// requireCompanyContext is intentionally NOT defined here — it
// already lives in memberHandler.go (the same package) and is
// shared by both the membership subtree handlers and the new
// companies-write PATCH/DELETE handlers (design D14 — same
// package, no duplication). The compile-time assertion in the
// package file (memberHandler.go) holds.
