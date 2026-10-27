package http

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func (h *Handler) WithMedia(store app.MediaStore, storage app.Storage) *Handler {
	h.mediaStore = store
	h.storage = storage
	return h
}
func mediaError(w http.ResponseWriter, code httpjson.Code) {
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
func (h *Handler) mediaReady(w http.ResponseWriter) bool {
	if h == nil || h.storage == nil || h.mediaStore == nil {
		mediaError(w, httpjson.CodeCVStorageUnavailable)
		return false
	}
	return true
}
func (h *Handler) UploadMedia(w http.ResponseWriter, r *http.Request) {
	if !h.mediaReady(w) {
		return
	}
	cc, ok := company(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, app.MaxMediaBytes+64*1024)
	reader, err := r.MultipartReader()
	if err != nil {
		mediaError(w, httpjson.CodeInvalidRequest)
		return
	}
	var kind string
	var data []byte
	seen := map[string]bool{}
	for {
		part, e := reader.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			uploadReadError(w, e)
			return
		}
		name := part.FormName()
		if seen[name] || (name != "kind" && name != "file") {
			mediaError(w, httpjson.CodeInvalidRequest)
			return
		}
		seen[name] = true
		limit := int64(app.MaxMediaBytes)
		if name == "kind" {
			limit = 64
		}
		value, e := io.ReadAll(io.LimitReader(part, limit+1))
		if e != nil {
			uploadReadError(w, e)
			return
		}
		if int64(len(value)) > limit {
			if name == "file" {
				mediaError(w, httpjson.CodePayloadTooLarge)
			} else {
				mediaError(w, httpjson.CodeInvalidRequest)
			}
			return
		}
		if name == "kind" {
			kind = string(value)
		} else {
			data = value
		}
	}
	// Consume any multipart epilogue under the same envelope bound before writing.
	if _, err := io.Copy(io.Discard, r.Body); err != nil {
		uploadReadError(w, err)
		return
	}
	if !seen["kind"] || !seen["file"] {
		mediaError(w, httpjson.CodeInvalidRequest)
		return
	}
	switch kind {
	case "cover", "gallery", "portrait", "story":
	default:
		validation(w, []app.Field{{Field: "kind", Code: "invalid"}})
		return
	}
	cleaned, typ, width, height, code := app.PrepareMedia(data)
	if code != "" {
		mediaError(w, httpjson.Code(code))
		return
	}
	m := app.StoredMedia{Media: app.Media{Kind: kind, Width: width, Height: height}, ContentType: typ}
	m, err = h.mediaStore.InsertMedia(r.Context(), cc.CompanyID, cc.UserID, m, cleaned, h.storage)
	switch {
	case errors.Is(err, app.ErrMediaLimit):
		mediaError(w, httpjson.CodeMediaLimitReached)
	case err != nil:
		mediaError(w, httpjson.CodeInternalError)
	default:
		httpjson.WriteJSON(w, http.StatusCreated, m)
	}
}
func uploadReadError(w http.ResponseWriter, err error) {
	var large *http.MaxBytesError
	if errors.As(err, &large) {
		mediaError(w, httpjson.CodePayloadTooLarge)
	} else {
		mediaError(w, httpjson.CodeInvalidRequest)
	}
}
func (h *Handler) GetMedia(w http.ResponseWriter, r *http.Request) {
	// Error responses must not be heuristically cached (404 is cacheable by default).
	w.Header().Set("Cache-Control", "no-store")
	if !h.mediaReady(w) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		mediaError(w, httpjson.CodeNotFound)
		return
	}
	m, err := h.mediaStore.FindMedia(r.Context(), id)
	if errors.Is(err, app.ErrMediaNotFound) {
		mediaError(w, httpjson.CodeNotFound)
		return
	}
	if err != nil {
		mediaError(w, httpjson.CodeInternalError)
		return
	}
	f, err := h.storage.Open(r.Context(), m.StorageKey)
	if err != nil {
		mediaError(w, httpjson.CodeInternalError)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", m.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(m.ByteSize, 10))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
}
