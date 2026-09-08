// Package http exposes the industries reference-catalog HTTP handlers.
package http

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
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
			slog.Error("list industries failed", boundedUnexpectedErrorAttrs(r.Context())...)
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

// boundedUnexpectedErrorAttrs builds the bounded auxiliary attributes for an
// unexpected-error branch: the catalog code_class plus request_id read ONLY
// from the existing chi request-ID context and omitted when no RequestID
// middleware set one. No method, path, or raw error content — the request
// middleware owns bounded request correlation, and the raw error must never
// be logged at any level.
func boundedUnexpectedErrorAttrs(ctx context.Context) []any {
	attrs := []any{"code_class", httpjson.CodeInternalError}
	if reqID := chimw.GetReqID(ctx); reqID != "" {
		attrs = append(attrs, "request_id", reqID)
	}
	return attrs
}

// RegisterRoutes is the production-owned industries route registrar: the
// single canonical GET /industries registration. The composition root
// (backend/cmd/api/main.go) and the live integration smoke both call this
// exact function so the served route and the evidence route cannot drift.
func RegisterRoutes(r chi.Router, q industriesReader) {
	r.Get("/industries", ListIndustries(q))
}
