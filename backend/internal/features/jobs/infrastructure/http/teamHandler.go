package http

import (
	"errors"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"net/http"
)

type TeamHandler struct{ store vacancyteam.Store }

func NewTeamHandler(store vacancyteam.Store) *TeamHandler { return &TeamHandler{store} }
func (h *TeamHandler) Get(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetTeam(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
func (h *TeamHandler) History(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetTeamHistory(r.Context(), cc.CompanyID, cc.UserID, id, r.URL.Query().Get("cursor"))
	if errors.Is(err, vacancyteam.ErrInvalidCursor) {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
		return
	}
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
