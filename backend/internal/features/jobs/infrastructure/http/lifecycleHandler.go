package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

type LifecycleHandler struct{ store lifecycle.Store }

func NewLifecycleHandler(store lifecycle.Store) *LifecycleHandler {
	return &LifecycleHandler{store: store}
}

type LifecycleHandlers struct{ Get, History, Pause, Resume, Close, FinishProcess, Reopen http.HandlerFunc }

func (h *LifecycleHandler) LifecycleHandlers() LifecycleHandlers {
	return LifecycleHandlers{Get: h.get, History: h.history, Pause: h.transition("pause"), Resume: h.transition("resume"), Close: h.transition("close"), FinishProcess: h.transition("finish_process"), Reopen: h.transition("reopen")}
}
func (h *LifecycleHandler) get(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetLifecycle(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
func (h *LifecycleHandler) history(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetLifecycleHistory(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
func (h *LifecycleHandler) transition(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cc, ok := requireCompanyContext(w, r)
		if !ok {
			return
		}
		id, ok := draftID(w, r)
		if !ok {
			return
		}
		keys := r.Header.Values("Idempotency-Key")
		key := strings.Join(keys, ",")
		tag, present := ifMatchHeader(r)
		body, ok := readDraftBody(w, r)
		if !ok {
			return
		}
		result, err := h.store.TransitionLifecycle(r.Context(), cc.CompanyID, cc.UserID, id, action, key, len(keys) > 0, tag, present, body)
		if err != nil {
			writeLifecycleError(w, err)
			return
		}
		replayed := result.Replayed
		writeDraftResult(w, http.StatusOK, result, &replayed)
	}
}
func writeLifecycleError(w http.ResponseWriter, err error) {
	var uncovered *lifecycle.CloseReasonNotCovered
	if errors.As(err, &uncovered) {
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeCloseReasonNotCovered), uncovered)
		return
	}
	var invalid *lifecycle.InvalidTransition
	if errors.As(err, &invalid) {
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeLifecycleTransitionInvalid), invalid)
		return
	}
	writePublicationError(w, err)
}
