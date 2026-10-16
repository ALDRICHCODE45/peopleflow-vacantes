package http

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// PublicJobsHandler is anonymous and additive; it never uses private NoStore
// middleware or draft error/ETag transport helpers.
type PublicJobsHandler struct{ catalog *publicjobs.Catalog }

func NewPublicJobsHandler(catalog *publicjobs.Catalog) *PublicJobsHandler {
	return &PublicJobsHandler{catalog: catalog}
}
func (h *PublicJobsHandler) List(w http.ResponseWriter, r *http.Request) {
	q, err := publicjobs.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writePublicJobsError(w, err)
		return
	}
	page, err := h.catalog.List(r.Context(), q)
	if err != nil {
		writePublicJobsError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, page)
}
func (h *PublicJobsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writePublicJobsError(w, publicjobs.ErrNotFound)
		return
	}
	detail, err := h.catalog.Get(r.Context(), id)
	if err != nil {
		writePublicJobsError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, detail)
}
func writePublicJobsError(w http.ResponseWriter, err error) {
	code := httpjson.CodeInternalError
	switch {
	case errors.Is(err, publicjobs.ErrInvalidRequest):
		code = httpjson.CodeInvalidRequest
	case errors.Is(err, publicjobs.ErrNotFound):
		code = httpjson.CodeNotFound
	default:
		slog.Error("public jobs handler failed", "code_class", httpjson.CodeInternalError)
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
