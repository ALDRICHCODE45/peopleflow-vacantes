package http

import (
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
)

// DraftV2Handler is employer-only schema-2 transport. It does not register
// production routes or expose a candidate projection.
type DraftV2Handler struct {
	writer drafts.V2Writer
	reader drafts.V2Reader
	saver  drafts.V2Saver
}

// NewDraftV2Handler selects v2 explicitly through separate capabilities.
// Construction performs no IO; the composition root supplies all capabilities.
func NewDraftV2Handler(writer drafts.V2Writer, reader drafts.V2Reader, saver drafts.V2Saver) *DraftV2Handler {
	return &DraftV2Handler{writer: writer, reader: reader, saver: saver}
}

// DraftHandlers exposes handler functions for NoStore/auth/recruiter
// wiring. Returning these functions does not activate endpoints.
func (h *DraftV2Handler) DraftHandlers() DraftHandlers {
	return DraftHandlers{CreateDraft: h.createDraft, GetDraft: h.getDraft, SaveDraft: h.saveDraft}
}

// createDraft preserves the v1 transport boundary: context, key, bounded raw
// body, then the explicitly selected v2 writer. Store bytes are never rebuilt.
func (h *DraftV2Handler) createDraft(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	key, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}
	result, err := h.writer.CreateV2(r.Context(), cc.CompanyID, cc.UserID, key, body)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	replayed := result.Replayed
	writeDraftResult(w, http.StatusCreated, result, &replayed)
}

// getDraft forwards the scoped identity and lexical path UUID to GetV2.
func (h *DraftV2Handler) getDraft(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.reader.GetV2(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}

// saveDraft forwards raw If-Match presence/value and body, without parsing the
// precondition. Transport read errors precede the store call, as in v1; the
// store owns authorization/schema/precondition precedence after that boundary.
func (h *DraftV2Handler) saveDraft(w http.ResponseWriter, r *http.Request) {
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
	result, err := h.saver.SaveV2(r.Context(), cc.CompanyID, cc.UserID, id, tag, present, body)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
