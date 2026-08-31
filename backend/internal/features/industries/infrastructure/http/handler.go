// Package http exposes the industries reference-catalog HTTP handlers.
package http

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// industriesReader is the minimal interface ListIndustries needs.
// *db.Queries satisfies this interface directly: its ListActiveIndustries
// method returns ([]db.Industry, error), which matches exactly.
type industriesReader interface {
	ListActiveIndustries(ctx context.Context) ([]db.Industry, error)
}

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
func ListIndustries(q industriesReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := q.ListActiveIndustries(r.Context())
		if err != nil {
			slog.Error("list industries failed", "error", err)
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
			return
		}

		resp := make([]industryResponse, 0, len(rows))
		for _, row := range rows {
			resp = append(resp, industryResponse{
				ID:        row.ID,
				LabelEs:   row.LabelEs,
				LabelEn:   row.LabelEn,
				SortOrder: row.SortOrder,
			})
		}

		httpjson.WriteJSON(w, http.StatusOK, resp)
	}
}
