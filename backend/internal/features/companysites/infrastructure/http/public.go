package http

import (
	"errors"
	"net/http"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) WithPublic(reader app.PublicReader, company app.ReadPublicCompany) *Handler {
	h.publicReader, h.publicCompany = reader, company
	return h
}

func (h *Handler) Public(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	slug := chi.URLParam(r, "slug")
	// Invalid-format slugs can never be stored, so this shortcut reveals no existing sites.
	if app.SlugReason(slug) != "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeSiteNotFound))
		return
	}
	if h.publicReader == nil || h.publicCompany == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	out, err := h.publicReader.Public(r.Context(), slug)
	if err == nil {
		out.Company, err = h.publicCompany(r.Context(), out.CompanyID)
	}
	if err != nil {
		code := httpjson.CodeInternalError
		if errors.Is(err, app.ErrSiteNotFound) {
			code = httpjson.CodeSiteNotFound
		}
		httpjson.WriteCatalogError(w, httpjson.Resolve(code))
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=60")
	httpjson.WriteJSON(w, http.StatusOK, out)
}
