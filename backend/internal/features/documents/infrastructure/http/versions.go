package http

import (
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
)

// maxVersionDigits bounds the decimal integers of `expected_version` and `{n}`: far more than the 25 versions a document can
// have, far fewer than an int overflows on.
const maxVersionDigits = 9

// parseVersion reads a positive decimal integer: ASCII digits only (no sign, no space, no decimal point), at most
// maxVersionDigits of them, value ≥ 1.
func parseVersion(raw string) (int, bool) {
	if raw == "" || len(raw) > maxVersionDigits {
		return 0, false
	}
	for _, c := range raw {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 0, false
	}
	return n, true
}

// Replace is POST P/documents/{doc}/versions (manage gate: owner or recruiter; the store re-checks):
// a new version of an existing document (D7).
//
// Parts: `file` (required, once), `expected_version` (required, once) and `name` (optional, once). Order: pre-flight
// (authorization, the document, storage) → the multipart body is streamed. An `expected_version` that arrives before the file
// is checked against the current version at once, so a stale replace is answered before one byte of the file is read; one that
// arrives after is checked by the store under the draft lock, which is the authority either way. Whatever was staged is
// discarded on every failure path (the service already discards when the write itself fails).
func (h *Handler) Replace(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.files == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, doc, ok := targetAndDocument(w, r)
	if !ok {
		return
	}
	current, err := h.files.PreflightReplace(r.Context(), cc.CompanyID, cc.UserID, t, doc)
	if err != nil {
		writeError(w, err)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, documents.MaxRequestBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, documents.ErrInvalidRequest)
		return
	}

	var staged *documents.Staged
	defer func() {
		if staged != nil { // an early return: nothing consumed the stored object
			h.files.Discard(r.Context(), staged.Key)
		}
	}()
	var (
		name         *string
		seenName     bool
		expected     int
		seenExpected bool
		// one byte more than a legal value, to tell «too long» from «fine»
		maxExpectedRead = int64(maxVersionDigits + 2)
	)
	for {
		part, err := reader.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeError(w, multipartError(err))
			return
		}
		if part.Header.Get("Content-Transfer-Encoding") != "" {
			writeError(w, documents.ErrInvalidRequest)
			return
		}
		switch part.FormName() {
		case "file":
			if staged != nil || part.FileName() == "" {
				writeError(w, documents.ErrInvalidRequest)
				return
			}
			filename := path.Base(strings.ReplaceAll(part.FileName(), `\`, "/"))
			s, err := h.files.Stage(r.Context(), filename, part)
			if err != nil {
				writeError(w, err)
				return
			}
			staged = &s
		case "expected_version":
			if seenExpected || part.FileName() != "" {
				writeError(w, documents.ErrInvalidRequest)
				return
			}
			seenExpected = true
			raw, err := io.ReadAll(io.LimitReader(part, maxExpectedRead))
			if err != nil {
				writeError(w, multipartError(err))
				return
			}
			v, valid := parseVersion(string(raw))
			if !valid {
				writeError(w, documents.ErrExpectedVersionInvalid)
				return
			}
			expected = v
			if staged == nil { // before the file: a stale or capped replace is answered without streaming it
				if err := documents.CheckReplaceable(current, expected); err != nil {
					writeError(w, err)
					return
				}
			}
		case "name":
			if seenName || part.FileName() != "" {
				writeError(w, documents.ErrInvalidRequest)
				return
			}
			seenName = true
			raw, err := io.ReadAll(io.LimitReader(part, maxNameBytes+1))
			if err != nil {
				writeError(w, multipartError(err))
				return
			}
			if len(raw) > maxNameBytes {
				writeError(w, documents.ErrInvalidRequest)
				return
			}
			normalized, err := documents.NormalizeGivenName(string(raw))
			if err != nil {
				writeError(w, err)
				return
			}
			name = &normalized
		default:
			writeError(w, documents.ErrInvalidRequest)
			return
		}
		if err := part.Close(); err != nil {
			writeError(w, multipartError(err))
			return
		}
	}
	if staged == nil {
		writeError(w, documents.ErrInvalidRequest)
		return
	}
	if !seenExpected {
		writeError(w, documents.ErrExpectedVersionRequired)
		return
	}

	cmd := documents.ReplaceCommand{CompanyID: cc.CompanyID, ActorID: cc.UserID, Target: t, DocID: doc, ExpectedVersion: expected, Name: name, Staged: *staged}
	staged = nil // from here the service owns the object and discards it on every outcome but a fresh success
	res, err := h.files.Replace(r.Context(), cmd)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusCreated, res)
}

// Versions is GET P/documents/{doc}/versions (read gate): every version, newest first. It reads
// only the database, so it works with the storage disabled, and it is not audited (no content leaves).
func (h *Handler) Versions(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.reader == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, doc, ok := targetAndDocument(w, r)
	if !ok {
		return
	}
	list, err := h.reader.Versions(r.Context(), cc.CompanyID, cc.UserID, t, doc)
	if err != nil {
		writeError(w, err)
		return
	}
	if list.Versions == nil {
		list.Versions = []documents.VersionItem{}
	}
	httpjson.WriteJSON(w, http.StatusOK, list)
}

// FileVersion is GET P/documents/{doc}/versions/{n}/file (read gate): the numbered version as an
// attachment, audited before the first byte exactly like the current version. {n} must be a positive decimal integer (400
// invalid_request otherwise); a version the document does not have is 404 not_found.
func (h *Handler) FileVersion(w http.ResponseWriter, r *http.Request) {
	n, ok := parseVersion(chi.URLParam(r, "n"))
	if !ok {
		if _, session := identitysecurity.CompanyContextFromContext(r.Context()); !session || h == nil || h.files == nil {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError)) // fail closed before judging the input
			return
		}
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid version"))
		return
	}
	h.serveFile(w, r, n)
}

// Delete is DELETE P/documents/{doc} (manage gate): a hard delete of the whole document, audited
// (D13, D14). Answers 200 {scope}; the freed slot may bring `upload` back. A repeated delete is a plain 404 (no If-Match).
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.files == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, doc, ok := targetAndDocument(w, r)
	if !ok {
		return
	}
	res, err := h.files.Delete(r.Context(), cc.CompanyID, cc.UserID, t, doc)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, res)
}
