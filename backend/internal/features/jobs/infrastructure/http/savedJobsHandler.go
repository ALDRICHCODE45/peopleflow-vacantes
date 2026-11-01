package http

import (
	"errors"
	"net/http"
	"net/url"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/savedjobs"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type SavedJobsHandler struct{ store app.Store }

func NewSavedJobsHandler(store app.Store) *SavedJobsHandler { return &SavedJobsHandler{store: store} }
func savedJobsSubject(r *http.Request) string               { return security.ClaimsFromContext(r.Context()).Subject }
func savedJobsError(w http.ResponseWriter, err error) {
	code := httpjson.CodeInternalError
	switch {
	case errors.Is(err, app.ErrNotFound):
		code = httpjson.CodeNotFound
	case errors.Is(err, app.ErrUnavailable):
		code = httpjson.CodeJobUnavailable
	case errors.Is(err, app.ErrLimit):
		code = httpjson.CodeSavedJobsLimit
	}
	httpjson.WriteSavedJobError(w, httpjson.Resolve(code))
}
func savedJobID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := chi.URLParam(r, "jobId")
	id, err := uuid.Parse(raw)
	if err != nil || len(raw) != 36 {
		savedJobsError(w, app.ErrNotFound)
		return uuid.Nil, false
	}
	return id, true
}
func (h *SavedJobsHandler) ready(w http.ResponseWriter) bool {
	w.Header().Set("Cache-Control", "no-store")
	if h == nil || h.store == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return false
	}
	return true
}
func (h *SavedJobsHandler) Save(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	id, ok := savedJobID(w, r)
	if !ok {
		return
	}
	saved, created, err := h.store.Save(r.Context(), savedJobsSubject(r), id)
	if err != nil {
		savedJobsError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpjson.WriteJSON(w, status, saved)
}
func (h *SavedJobsHandler) Remove(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	id, ok := savedJobID(w, r)
	if !ok {
		return
	}
	if err := h.store.Remove(r.Context(), savedJobsSubject(r), id); err != nil {
		savedJobsError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *SavedJobsHandler) RemoveClosed(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(values) != 1 || len(values["availability"]) != 1 || values.Get("availability") != "closed" {
		httpjson.WriteValidationError(w, []httpjson.ValidationField{{Field: "availability", Code: "invalid"}})
		return
	}
	count, err := h.store.RemoveClosed(r.Context(), savedJobsSubject(r))
	if err != nil {
		savedJobsError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, struct {
		Removed int `json:"removed"`
	}{count})
}
func (h *SavedJobsHandler) List(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	page, err := h.store.List(r.Context(), savedJobsSubject(r))
	if err != nil {
		savedJobsError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, page)
}
func (h *SavedJobsHandler) IDs(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	ids, err := h.store.IDs(r.Context(), savedJobsSubject(r))
	if err != nil {
		savedJobsError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, struct {
		JobIDs []uuid.UUID `json:"job_ids"`
	}{ids})
}
