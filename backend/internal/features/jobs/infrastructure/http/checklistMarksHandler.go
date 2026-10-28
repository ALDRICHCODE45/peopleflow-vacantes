package http

import (
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ChecklistMarksHandler struct{ store checklist.MarksStore }

func NewChecklistMarksHandler(store checklist.MarksStore) *ChecklistMarksHandler {
	return &ChecklistMarksHandler{store: store}
}

func (h *ChecklistMarksHandler) Get(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	items, err := h.store.GetChecklistMarks(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeChecklistError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, struct {
		Items []checklist.Mark `json:"items"`
	}{items})
}
func checklistMarkIDs(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	pid, errPID := uuid.Parse(chi.URLParam(r, "pid"))
	cid, errCID := uuid.Parse(chi.URLParam(r, "criterion_id"))
	if errPID != nil || errCID != nil || pid == uuid.Nil || cid == uuid.Nil {
		writeDraftError(w, drafts.ErrNotFound)
		return uuid.Nil, uuid.Nil, false
	}
	return pid, cid, true
}
func (h *ChecklistMarksHandler) Put(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	pid, cid, ok := checklistMarkIDs(w, r)
	if !ok {
		return
	}
	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}
	mark, err := h.store.PutChecklistMark(r.Context(), cc.CompanyID, cc.UserID, id, pid, cid, body)
	if err != nil {
		writeChecklistError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, mark)
}
func (h *ChecklistMarksHandler) Delete(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	pid, cid, ok := checklistMarkIDs(w, r)
	if !ok {
		return
	}
	if err := h.store.DeleteChecklistMark(r.Context(), cc.CompanyID, cc.UserID, id, pid, cid); err != nil {
		writeChecklistError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
