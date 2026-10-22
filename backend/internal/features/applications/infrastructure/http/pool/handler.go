// Package pool exposes only the private organization candidate list.
package pool

import (
	"errors"
	"log/slog"
	"net/http"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

type Handler struct{ service *app.Service }

func NewHandler(service *app.Service) *Handler { return &Handler{service: service} }
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return
	}
	page, err := h.service.List(r.Context(), cc.CompanyID, r.URL.RawQuery)
	if err != nil {
		var filter *app.InvalidFilter
		switch {
		case errors.As(err, &filter):
			fields := make([]httpjson.ValidationField, len(filter.Fields))
			for i, field := range filter.Fields {
				fields[i] = httpjson.ValidationField{Field: field.Field, Code: field.Code}
			}
			httpjson.WriteInvalidFilterFields(w, fields)
		case errors.Is(err, app.ErrInvalidCursor):
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
		default:
			slog.Error("organization candidate list failed", "code_class", httpjson.CodeInternalError)
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		}
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, page)
}
