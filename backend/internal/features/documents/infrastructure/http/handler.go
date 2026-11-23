// Package http serves the placement and vacancy documents routes
// (docs/contracts/placement-vacancy-documents-v1.md, «Endpoints»). P3 serves GET P/documents; P4 adds the upload
// (POST P/documents) and the current-version download (GET P/documents/{doc}/file); P5 adds replace
// (POST P/documents/{doc}/versions), the version list, the download by version and delete (versions.go); P6 serves the same
// handlers under P = V/participations/{pid} (the route table decides the scope: a `pid` URL parameter makes it a
// participation scope); P7 adds the replacement links: the sources list, create, unlink and the download through a link (links.go).
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

// Handler serves the documents routes over the documents store (reads) and the documents service (files).
type Handler struct {
	reader documents.Reader
	files  documents.Files
}

// NewHandler builds the handler. A nil reader or service is allowed: the routes that need it then answer the generic
// 500 instead of dereferencing it (a router assembled without the documents store fails closed).
func NewHandler(reader documents.Reader, files documents.Files) *Handler {
	return &Handler{reader: reader, files: files}
}

// target reads the scope of the request from the route: `{id}` and, on the participation routes, `{pid}`. A malformed id is
// answered 400 invalid_request like every draft route; a well-formed `pid` that is not a participation of the draft is the
// store's 404 (the only participation rule, D3).
func target(w http.ResponseWriter, r *http.Request) (documents.Target, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid draft id"))
		return documents.Target{}, false
	}
	raw := chi.URLParam(r, "pid")
	if raw == "" {
		return documents.VacancyTarget(id), true
	}
	pid, err := uuid.Parse(raw)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid participation id"))
		return documents.Target{}, false
	}
	return documents.ParticipationTarget(id, pid), true
}

// List is GET P/documents, P = /v2/me/company/job-drafts/{id} or …/{id}/participations/{pid} (read gate: owner, recruiter,
// stakeholder; the store re-checks). It reads only the database, so it never raises document_storage_unavailable (contract
// «GET P/documents»).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.reader == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, ok := target(w, r)
	if !ok {
		return
	}
	list, err := h.reader.List(r.Context(), cc.CompanyID, cc.UserID, t)
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

// writeError projects the store's and the service's failures onto the catalog; anything else is the generic 500 and
// never echoes a driver or domain message.
func writeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	var mismatch *documents.MismatchError
	var limit *documents.LimitReachedError
	var conflict *documents.VersionConflictError
	var already *documents.AlreadyLinkedError
	var invalid *documents.LinkInvalidError
	switch {
	case errors.As(err, &already):
		httpjson.WriteDocumentAlreadyLinked(w, already.LinkID.String())
		return
	case errors.As(err, &invalid):
		httpjson.WriteDocumentLinkInvalid(w, invalid.Reason)
		return
	case errors.As(err, &conflict):
		httpjson.WriteDocumentVersionConflict(w, conflict.Current)
		return
	case errors.As(err, &mismatch):
		httpjson.WriteDocumentContentMismatch(w, string(mismatch.Detected), mismatch.Extension)
		return
	case errors.As(err, &limit):
		httpjson.WriteDocumentLimitReached(w, limit.Kind, limit.Limit)
		return
	case errors.Is(err, documents.ErrTooLarge), errors.As(err, &tooLarge):
		httpjson.WriteDocumentPayloadTooLarge(w, documents.MaxBytes)
		return
	case errors.Is(err, documents.ErrUnsupportedType):
		httpjson.WriteDocumentUnsupportedType(w, documentFormats())
		return
	case errors.Is(err, documents.ErrEmpty):
		httpjson.WriteValidationError(w, []httpjson.ValidationField{{Field: "file", Code: "empty"}})
		return
	case errors.Is(err, documents.ErrInvalidName):
		httpjson.WriteValidationError(w, []httpjson.ValidationField{{Field: "name", Code: "invalid"}})
		return
	case errors.Is(err, documents.ErrExpectedVersionRequired):
		httpjson.WriteValidationError(w, []httpjson.ValidationField{{Field: "expected_version", Code: "required"}})
		return
	case errors.Is(err, documents.ErrExpectedVersionInvalid):
		httpjson.WriteValidationError(w, []httpjson.ValidationField{{Field: "expected_version", Code: "invalid"}})
		return
	}
	code := httpjson.CodeInternalError
	switch {
	case errors.Is(err, documents.ErrInvalidRequest):
		code = httpjson.CodeInvalidRequest
	case errors.Is(err, documents.ErrScopeNotFound), errors.Is(err, documents.ErrNotFound):
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
	case errors.Is(err, documents.ErrIdempotencyConflict):
		code = httpjson.CodeIdempotencyConflict
	case errors.Is(err, documents.ErrStorageUnavailable):
		code = httpjson.CodeDocumentStorageUnavailable
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}

// documentFormats is the `data.formats` of unsupported_media_type: the same descriptors as `limits.formats`.
func documentFormats() []httpjson.DocumentFormat {
	out := []httpjson.DocumentFormat{}
	for _, d := range documents.Formats() {
		out = append(out, httpjson.DocumentFormat{Format: string(d.Format), Extensions: d.Extensions, ContentType: d.ContentType})
	}
	return out
}
