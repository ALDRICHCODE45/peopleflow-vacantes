package cvs

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	library app.Library
	decode  func([]byte) (any, error)
}

func NewHandler(library app.Library, decode func([]byte) (any, error)) *Handler {
	return &Handler{library, decode}
}
func subject(r *http.Request) string { return security.ClaimsFromContext(r.Context()).Subject }
func private(w http.ResponseWriter)  { w.Header().Set("Cache-Control", "no-store") }
func writeError(w http.ResponseWriter, err error) {
	code := httpjson.CodeInternalError
	switch {
	case errors.Is(err, app.ErrInvalidRequest):
		code = httpjson.CodeInvalidRequest
	case errors.Is(err, app.ErrTooLarge):
		code = httpjson.CodeCVTooLarge
	case errors.Is(err, app.ErrUnsupportedType):
		code = httpjson.CodeCVUnsupportedType
	case errors.Is(err, app.ErrContentMismatch):
		code = httpjson.CodeCVContentMismatch
	case errors.Is(err, app.ErrLibraryFull):
		code = httpjson.CodeCVLibraryFull
	case errors.Is(err, app.ErrNotFound):
		code = httpjson.CodeNotFound
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	private(w)
	// Bound raw multipart overhead as well as each part, without spooling any
	// attacker-controlled bytes into the system temporary directory.
	r.Body = http.MaxBytesReader(w, r.Body, int64(app.MaxBytes+65536))
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, app.ErrInvalidRequest)
		return
	}
	var data []byte
	var filename, name string
	seenFile, seenName := false, false
	for {
		part, err := reader.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			multipartError(w, err)
			return
		}
		if part.Header.Get("Content-Transfer-Encoding") != "" {
			writeError(w, app.ErrInvalidRequest)
			return
		}
		switch part.FormName() {
		case "file":
			if seenFile || part.FileName() == "" {
				writeError(w, app.ErrInvalidRequest)
				return
			}
			seenFile = true
			filename = path.Base(strings.ReplaceAll(part.FileName(), `\`, "/"))
			data, err = io.ReadAll(io.LimitReader(part, int64(app.MaxBytes+1)))
			if err != nil {
				multipartError(w, err)
				return
			}
			if len(data) > app.MaxBytes {
				writeError(w, app.ErrTooLarge)
				return
			}
		case "name":
			if seenName || part.FileName() != "" {
				writeError(w, app.ErrInvalidRequest)
				return
			}
			seenName = true
			raw, err := io.ReadAll(io.LimitReader(part, 2049))
			if err != nil {
				multipartError(w, err)
				return
			}
			if len(raw) > 2048 {
				writeError(w, app.ErrInvalidRequest)
				return
			}
			name = string(raw)
		default:
			writeError(w, app.ErrInvalidRequest)
			return
		}
		if err = part.Close(); err != nil {
			multipartError(w, err)
			return
		}
	}
	if !seenFile {
		writeError(w, app.ErrInvalidRequest)
		return
	}
	if !seenName {
		name = filename
	}
	name, err = app.NormalizeName(name)
	if err != nil {
		writeError(w, err)
		return
	}
	if _, err = app.Inspect(filename, data); err != nil {
		writeError(w, err)
		return
	}
	c, err := h.library.Upload(r.Context(), subject(r), name, filename, data)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, 201, c)
}
func multipartError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, app.ErrTooLarge)
	} else {
		writeError(w, app.ErrInvalidRequest)
	}
}
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	private(w)
	items, err := h.library.List(r.Context(), subject(r))
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, 200, app.NewPage(items))
}
func parseID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, app.ErrInvalidRequest)
		return uuid.Nil, false
	}
	return id, true
}
func (h *Handler) Rename(w http.ResponseWriter, r *http.Request) {
	private(w)
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1048576))
	if err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
		} else {
			writeError(w, app.ErrInvalidRequest)
		}
		return
	}
	value, err := h.decode(raw)
	if err != nil {
		writeError(w, app.ErrInvalidRequest)
		return
	}
	obj, ok := value.(map[string]any)
	if !ok || len(obj) != 1 {
		writeError(w, app.ErrInvalidRequest)
		return
	}
	name, ok := obj["name"].(string)
	if !ok {
		writeError(w, app.ErrInvalidRequest)
		return
	}
	name, err = app.NormalizeName(name)
	if err != nil {
		writeError(w, err)
		return
	}
	cv, err := h.library.Rename(r.Context(), subject(r), id, name)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, 200, cv)
}
func (h *Handler) Remove(w http.ResponseWriter, r *http.Request) {
	private(w)
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if err := h.library.Remove(r.Context(), subject(r), id); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (h *Handler) File(w http.ResponseWriter, r *http.Request) {
	private(w)
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	cv, file, err := h.library.File(r.Context(), subject(r), id)
	if err != nil {
		writeError(w, err)
		return
	}
	defer file.Close()
	extension := ".pdf"
	if cv.ContentType == app.DOCX {
		extension = ".docx"
	}
	w.Header().Set("Content-Type", cv.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": cv.Name + extension}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.FormatInt(cv.Size, 10))
	w.WriteHeader(200)
	_, _ = io.Copy(w, file)
}
