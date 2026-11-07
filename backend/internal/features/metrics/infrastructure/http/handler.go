// Package http serves the company metrics read API (stakeholder-metrics-v1 §3).
// The owner-or-stakeholder gate and NoStore run in the router.
package http

import (
	"errors"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct{ service *app.Service }

func NewHandler(service *app.Service) *Handler { return &Handler{service: service} }

func companyContext(w http.ResponseWriter, r *http.Request) (security.CompanyContext, bool) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return cc, false
	}
	return cc, true
}

// pathID reads a canonical UUID path parameter; anything else is 404.
func pathID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	raw := chi.URLParam(r, name)
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeNotFound))
		return uuid.Nil, false
	}
	return id, true
}

// respond writes the body or maps the service error: 422 invalid_filter with
// fields (the audit filters' writer), 400 invalid_cursor, 404 not_found.
func respond(w http.ResponseWriter, body any, err error) {
	var filter *app.InvalidFilter
	switch {
	case err == nil:
		httpjson.WriteJSON(w, http.StatusOK, body)
	case errors.As(err, &filter):
		fields := make([]httpjson.ValidationField, len(filter.Fields))
		for i, f := range filter.Fields {
			fields[i] = httpjson.ValidationField{Field: f.Field, Code: f.Code}
		}
		httpjson.WriteAuditInvalidFilter(w, fields)
	case errors.Is(err, app.ErrInvalidCursor):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
	case errors.Is(err, app.ErrNotFound):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeNotFound))
	default:
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
	}
}
