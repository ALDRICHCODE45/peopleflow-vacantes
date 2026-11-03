package board

import (
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"net/http"
)

func (h *Handler) PlacementCredits(w http.ResponseWriter, r *http.Request) {
	cc, id, pid, ok := h.params(w, r, true)
	if !ok {
		return
	}
	store, ok := h.store.(app.CreditReader)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	out, err := store.PlacementCredits(r.Context(), cc.CompanyID, cc.UserID, id, pid)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, 200, out)
}
