// Package http exposes the companies bounded-context HTTP handlers.
//
// The MemberHandler is the transport adapter for the company_membership
// subdomain — it owns the five routes under /me/company that the spec
// requires (GetMyMembership, ListMembers, AddMember, UpdateRole,
// RemoveMember). It composes against the CompanyMemberService, NOT
// directly against the repository (the service owns the IDOR-resistant
// `sub → users.id → company_members` resolver chain — design D6).
//
// Authorization layering (production wiring):
//
//	GET    /me/company              — behind RequireAuth only (UNGATED)
//	GET    /me/company/members      — behind RequireAuth + RequireCompanyRole(recruiter) (GATED)
//	POST   /me/company/members      — behind RequireAuth + RequireCompanyRole(owner)      (GATED)
//	PATCH  /me/company/members/{id} — behind RequireAuth + RequireCompanyRole(owner)      (GATED)
//	DELETE /me/company/members/{id} — behind RequireAuth + RequireCompanyRole(owner)      (GATED)
//
// D6 — "resolves once" contract: the middleware resolves the
// `sub → users.id → company_members` chain ONCE per request and injects
// the result as `security.CompanyContext{company_id, role}` into the
// request context. The four GATED handlers read it via
// `security.CompanyContextFromContext` (wrapped by the
// `requireCompanyContext` helper) and pass `cc.CompanyID` straight to
// the service — the JWT subject is NEVER consulted again on the gated
// path, so the gated use cases no longer need (and no longer accept)
// a `cognitoSub` argument. The UNGATED `getMyMembership` handler reads
// the JWT subject via `requireSub` (the middleware does not run there
// — no role gate).
package http

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// MemberHandler is the HTTP adapter for the company_membership use
// cases. It depends only on the application service; the persistence
// and identity ports are owned by the service.
type MemberHandler struct {
	service *usecases.CompanyMemberService
}

// NewMemberHandler wires the handler around the membership service.
// Composition root (cmd/api/main.go, WU4) builds the service and passes
// it in; this constructor does no IO.
func NewMemberHandler(service *usecases.CompanyMemberService) *MemberHandler {
	return &MemberHandler{service: service}
}

// Routes returns the feature-scoped router, mounted under /me/company.
// The full paths are:
//
//	GET    /me/company             → getMyMembership
//	GET    /me/company/members     → listMembers
//	POST   /me/company/members     → addMember
//	PATCH  /me/company/members/{id} → updateMemberRole
//	DELETE /me/company/members/{id} → removeMember
//
// Authorization is layered in main.go (WU4): every route here assumes
// the request context already carries identitysecurity.Claims (RequireAuth
// runs first) and that role gates have already filtered non-members
// out of the mutations (RequireCompanyRole).
func (h *MemberHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.getMyMembership)
	r.Get("/members", h.listMembers)
	r.Post("/members", h.addMember)
	r.Route("/members/{id}", func(r chi.Router) {
		r.Patch("/", h.updateMemberRole)
		r.Delete("/", h.removeMember)
	})
	return r
}

// MemberHandlers exposes each endpoint as a public http.HandlerFunc so
// the composition root (cmd/api/main.go, WU4) can apply per-method
// middleware — specifically, the per-route RequireCompanyRole gates
// the spec demands. The chi subrouter returned by Routes() bundles all
// five endpoints with NO gates; that surface is exercised by the
// handler-level unit tests where the test injects the JWT subject
// directly into the context. The production wiring layers
// `r.With(requireOwner)` (or recruiter) at the parent for each method.
//
// Each field is a thin http.HandlerFunc adapter over the unexported
// method body; the unexported bodies stay in this file so the handler
// stays the single source of truth for endpoint logic. Tests that need
// to call an individual handler directly use these adapters instead
// of poking at unexported methods.
type MemberHandlers struct {
	GetMyMembership  http.HandlerFunc
	ListMembers      http.HandlerFunc
	AddMember        http.HandlerFunc
	UpdateMemberRole http.HandlerFunc
	RemoveMember     http.HandlerFunc
}

// MemberHandlers returns the per-endpoint http.HandlerFunc surface for
// main.go to mount with per-method middleware. The returned struct
// shares state with the receiver — calling any of its handler funcs
// is exactly equivalent to calling the corresponding unexported
// method body.
func (h *MemberHandler) MemberHandlers() MemberHandlers {
	return MemberHandlers{
		GetMyMembership:  http.HandlerFunc(h.getMyMembership),
		ListMembers:      http.HandlerFunc(h.listMembers),
		AddMember:        http.HandlerFunc(h.addMember),
		UpdateMemberRole: http.HandlerFunc(h.updateMemberRole),
		RemoveMember:     http.HandlerFunc(h.removeMember),
	}
}

// --- request / response shapes ---------------------------------------------

// addMemberRequest is the JSON body accepted by POST /me/company/members.
// CompanyID is intentionally absent: the spec scenario "body company_id
// is ignored" forbids resolving the row from the body; the service
// resolves company_id from the caller's membership row, period. The
// field is documented as ignored on the DTO and tested as such in
// companyMemberService_test.go::TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID.
type addMemberRequest struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}

