package http

import (
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

// PipelineHandler is thin transport over the pipeline store. Identity, error
// vocabulary, body budget and If-Match forwarding are shared with draft routes.
type PipelineHandler struct {
	store pipelineconfig.Store
}

func NewPipelineHandler(store pipelineconfig.Store) *PipelineHandler {
	return &PipelineHandler{store: store}
}

type PipelineHandlers struct {
	GetPipeline http.HandlerFunc
	PutPipeline http.HandlerFunc
}

func (h *PipelineHandler) PipelineHandlers() PipelineHandlers {
	return PipelineHandlers{GetPipeline: h.getPipeline, PutPipeline: h.putPipeline}
}

func (h *PipelineHandler) getPipeline(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetPipeline(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}

func (h *PipelineHandler) putPipeline(w http.ResponseWriter, r *http.Request) {
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
	result, err := h.store.PutPipeline(r.Context(), cc.CompanyID, cc.UserID, id, tag, present, body)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
