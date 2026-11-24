package http

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// StakeholderInvitationHandler serves the stakeholder invitation routes
// (stakeholder-metrics-v1 §1.3). Create, List and Revoke run behind the owner
// gate; Accept behind authentication only (any signed-in user).
type StakeholderInvitationHandler struct {
	service *usecases.StakeholderInvitationService
}

func NewStakeholderInvitationHandler(service *usecases.StakeholderInvitationService) *StakeholderInvitationHandler {
	return &StakeholderInvitationHandler{service: service}
}

// Note is always present: the normalized label or null (audit gap D11).
type invitationCreatedResponse struct {
	ID        string  `json:"id"`
	URLToken  string  `json:"url_token"`
	ExpiresAt string  `json:"expires_at"`
	CreatedAt string  `json:"created_at"`
	Note      *string `json:"note"`
}

type invitationItemResponse struct {
	ID        string  `json:"id"`
	CreatedAt string  `json:"created_at"`
	CreatedBy string  `json:"created_by"`
	ExpiresAt string  `json:"expires_at"`
	Note      *string `json:"note"`
}

type invitationListResponse struct {
	Items []invitationItemResponse `json:"items"`
}

type acceptResponse struct {
	CompanyID string `json:"company_id"`
	MemberID  string `json:"member_id"`
	Role      string `json:"role"`
}

func invitationTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func (h *StakeholderInvitationHandler) writeError(w http.ResponseWriter, r *http.Request, err error, msg string) {
	def := classifyMemberError(err)
	if def.Code == httpjson.CodeInternalError {
		logCompanyInternalError(r, msg)
	}
	httpjson.WriteCatalogError(w, def)
}

// Create is POST /v2/me/company/stakeholder-invitations → 201; the url token
// is in this response only. The body is optional: no body, `{}` and
// `{"note":null}` create an invitation without a note.
func (h *StakeholderInvitationHandler) Create(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	note, def, invalidNote := decodeInvitationNote(w, r)
	if def != nil {
		httpjson.WriteCatalogError(w, *def)
		return
	}
	if invalidNote {
		writeInvalidNote(w)
		return
	}
	issued, err := h.service.Create(r.Context(), cc.CompanyID, cc.UserID, note)
	if errors.Is(err, valueobjects.ErrInvalidInvitationNote) {
		writeInvalidNote(w)
		return
	}
	if err != nil {
		h.writeError(w, r, err, "create stakeholder invitation failed")
		return
	}
	httpjson.WriteJSON(w, http.StatusCreated, invitationCreatedResponse{ID: issued.ID.String(), URLToken: issued.URLToken, ExpiresAt: invitationTime(issued.ExpiresAt), CreatedAt: invitationTime(issued.CreatedAt), Note: issued.Note})
}

func writeInvalidNote(w http.ResponseWriter) {
	httpjson.WriteValidationError(w, []httpjson.ValidationField{{Field: "note", Code: "invalid"}})
}

// decodeInvitationNote reads the optional create body under the same
// maxJSONBodyBytes cap (payload_too_large past it). An empty body is no note;
// otherwise it must be exactly one JSON object (invalid_request), with
// httpjson.DecodeJSON's single-value rule applied to the buffered bytes. A
// present non-string, non-null `note` is reported through invalidNote;
// unknown keys are ignored.
func decodeInvitationNote(w http.ResponseWriter, r *http.Request) (*string, *httpjson.Definition, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		code := httpjson.CodeInvalidRequest
		if errors.As(err, &tooLarge) {
			code = httpjson.CodePayloadTooLarge
		}
		def := httpjson.Resolve(code)
		return nil, &def, false
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil, false
	}
	var req struct {
		Note json.RawMessage `json:"note"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	var extra any
	if dec.Decode(&req) != nil || dec.Decode(&extra) != io.EOF {
		def := httpjson.Resolve(httpjson.CodeInvalidRequest)
		return nil, &def, false
	}
	if len(req.Note) == 0 || string(req.Note) == "null" {
		return nil, nil, false
	}
	var note string
	if err := json.Unmarshal(req.Note, &note); err != nil {
		return nil, nil, true
	}
	return &note, nil, false
}

// List is GET /v2/me/company/stakeholder-invitations: pending only, no token.
func (h *StakeholderInvitationHandler) List(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	items, err := h.service.ListPending(r.Context(), cc.CompanyID)
	if err != nil {
		h.writeError(w, r, err, "list stakeholder invitations failed")
		return
	}
	out := invitationListResponse{Items: make([]invitationItemResponse, 0, len(items))}
	for _, inv := range items {
		out.Items = append(out.Items, invitationItemResponse{ID: inv.ID.String(), CreatedAt: invitationTime(inv.CreatedAt), CreatedBy: inv.CreatedBy.String(), ExpiresAt: invitationTime(inv.ExpiresAt), Note: inv.Note})
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}

// Revoke is DELETE /v2/me/company/stakeholder-invitations/{id} → 204, also
// for an already used, expired, revoked or unknown invitation.
func (h *StakeholderInvitationHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid invitation id"))
		return
	}
	if err := h.service.Revoke(r.Context(), cc.CompanyID, cc.UserID, id); err != nil {
		h.writeError(w, r, err, "revoke stakeholder invitation failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Accept is POST /v2/me/stakeholder-invitations/accept with {"token"}.
func (h *StakeholderInvitationHandler) Accept(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireSub(w, r)
	if !ok {
		return
	}
	var req struct {
		Token json.RawMessage `json:"token"`
	}
	if def := httpjson.DecodeJSON(w, r, &req, maxJSONBodyBytes); def != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	var token string
	if err := json.Unmarshal(req.Token, &token); err != nil || token == "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	accepted, err := h.service.Accept(r.Context(), sub, token)
	if err != nil {
		h.writeError(w, r, err, "accept stakeholder invitation failed")
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, acceptResponse{CompanyID: accepted.CompanyID.String(), MemberID: accepted.MemberID.String(), Role: "stakeholder"})
}