// updateMemberRoleRequest is the JSON body accepted by PATCH
// /me/company/members/{id}. Only `role` is patchable; the target id
// comes from the URL path.
type updateMemberRoleRequest struct {
	Role string `json:"role"`
}

// memberResponse is the wire shape for a single membership record.
// Returned by GetMyMembership, AddMember, and PATCH responses.
type memberResponse struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	CompanyID string `json:"company_id"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// companySummaryResponse is the wire shape for the company record
// embedded in the GetMyMembership response. We use a minimal subset of
// the public company profile shape; this is intentionally not a full
// Company entity because the spec scenario "owner gets their membership"
// only requires the (company_id, role) + company record.
//
// (Named "companySummaryResponse" instead of "companyResponse" to
// avoid the name collision with the full-record response shape in
// handler.go.)
type companySummaryResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Rfc        string `json:"rfc"`
	IndustryID string `json:"industry_id"`
	Status     string `json:"status"`
}

// myMembershipResponse is the wire shape for GET /me/company. It is the
// union of (company_id, role) + company record (spec scenario "owner
// gets their membership").
type myMembershipResponse struct {
	CompanyID string                 `json:"company_id"`
	Role      string                 `json:"role"`
	Company   companySummaryResponse `json:"company"`
}

// listMembersResponse is the wire shape for GET /me/company/members.
// The slice is always non-nil so JSON encoding produces `[]` not `null`
// — clients depend on the array shape.
type listMembersResponse struct {
	Members []memberResponse `json:"members"`
}

// --- handlers --------------------------------------------------------------

// getMyMembership implements GET /me/company. It returns the caller's
// (company_id, role) and the company record. The route is ungated by
// role (any sub with a membership row gets a 200; sub with no row gets
// 404; unknown sub gets 401).
func (h *MemberHandler) getMyMembership(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireSub(w, r)
	if !ok {
		return
	}

	member, company, err := h.service.GetMyMembership(r.Context(), sub)
	if err != nil {
		status, msg := classifyMemberError(err)
		if status == http.StatusInternalServerError {
			slog.Error("get my membership failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toMyMembershipResponse(member, company))
}

// listMembers implements GET /me/company/members. The production
// wiring layers RequireCompanyRole(recruiter) on this route, so
// non-members never reach the handler. The handler reads the
// caller's company_id from the CompanyContext that the middleware
// injected (design D6 — "resolves once") and passes it to the
// service; the JWT sub is NEVER consulted here (the middleware has
// already done the resolver chain).
func (h *MemberHandler) listMembers(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	members, err := h.service.ListMembers(r.Context(), cc.CompanyID)
	if err != nil {
		status, msg := classifyMemberError(err)
		if status == http.StatusInternalServerError {
			slog.Error("list members failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toListMembersResponse(members))
}

// addMember implements POST /me/company/members. The body company_id is
// IGNORED (spec scenario "body company_id is ignored"): the service
// uses the callerCompanyID passed in (sourced from the CompanyContext
// the middleware injected — design D6 "resolves once") to attach the
// new member row.
func (h *MemberHandler) addMember(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	var req addMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid user_id")
		return
	}

	created, err := h.service.AddMember(r.Context(), cc.CompanyID, dtos.AddMemberDto{
		UserID: userID,
		Role:   req.Role,
	})
	if err != nil {
		status, msg := classifyMemberError(err)
		if status == http.StatusInternalServerError {
			slog.Error("add member failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	httpjson.WriteJSON(w, http.StatusCreated, toMemberResponse(created))
}

// updateMemberRole implements PATCH /me/company/members/{id}. The
// target id comes from the URL path; the company_id comes from the
// CompanyContext that the middleware injected (design D6 — "resolves
// once"). A foreign target (cross-company) surfaces as
// ErrMemberNotFound → 404 (the repository's same-company SQL guard,
// design D7).
func (h *MemberHandler) updateMemberRole(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	memberID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid member id")
		return
	}

	var req updateMemberRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if err := h.service.UpdateRole(r.Context(), cc.CompanyID, memberID, dtos.UpdateMemberRoleDto{
		Role: req.Role,
	}); err != nil {
		status, msg := classifyMemberError(err)
		if status == http.StatusInternalServerError {
			slog.Error("update member role failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// removeMember implements DELETE /me/company/members/{id}. The same
// IDOR-resistant boundary as updateMemberRole: the target id is from
// the path; the company_id is from the CompanyContext that the
// middleware injected (design D6 — "resolves once"). A foreign target
// surfaces as ErrMemberNotFound → 404.
func (h *MemberHandler) removeMember(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	memberID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid member id")
		return
	}

	if err := h.service.RemoveMember(r.Context(), cc.CompanyID, memberID); err != nil {
		status, msg := classifyMemberError(err)
		if status == http.StatusInternalServerError {
			slog.Error("remove member failed", "error", err)
		}
		httpjson.WriteError(w, status, msg)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --- mappers / helpers ------------------------------------------------------

// toMyMembershipResponse maps (member, company) into the wire shape for
// GET /me/company.
func toMyMembershipResponse(m *entities.CompanyMember, c *entities.Company) myMembershipResponse {
	return myMembershipResponse{
		CompanyID: m.CompanyID.String(),
		Role:      m.Role.String(),
		Company:   toCompanySummaryResponse(c),
	}
}

// toCompanySummaryResponse maps the domain company entity into the
// minimal wire shape embedded in myMembershipResponse. It mirrors the
// toCompanyResponse in the same package but intentionally does NOT
// re-export it — the two helpers are for different surfaces and may
// diverge (e.g. one day the public profile gets a logo, the embedded
// form does not).
func toCompanySummaryResponse(c *entities.Company) companySummaryResponse {
	return companySummaryResponse{
		ID:         c.ID.String(),
		Name:       c.Name.Value(),
		Rfc:        c.Rfc.Value(),
		IndustryID: c.IndustryID,
		Status:     c.Status.String(),
	}
}

// toMemberResponse maps the domain member entity into the wire shape
// for memberResponse.
func toMemberResponse(m *entities.CompanyMember) memberResponse {
	return memberResponse{
		ID:        m.ID.String(),
		UserID:    m.UserID.String(),
		CompanyID: m.CompanyID.String(),
		Role:      m.Role.String(),
		CreatedAt: m.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: m.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}

// toListMembersResponse maps a slice of member entities into the wire
// shape for GET /me/company/members.
func toListMembersResponse(in []entities.CompanyMember) listMembersResponse {
	out := listMembersResponse{Members: make([]memberResponse, 0, len(in))}
	for _, m := range in {
		out.Members = append(out.Members, toMemberResponse(&m))
	}
	return out
}

// requireSub extracts the JWT subject from the request context. The
// production wiring places claims via identityhttp.RequireAuth; tests
// inject them directly with identitysecurity.ContextWithClaims. If the
// auth middleware was bypassed (or ran with an empty sub), we return
// 401 here so the handler never reaches the use case with a blank
// subject.
func requireSub(w http.ResponseWriter, r *http.Request) (string, bool) {
	claims := identitysecurity.ClaimsFromContext(r.Context())
	if claims.Subject == "" {
		httpjson.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return "", false
	}
	return claims.Subject, true
}

// requireCompanyContext reads the CompanyContext that RequireCompanyRole
// injected after resolving `sub → users.id → company_members` (design
// D6 — "resolves once"). It is the entry guard for every GATED use case
// in this file: the four use cases that take `companyID uuid.UUID` in
// the service layer.
//
// If CompanyContext is missing from the request context, the handler
// has been reached without going through the middleware — a routing
// misconfiguration. We short-circuit fail-closed with 500 (NOT 401):
// a 401 would mislead the client into re-authenticating; the real
// failure is internal and should be loud.
func requireCompanyContext(w http.ResponseWriter, r *http.Request) (identitysecurity.CompanyContext, bool) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok {
		httpjson.WriteError(w, http.StatusInternalServerError, "internal server error")
		return identitysecurity.CompanyContext{}, false
	}
	return cc, true
}

// classifyMemberError is the flat errors.Is dispatcher for every domain
// sentinel the membership use cases can surface. Adding a new sentinel
// means adding one branch here — no other call site needs to change.
//
// Status mapping (design error table):
//
//	ErrUnknownSubject      → 401 unauthorized
//	ErrNotAMember          → 404 company member not found
//	ErrMemberExists        → 409 user already has a company membership
//	ErrMemberNotFound      → 404 company member not found
//	ErrUserNotFound        → 404 user not found
//	ErrInvalidMemberRole   → 400 invalid member role
//
// Anything else falls through to 500 with a generic message; the real
// error is logged separately. The list endpoint overrides the
// ErrNotAMember → 404 default to 403 (spec scenario "non-member is
// rejected"); the rest of the dispatcher is identical.
//
// Note: this function does NOT check ErrUserNotFound against the
// specific FK that tripped (user_id vs company_id). Both collapse to
// 404 because the HTTP wire cannot meaningfully distinguish them —
// adding a ConstraintName-aware branch here would surface a richer
// 4xx but break the design's "404 for any FK miss" decision.
func classifyMemberError(err error) (int, string) {
	switch {
	case errors.Is(err, entities.ErrUnknownSubject):
		return http.StatusUnauthorized, "unauthorized"
	case errors.Is(err, entities.ErrNotAMember):
		return http.StatusNotFound, "company member not found"
	case errors.Is(err, entities.ErrMemberExists):
		return http.StatusConflict, "user already has a company membership"
	case errors.Is(err, entities.ErrMemberNotFound):
		return http.StatusNotFound, "company member not found"
	case errors.Is(err, entities.ErrUserNotFound):
		return http.StatusNotFound, "user not found"
	case errors.Is(err, valueobjects.ErrInvalidMemberRole):
		return http.StatusBadRequest, "invalid member role"
	default:
		return http.StatusInternalServerError, "internal server error"
	}
}
