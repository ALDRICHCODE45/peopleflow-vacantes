package board

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	store     app.Store
	inspector app.ManualCVInspector
	storage   app.ManualFileStorage
}

func NewHandler(store app.Store) *Handler { return &Handler{store: store} }

// WithManualCVPorts supplies composition-root adapters without coupling features.
func (h *Handler) WithManualCVPorts(inspector app.ManualCVInspector, storage app.ManualFileStorage) *Handler {
	h.inspector, h.storage = inspector, storage
	return h
}
func writeError(w http.ResponseWriter, err error) {
	code := httpjson.CodeInternalError
	var finished *app.ProcessFinished
	switch {
	case errors.As(err, &finished):
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeProcessFinished), finished)
		return
	case errors.Is(err, app.ErrNotFound):
		code = httpjson.CodeNotFound
	case errors.Is(err, app.ErrUnauthenticated):
		code = httpjson.CodeUnauthenticated
	case errors.Is(err, app.ErrForbidden):
		code = httpjson.CodeForbidden
	case errors.Is(err, app.ErrCompanyInactive):
		code = httpjson.CodeCompanyInactive
	case errors.Is(err, app.ErrCompanyNotActive):
		code = httpjson.CodeCompanyNotActive
	case errors.Is(err, app.ErrInvalidRequest):
		code = httpjson.CodeInvalidRequest
	case errors.Is(err, app.ErrValidation):
		code = httpjson.CodeValidationError
	case errors.Is(err, app.ErrPreconditionRequired):
		code = httpjson.CodePreconditionRequired
	case errors.Is(err, app.ErrVersionConflict):
		code = httpjson.CodeVersionConflict
	case errors.Is(err, app.ErrStageSkip):
		code = httpjson.CodeStageSkipNotAllowed
	case errors.Is(err, app.ErrPlacementExit):
		code = httpjson.CodePlacementExitConfirmationRequired
	case errors.Is(err, app.ErrRecoveryStageRequired):
		code = httpjson.CodeRecoveryStageRequired
	case errors.Is(err, app.ErrPlacementReentry):
		code = httpjson.CodePlacementReentryConfirmationRequired
	case errors.Is(err, app.ErrAlreadyDiscarded):
		code = httpjson.CodeAlreadyDiscarded
	case errors.Is(err, app.ErrNotDiscarded):
		code = httpjson.CodeNotDiscarded
	case errors.Is(err, app.ErrSubstateRequiresInProcess):
		code = httpjson.CodeSubstateRequiresInProcess
	case errors.Is(err, app.ErrNotPublished):
		code = httpjson.CodeVacancyNotPublished
	case errors.Is(err, app.ErrTooLarge):
		code = httpjson.CodeBoardTooLarge
	case errors.Is(err, app.ErrStorageUnavailable):
		code = httpjson.CodeCVStorageUnavailable
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
func (h *Handler) params(w http.ResponseWriter, r *http.Request, item bool) (security.CompanyContext, uuid.UUID, uuid.UUID, bool) {
	w.Header().Set("Cache-Control", "no-store")
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.store == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return cc, uuid.Nil, uuid.Nil, false
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, app.ErrInvalidRequest)
		return cc, id, uuid.Nil, false
	}
	pid := uuid.Nil
	if item {
		pid, err = uuid.Parse(chi.URLParam(r, "pid"))
		if err != nil {
			writeError(w, app.ErrInvalidRequest)
			return cc, id, pid, false
		}
	}
	return cc, id, pid, true
}
func (h *Handler) Board(w http.ResponseWriter, r *http.Request) {
	cc, id, _, ok := h.params(w, r, false)
	if !ok {
		return
	}
	out, err := h.store.Board(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, 200, out)
}
func (h *Handler) SetSubstate(w http.ResponseWriter, r *http.Request) { h.mutate(w, r, "substate") }
func (h *Handler) Move(w http.ResponseWriter, r *http.Request)        { h.mutate(w, r, "move") }
func (h *Handler) Discard(w http.ResponseWriter, r *http.Request)     { h.mutate(w, r, "discard") }
func (h *Handler) Recover(w http.ResponseWriter, r *http.Request)     { h.mutate(w, r, "recover") }
func (h *Handler) mutate(w http.ResponseWriter, r *http.Request, kind string) {
	cc, id, pid, ok := h.params(w, r, true)
	if !ok {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1048576))
	if err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
		} else {
			writeError(w, app.ErrInvalidRequest)
		}
		return
	}
	tags := r.Header.Values("If-Match")
	operation := h.store.Move
	switch kind {
	case "discard":
		operation = h.store.Discard
	case "recover":
		operation = h.store.Recover
	case "substate":
		operation = h.store.SetSubstate
	}
	out, err := operation(r.Context(), cc.CompanyID, cc.UserID, id, pid, strings.Join(tags, ","), len(tags) > 0, body)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("ETag", out.ETag)
	httpjson.WriteJSON(w, 200, out)
}
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	cc, id, pid, ok := h.params(w, r, true)
	if !ok {
		return
	}
	out, err := h.store.History(r.Context(), cc.CompanyID, cc.UserID, id, pid)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, 200, out)
}
func (h *Handler) Detail(w http.ResponseWriter, r *http.Request) {
	cc, id, pid, ok := h.params(w, r, true)
	if !ok {
		return
	}
	out, err := h.store.Detail(r.Context(), cc.CompanyID, cc.UserID, id, pid)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, 200, out)
}
func (h *Handler) File(w http.ResponseWriter, r *http.Request)         { h.file(w, r, false) }
func (h *Handler) OriginalFile(w http.ResponseWriter, r *http.Request) { h.file(w, r, true) }
func (h *Handler) file(w http.ResponseWriter, r *http.Request, original bool) {
	cc, id, pid, ok := h.params(w, r, true)
	if !ok {
		return
	}
	operation := h.store.File
	if original {
		reader, ok := h.store.(app.OriginalFileReader)
		if !ok {
			writeError(w, app.ErrStorageUnavailable)
			return
		}
		operation = reader.OriginalFile
	}
	out, err := operation(r.Context(), cc.CompanyID, cc.UserID, id, pid)
	if err != nil {
		writeError(w, err)
		return
	}
	defer out.Reader.Close()
	extension := ".pdf"
	if out.ContentType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		extension = ".docx"
	}
	// Keep legacy board names byte-identical for candidate/manual-intake CVs
	// and the original route. Only company corrections need suffix deduplication.
	filename := out.Name + extension
	if out.CompanyCorrected && !original {
		filename = httpjson.AttachmentFilename(out.Name, extension)
	}
	w.Header().Set("Content-Type", out.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	w.Header().Set("Content-Length", strconv.FormatInt(out.Size, 10))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	_, _ = io.Copy(w, out.Reader)
}
