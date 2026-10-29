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

func (h *InvitationsHandler) Result(w http.ResponseWriter, r *http.Request) {
	h.serveResult(w, r, false)
}
func (h *InvitationsHandler) Compare(w http.ResponseWriter, r *http.Request) {
	h.serveResult(w, r, true)
}
func (h *InvitationsHandler) serveResult(w http.ResponseWriter, r *http.Request, write bool) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || h == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	store, ok := h.store.(invitations.ResultsStore)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "iid"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeNotFound))
		return
	}
	var result invitations.Result
	if write {
		result, err = store.CreateComparison(r.Context(), cc.CompanyID, cc.UserID, id, iid)
	} else {
		result, err = store.GetResult(r.Context(), cc.CompanyID, cc.UserID, id, iid)
	}
	if err != nil {
		switch {
		case errors.Is(err, invitations.ErrNotFound):
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeNotFound))
		case errors.Is(err, invitations.ErrProfileUnconfirmed):
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeProfileUnconfirmed))
		default:
			if h.contextError != nil {
				h.contextError(w, err)
			} else {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
			}
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(result.Status)
	_, _ = w.Write(result.Body)
}
