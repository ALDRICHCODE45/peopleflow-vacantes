package http

import (
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
)

type ManagementHandler struct{ store vacancymanagement.Store }

func NewManagementHandler(store vacancymanagement.Store) *ManagementHandler {
	return &ManagementHandler{store: store}
}

type ManagementHandlers struct{ GetManagement, PutManagement http.HandlerFunc }

func (h *ManagementHandler) ManagementHandlers() ManagementHandlers {
	return ManagementHandlers{GetManagement: h.getManagement, PutManagement: h.putManagement}
}
func (h *ManagementHandler) getManagement(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetManagement(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
func (h *ManagementHandler) putManagement(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	tag, present := ifMatchHeader(r)
	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}
	result, err := h.store.PutManagement(r.Context(), cc.CompanyID, cc.UserID, id, tag, present, body)
	if err != nil {
		writePublicationError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
