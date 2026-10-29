package http

import (
	"errors"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

type ChecklistHandler struct{ store checklist.Store }

func NewChecklistHandler(store checklist.Store) *ChecklistHandler {
	return &ChecklistHandler{store: store}
}

type ChecklistHandlers struct{ GetChecklist, PutChecklist http.HandlerFunc }

func (h *ChecklistHandler) ChecklistHandlers() ChecklistHandlers {
	return ChecklistHandlers{h.getChecklist, h.putChecklist}
}

func (h *ChecklistHandler) getChecklist(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetChecklist(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeChecklistError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
func (h *ChecklistHandler) putChecklist(w http.ResponseWriter, r *http.Request) {
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
	result, err := h.store.PutChecklist(r.Context(), cc.CompanyID, cc.UserID, id, tag, present, body)
	if err != nil {
		writeChecklistError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
func writeChecklistError(w http.ResponseWriter, err error) {
	var invalid *checklist.Invalid
	if errors.As(err, &invalid) {
		httpjson.WriteValidationError(w, invalid.Fields)
		return
	}
	writeDraftError(w, err)
}
