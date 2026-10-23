package pool

import (
	"encoding/json"
	"net/http"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

const maxContactsBodyBytes = 16_384

// Contacts receives the strict decoder from composition, keeping this feature
// independent of the jobs-owned decoder implementation, as on the board.
func (h *Handler) Contacts(decode board.JSONDecoder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cc, ok := security.CompanyContextFromContext(r.Context())
		if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
			return
		}
		var raw json.RawMessage
		if failure := httpjson.DecodeJSON(w, r, &raw, maxContactsBodyBytes); failure != nil {
			httpjson.WriteCatalogError(w, *failure)
			return
		}
		candidates, err := app.DecodeContacts(raw, decode)
		if err != nil {
			editError(w, err)
			return
		}
		out, err := h.service.Contacts(r.Context(), cc.CompanyID, candidates)
		if err != nil {
			detailError(w, err)
			return
		}
		httpjson.WriteJSON(w, http.StatusOK, out)
	}
}
