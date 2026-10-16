package http

import (
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
)

// DeliveryHandler shares the draft identity, body, precondition and error helpers.
type DeliveryHandler struct{ store deliveryconfig.Store }

func NewDeliveryHandler(store deliveryconfig.Store) *DeliveryHandler {
	return &DeliveryHandler{store: store}
}

type DeliveryHandlers struct {
	GetDelivery http.HandlerFunc
	PutDelivery http.HandlerFunc
}

func (h *DeliveryHandler) DeliveryHandlers() DeliveryHandlers {
	return DeliveryHandlers{GetDelivery: h.getDelivery, PutDelivery: h.putDelivery}
}
func (h *DeliveryHandler) getDelivery(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetDelivery(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
func (h *DeliveryHandler) putDelivery(w http.ResponseWriter, r *http.Request) {
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
	result, err := h.store.PutDelivery(r.Context(), cc.CompanyID, cc.UserID, id, tag, present, body)
	if err != nil {
		writePublicationError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
