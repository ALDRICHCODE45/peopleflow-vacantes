package http

import (
	"errors"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
)

func writeDeliveryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, deliveryconfig.ErrCommitmentChangeRequiresRenegotiation):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeCommitmentChangeRequiresRenegotiation))
	case errors.Is(err, deliveryconfig.ErrCommitmentUnchanged):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeCommitmentUnchanged))
	case errors.Is(err, deliveryconfig.ErrCommitmentNoteRequired):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeCommitmentNoteRequired))
	case errors.Is(err, deliveryconfig.ErrDeliveryNotConfigured):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeDeliveryNotConfigured))
	case errors.Is(err, fulfillment.ErrFulfilled):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeDeliveryFulfilled))
	case errors.Is(err, fulfillment.ErrConfirmationRequired):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeFulfillmentConfirmationRequired))
	case errors.Is(err, fulfillment.ErrNotPublished):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeVacancyNotPublished))
	default:
		writePublicationError(w, err)
	}
}
func (h *DeliveryHandler) status(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	out, err := h.store.GetDeliveryStatus(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDeliveryError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}
func (h *DeliveryHandler) preview(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}
	out, err := h.store.PreviewDelivery(r.Context(), cc.CompanyID, cc.UserID, id, body)
	if err != nil {
		writeDeliveryError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}

// DeliveryHandler shares the draft identity, body, precondition and error helpers.
type DeliveryHandler struct{ store deliveryconfig.Store }

func NewDeliveryHandler(store deliveryconfig.Store) *DeliveryHandler {
	return &DeliveryHandler{store: store}
}

type DeliveryHandlers struct {
	GetDelivery http.HandlerFunc
	PutDelivery http.HandlerFunc
	Status      http.HandlerFunc
	Preview     http.HandlerFunc
	Commitment  http.HandlerFunc
}

func (h *DeliveryHandler) DeliveryHandlers() DeliveryHandlers {
	return DeliveryHandlers{GetDelivery: h.getDelivery, PutDelivery: h.putDelivery, Status: h.status, Preview: h.preview, Commitment: h.commitment}
}
func (h *DeliveryHandler) commitment(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}
	store, ok := h.store.(deliveryconfig.CommitmentStore)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	keys := r.Header.Values("Idempotency-Key")
	tag, present := ifMatchHeader(r)
	result, err := store.RenegotiateCommitment(r.Context(), cc.CompanyID, cc.UserID, id, strings.Join(keys, ","), len(keys) > 0, tag, present, body)
	if err != nil {
		writeDeliveryError(w, err)
		return
	}
	replayed := result.Replayed
	writeDraftResult(w, http.StatusOK, result, &replayed)
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
		writeDeliveryError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
