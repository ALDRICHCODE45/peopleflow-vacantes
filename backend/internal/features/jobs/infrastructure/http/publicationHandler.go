package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

type PublicationHandler struct{ store publication.Store }

func NewPublicationHandler(store publication.Store) *PublicationHandler {
	return &PublicationHandler{store: store}
}

type PublicationHandlers struct{ GetPublication, Publish http.HandlerFunc }

func (h *PublicationHandler) PublicationHandlers() PublicationHandlers {
	return PublicationHandlers{GetPublication: h.getPublication, Publish: h.publish}
}
func (h *PublicationHandler) getPublication(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetPublication(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writePublicationError(w, err)
		return
	}
	// Readiness has no version/ETag; the draft read supplies the publish tag.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result.Body)
}
func (h *PublicationHandler) publish(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	// Do not reject a key here: §9.4 places draft authorization before its shape
	// check. Preserve absence, emptiness and repeated lines for the store.
	keys := r.Header.Values("Idempotency-Key")
	key := strings.Join(keys, ",")
	tag, present := ifMatchHeader(r)
	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}
	result, err := h.store.Publish(r.Context(), cc.CompanyID, cc.UserID, id, key, len(keys) > 0, tag, present, body)
	if err != nil {
		writePublicationError(w, err)
		return
	}
	replayed := result.Replayed
	writeDraftResult(w, http.StatusCreated, result, &replayed)
}
func writePublicationError(w http.ResponseWriter, err error) {
	var incomplete *publication.Incomplete
	switch {
	case errors.As(err, &incomplete):
		httpjson.WritePublicationError(w, httpjson.Resolve(httpjson.CodePublicationIncomplete), incomplete.Missing)
	case errors.Is(err, publication.ErrAlreadyPublished):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeAlreadyPublished))
	default:
		writeDraftError(w, err)
	}
}
