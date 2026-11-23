// Package http serves the placement and vacancy documents routes
// (docs/contracts/placement-vacancy-documents-v1.md, «Endpoints»). P3 serves GET V/documents; the write and download
// routes arrive in later slices.
package http

import (
	"errors"
	"net/http"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Handler serves the documents routes over the documents store.
type Handler struct{ reader documents.Reader }

// NewHandler builds the handler. A nil reader is allowed: every route then answers the generic 500 instead of
// dereferencing it (a router assembled without the documents store fails closed).
func NewHandler(reader documents.Reader) *Handler { return &Handler{reader: reader} }

// List is GET /v2/me/company/job-drafts/{id}/documents (read gate: owner, recruiter, stakeholder; the store re-checks).
// It reads only the database, so it never raises document_storage_unavailable (contract «GET P/documents»).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.reader == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid draft id"))
		return
	}
	list, err := h.reader.List(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeError(w, err)
		return
	}
	// Both arrays are always present, never null.
	if list.Items == nil {
		list.Items = []documents.Item{}
	}
	if list.Links == nil {
		list.Links = []documents.Link{}
	}
	httpjson.WriteJSON(w, http.StatusOK, list)
}

// writeError projects the store's access sentinels onto the catalog; anything else is the generic 500 and never
// echoes a driver or domain message.
func writeError(w http.ResponseWriter, err error) {
	code := httpjson.CodeInternalError
	switch {
	case errors.Is(err, documents.ErrScopeNotFound):
		code = httpjson.CodeNotFound
	case errors.Is(err, documents.ErrTeamAccessEnded):
		code = httpjson.CodeTeamAccessEnded
	case errors.Is(err, documents.ErrForbidden):
		code = httpjson.CodeForbidden
	case errors.Is(err, documents.ErrUnauthenticated):
		code = httpjson.CodeUnauthenticated
	case errors.Is(err, documents.ErrCompanyInactive):
		code = httpjson.CodeCompanyInactive
	case errors.Is(err, documents.ErrCompanyNotActive):
		code = httpjson.CodeCompanyNotActive
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
