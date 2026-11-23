package http

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// maxNameBytes bounds the optional `name` part before normalization (contract «POST P/documents»).
const maxNameBytes = 2048

// idempotencyKey reads the optional Idempotency-Key header: absent is fine (the upload is then not idempotent), a present
// one must be exactly one non-empty line holding a UUID in any spelling, canonicalized to lower-case hyphenated so every
// spelling shares one lock, one row and one replay. It is answered before the body is read.
func idempotencyKey(r *http.Request) (canonical string, ok bool) {
	values := r.Header.Values("Idempotency-Key")
	if len(values) == 0 {
		return "", true
	}
	if len(values) != 1 || values[0] == "" {
		return "", false
	}
	parsed, err := uuid.Parse(values[0])
	if err != nil {
		return "", false
	}
	return parsed.String(), true
}

// Upload is POST /v2/me/company/job-drafts/{id}/documents (manage gate: owner or recruiter; the store re-checks).
//
// Order: Idempotency-Key header → pre-flight authorization (before any byte is stored) → storage enabled → the multipart
// body is streamed to storage (never into memory) → one short write transaction. Whatever was staged is discarded on every
// failure path (the service already discards when the write itself fails).
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.files == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid draft id"))
		return
	}
	idem, ok := idempotencyKey(r)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidIdempotencyKey))
		return
	}
	if err := h.files.PreflightUpload(r.Context(), cc.CompanyID, cc.UserID, id); err != nil {
		writeError(w, err)
		return
	}

	// The whole request is capped (file plus multipart overhead) without spooling any byte into a temporary directory.
	r.Body = http.MaxBytesReader(w, r.Body, documents.MaxRequestBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, documents.ErrInvalidRequest)
		return
	}

	var file *documents.Staged
	defer func() {
		if file != nil { // an early return: nothing consumed the stored object
			h.files.Discard(r.Context(), file.Key)
		}
	}()
	var filename, name string
	seenName := false
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
			if file != nil || part.FileName() == "" {
				writeError(w, documents.ErrInvalidRequest)
				return
			}
			filename = path.Base(strings.ReplaceAll(part.FileName(), `\`, "/"))
			s, err := h.files.Stage(r.Context(), filename, part)
			if err != nil {
				writeError(w, err)
				return
			}
			file = &s
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
			// Validated as soon as it arrives: a bad name that comes first is answered before the file is streamed.
			if name, err = documents.NormalizeGivenName(string(raw)); err != nil {
				writeError(w, err)
				return
			}
		default:
			writeError(w, documents.ErrInvalidRequest)
			return
		}
		if err := part.Close(); err != nil {
			writeError(w, multipartError(err))
			return
		}
	}
	if file == nil {
		writeError(w, documents.ErrInvalidRequest)
		return
	}
	if !seenName {
		name = documents.DefaultName(filename)
	}

	cmd := documents.UploadCommand{CompanyID: cc.CompanyID, ActorID: cc.UserID, DraftID: id, IdempotencyKey: idem, Name: name, Staged: *file}
	file = nil // from here the service owns the object and discards it on every outcome but a fresh success
	res, err := h.files.Upload(r.Context(), cmd)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if idem != "" { // projected only when a key was sent; a first execution says false
		w.Header().Set("Idempotency-Replayed", strconv.FormatBool(res.Replayed))
	}
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write(res.Body)
}

// multipartError classifies a multipart framing failure: the request cap is 413, anything else is a malformed request.
func multipartError(err error) error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return documents.ErrTooLarge
	}
	return documents.ErrInvalidRequest
}

// File is GET /v2/me/company/job-drafts/{id}/documents/{doc}/file: the current version as an attachment (read gate:
// owner, recruiter, stakeholder). The store records DocumentDownloaded and commits before it returns the stream, so the
// audit row exists before the first byte leaves; nothing is recorded when the document or its file is missing or storage
// is unavailable (D21). Documents are only ever served as downloads, never inline (D10).
func (h *Handler) File(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.files == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid draft id"))
		return
	}
	doc, err := uuid.Parse(chi.URLParam(r, "doc"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid document id"))
		return
	}
	file, err := h.files.Download(r.Context(), cc.CompanyID, cc.UserID, id, doc)
	if err != nil {
		writeError(w, err)
		return
	}
	defer file.Reader.Close()
	header := w.Header()
	header.Set("Content-Type", file.ContentType)
	// FormatMediaType quotes an ASCII name and switches to RFC 5987 (filename*=utf-8''…) for any other, with no ASCII fallback.
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": file.Name})
	if disposition == "" {
		disposition = "attachment"
	}
	header.Set("Content-Disposition", disposition)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Length", strconv.FormatInt(file.Size, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, file.Reader)
}
