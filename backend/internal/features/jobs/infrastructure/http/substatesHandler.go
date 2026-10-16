package http

import (
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
)

// SubstatesHandler shares draft transport helpers and the cut-1 error catalog.
type SubstatesHandler struct {
	store substatecatalog.Store
}

func NewSubstatesHandler(store substatecatalog.Store) *SubstatesHandler {
	return &SubstatesHandler{store: store}
}

type SubstatesHandlers struct {
	GetSubstates http.HandlerFunc
	PutSubstates http.HandlerFunc
}

func (h *SubstatesHandler) SubstatesHandlers() SubstatesHandlers {
	return SubstatesHandlers{GetSubstates: h.getSubstates, PutSubstates: h.putSubstates}
}

func (h *SubstatesHandler) getSubstates(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetSubstates(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}

func (h *SubstatesHandler) putSubstates(w http.ResponseWriter, r *http.Request) {
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
	result, err := h.store.PutSubstates(r.Context(), cc.CompanyID, cc.UserID, id, tag, present, body)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
