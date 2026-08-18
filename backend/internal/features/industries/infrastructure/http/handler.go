// Package http exposes the industries reference-catalog HTTP handlers.
package http

import (
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// industryResponse is the clean JSON shape for a catalog industry. It omits
// internal timestamps and the redundant active flag (the query only returns
// active rows).
type industryResponse struct {
	ID        string `json:"id"`
	LabelEs   string `json:"label_es"`
	LabelEn   string `json:"label_en"`
	SortOrder int32  `json:"sort_order"`
}

// ListIndustries returns the active industries catalog for the create-company
// form. Industries is a reference catalog with no domain logic, so this handler
// reads the sqlc data layer directly instead of routing through a use case.
func ListIndustries(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		industries, err := queries.ListActiveIndustries(r.Context())
		if err != nil {
			slog.Error("list industries failed", "error", err)
			httpjson.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}

		resp := make([]industryResponse, 0, len(industries))
		for _, ind := range industries {
			resp = append(resp, industryResponse{
				ID:        ind.ID,
				LabelEs:   ind.LabelEs,
				LabelEn:   ind.LabelEn,
				SortOrder: ind.SortOrder,
			})
		}

		httpjson.WriteJSON(w, http.StatusOK, resp)
	}
}
