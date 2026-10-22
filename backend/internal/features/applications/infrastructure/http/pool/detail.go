package pool

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func detailError(w http.ResponseWriter, err error) {
	code := httpjson.CodeInternalError
	switch {
	case errors.Is(err, board.ErrNotFound):
		code = httpjson.CodeNotFound
	case errors.Is(err, board.ErrStorageUnavailable):
		code = httpjson.CodeCVStorageUnavailable
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
func detailParams(w http.ResponseWriter, r *http.Request) (security.CompanyContext, string, uuid.UUID, bool) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return cc, "", uuid.Nil, false
	}
	kind := chi.URLParam(r, "kind")
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil || (kind != "manual" && kind != "organic") || id == uuid.Nil {
		detailError(w, board.ErrNotFound)
		return cc, kind, id, false
	}
	return cc, kind, id, true
}
func (h *Handler) Detail(w http.ResponseWriter, r *http.Request) {
	cc, kind, id, ok := detailParams(w, r)
	if !ok {
		return
	}
	out, err := h.service.Detail(r.Context(), cc.CompanyID, kind, id)
	if err != nil {
		detailError(w, err)
		return
	}
	w.Header().Set("ETag", out.ETag)
	httpjson.WriteJSON(w, http.StatusOK, out)
}
func (h *Handler) File(w http.ResponseWriter, r *http.Request) {
	cc, kind, id, ok := detailParams(w, r)
	if !ok {
		return
	}
	pid, err := uuid.Parse(chi.URLParam(r, "participationId"))
	if err != nil || pid == uuid.Nil {
		detailError(w, board.ErrNotFound)
		return
	}
	out, err := h.service.File(r.Context(), cc.CompanyID, kind, id, pid)
	if err != nil {
		detailError(w, err)
		return
	}
	defer out.Reader.Close()
	extension := ".pdf"
	if out.ContentType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		extension = ".docx"
	}
	w.Header().Set("Content-Type", out.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": out.Name + extension}))
	w.Header().Set("Content-Length", strconv.FormatInt(out.Size, 10))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, out.Reader)
}
