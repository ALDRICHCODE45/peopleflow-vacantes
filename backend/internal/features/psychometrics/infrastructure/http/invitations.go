package http

import (
	"errors"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type InvitationsHandler struct {
	store        invitations.Store
	contextError func(http.ResponseWriter, error)
}

func NewInvitationsHandler(store invitations.Store, contextError func(http.ResponseWriter, error)) *InvitationsHandler {
	return &InvitationsHandler{store, contextError}
}
func (h *InvitationsHandler) List(w http.ResponseWriter, r *http.Request)   { h.serve(w, r, "list") }
func (h *InvitationsHandler) Create(w http.ResponseWriter, r *http.Request) { h.serve(w, r, "create") }
func (h *InvitationsHandler) Remind(w http.ResponseWriter, r *http.Request) { h.serve(w, r, "remind") }
func (h *InvitationsHandler) Revoke(w http.ResponseWriter, r *http.Request) { h.serve(w, r, "revoke") }
func (h *InvitationsHandler) serve(w http.ResponseWriter, r *http.Request, action string) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.store == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	var target uuid.UUID
	if action != "list" {
		param := "iid"
		if action == "create" {
			param = "pid"
		}
		target, err = uuid.Parse(chi.URLParam(r, param))
		if err != nil {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeNotFound))
			return
		}
	}
	var result invitations.Result
	switch action {
	case "list":
		result, err = h.store.ListInvitations(r.Context(), cc.CompanyID, cc.UserID, id)
	case "create":
		result, err = h.store.CreateInvitation(r.Context(), cc.CompanyID, cc.UserID, id, target)
	case "remind":
		result, err = h.store.RemindInvitation(r.Context(), cc.CompanyID, cc.UserID, id, target)
	case "revoke":
		result, err = h.store.RevokeInvitation(r.Context(), cc.CompanyID, cc.UserID, id, target)
	}
	if err != nil {
		for _, pair := range []struct {
			err  error
			code httpjson.Code
		}{{invitations.ErrNotFound, httpjson.CodeNotFound}, {invitations.ErrProfileDisabled, httpjson.CodeProfileDisabled}, {invitations.ErrAlreadyFinished, httpjson.CodeAlreadyFinished}, {invitations.ErrParticipationInactive, httpjson.CodeParticipationInactive}, {invitations.ErrInvitationClosed, httpjson.CodeInvitationClosed}} {
			if errors.Is(err, pair.err) {
				httpjson.WriteCatalogError(w, httpjson.Resolve(pair.code))
				return
			}
		}
		if h.contextError != nil {
			h.contextError(w, err)
		} else {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(result.Status)
	_, _ = w.Write(result.Body)
}
