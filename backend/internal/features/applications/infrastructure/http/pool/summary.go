package pool

import (
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return
	}
	out, err := h.service.Summary(r.Context(), cc.CompanyID)
	if err != nil {
		detailError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}
