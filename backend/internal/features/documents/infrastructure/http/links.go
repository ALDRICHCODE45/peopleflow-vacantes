package http

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// maxLinkBodyBytes bounds the JSON of POST P/document-links: two short keys; anything bigger is not a link request.
const maxLinkBodyBytes = 4096

// Sources is GET P/document-sources (read gate; the store re-checks): the documents of the earlier processes of the chain or of
// the ancestors of the carried participation that the caller can read, grouped by origin (D17, D18, D22). A scope that cannot
// receive links answers 200 with `sources: []` and `can_link: false`. It reads only the database.
func (h *Handler) Sources(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.reader == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, ok := target(w, r)
	if !ok {
		return
	}
	sources, err := h.reader.Sources(r.Context(), cc.CompanyID, cc.UserID, t)
	if err != nil {
		writeError(w, err)
		return
	}
	if sources.Sources == nil {
		sources.Sources = []documents.SourceGroup{}
	}
	for i := range sources.Sources {
		if sources.Sources[i].Documents == nil {
			sources.Sources[i].Documents = []documents.SourceDocument{}
		}
	}
	httpjson.WriteJSON(w, http.StatusOK, sources)
}

// linkRequest is the body of POST P/document-links. Version stays raw so that an explicit `null` or a non-integer is told apart
// from an absent key.
type linkRequest struct {
	SourceDocumentID *string         `json:"source_document_id"`
	Version          json.RawMessage `json:"version"`
}

// parseLinkRequest reads the body strictly: one JSON object, no unknown key, nothing after it, `source_document_id` a non-nil
// uuid and `version`, when present, a positive decimal integer (the same syntax as `expected_version`). Every failure is the
// same invalid_request; nothing is looked up before the body is valid.
func parseLinkRequest(w http.ResponseWriter, r *http.Request) (source uuid.UUID, version *int, ok bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxLinkBodyBytes))
	if err != nil {
		writeError(w, documents.ErrInvalidRequest)
		return uuid.Nil, nil, false
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var req linkRequest
	if err := dec.Decode(&req); err != nil {
		writeError(w, documents.ErrInvalidRequest)
		return uuid.Nil, nil, false
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) { // trailing garbage after the object
		writeError(w, documents.ErrInvalidRequest)
		return uuid.Nil, nil, false
	}
	if req.SourceDocumentID == nil {
		writeError(w, documents.ErrInvalidRequest)
		return uuid.Nil, nil, false
	}
	source, err = uuid.Parse(*req.SourceDocumentID)
	if err != nil || source == uuid.Nil {
		writeError(w, documents.ErrInvalidRequest)
		return uuid.Nil, nil, false
	}
	if req.Version != nil {
		n, valid := parseVersion(string(req.Version))
		if !valid {
			writeError(w, documents.ErrInvalidRequest)
			return uuid.Nil, nil, false
		}
		version = &n
	}
	return source, version, true
}

// Link is POST P/document-links (manage gate: owner or recruiter; the store re-checks): links a document of an earlier process
// of the chain, pinned to a version (D16). 201 {link, scope}. No Idempotency-Key: a repeated request is document_already_linked.
// It moves no file, so it needs no storage.
func (h *Handler) Link(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.files == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, ok := target(w, r)
	if !ok {
		return
	}
	source, version, ok := parseLinkRequest(w, r)
	if !ok {
		return
	}
	res, err := h.files.Link(r.Context(), documents.LinkCommand{CompanyID: cc.CompanyID, ActorID: cc.UserID, Target: t, SourceDocumentID: source, Version: version})
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusCreated, res)
}

// targetAndLink parses the scope ({id}, {pid}) and {link}; a malformed one is 400 invalid_request like every draft route.
func targetAndLink(w http.ResponseWriter, r *http.Request) (t documents.Target, link uuid.UUID, ok bool) {
	t, ok = target(w, r)
	if !ok {
		return documents.Target{}, uuid.Nil, false
	}
	link, err := uuid.Parse(chi.URLParam(r, "link"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid link id"))
		return documents.Target{}, uuid.Nil, false
	}
	return t, link, true
}

// Unlink is DELETE P/document-links/{link} (manage gate): removes the link, audited as DocumentDeleted with kind link; the source
// and its files are untouched. 200 {scope}; a link that is not in this scope is 404.
func (h *Handler) Unlink(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.files == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, link, ok := targetAndLink(w, r)
	if !ok {
		return
	}
	res, err := h.files.Unlink(r.Context(), cc.CompanyID, cc.UserID, t, link)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, res)
}

// FileLink is GET P/document-links/{link}/file (read gate): the PINNED version of the source as an attachment, audited before
// the first byte like any download. A removed or inaccessible link, a link of another scope and a source the caller cannot read
// are all 404 not_found (D18, D19).
func (h *Handler) FileLink(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.files == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, link, ok := targetAndLink(w, r)
	if !ok {
		return
	}
	file, err := h.files.DownloadLink(r.Context(), cc.CompanyID, cc.UserID, t, link)
	if err != nil {
		writeError(w, err)
		return
	}
	defer file.Reader.Close()
	writeAttachment(w, file)
}
