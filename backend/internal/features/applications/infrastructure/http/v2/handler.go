package v2

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	store  app.Store
	decode app.JSONDecoder
}

func NewHandler(store app.Store, decode app.JSONDecoder) *Handler { return &Handler{store, decode} }
func writeError(w http.ResponseWriter, err error) {
	code := httpjson.CodeInternalError
	var details *app.InvalidAnswers
	var restriction *app.CountryRestriction
	var unavailable *app.NotAcceptingApplications
	switch {
	case errors.As(err, &unavailable):
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeVacancyNotAcceptingApplications), unavailable)
		return
	case errors.As(err, &restriction):
		switch {
		case errors.Is(err, app.ErrApplicantCountryRequired):
			code = httpjson.CodeApplicantCountryRequired
		case errors.Is(err, app.ErrApplicantCountryNotAllowed):
			code = httpjson.CodeApplicantCountryNotAllowed
		}
		httpjson.WriteApplicantCountryError(w, httpjson.Resolve(code), restriction.Allowed)
		return
	case errors.Is(err, app.ErrMessageUnavailable):
		code = httpjson.CodeMessageUnavailable
	case errors.Is(err, app.ErrMessageChanged):
		code = httpjson.CodeMessageChanged
	case errors.Is(err, app.ErrInvalidRequest):
		code = httpjson.CodeInvalidRequest
	case errors.Is(err, app.ErrNotFound):
		code = httpjson.CodeNotFound
	case errors.Is(err, app.ErrQuestionnaireChanged):
		code = httpjson.CodeQuestionnaireChanged
	case errors.Is(err, app.ErrAlreadyApplied):
		code = httpjson.CodeAlreadyApplied
	case errors.Is(err, app.ErrCVUnavailable):
		code = httpjson.CodeCVUnavailable
	case errors.Is(err, app.ErrIdempotencyConflict):
		code = httpjson.CodeIdempotencyConflict
	case errors.As(err, &details):
		httpjson.WriteApplicationError(w, httpjson.Resolve(httpjson.CodeInvalidAnswers), details.Details)
		return
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
func (h *Handler) Apply(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, app.ErrInvalidRequest)
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
	values := r.Header.Values("Idempotency-Key")
	if len(values) == 0 {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeIdempotencyKeyRequired))
		return
	}
	if len(values) != 1 {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidIdempotencyKey))
		return
	}
	key, err := uuid.Parse(values[0])
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidIdempotencyKey))
		return
	}
	request, err := app.Decode(raw, h.decode)
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := h.store.Apply(r.Context(), security.ClaimsFromContext(r.Context()).Subject, id, key, request)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Idempotency-Replayed", strconv.FormatBool(result.Replayed))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	_, _ = w.Write(result.Body)
}
func (h *Handler) MarkMessageRead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil || id == uuid.Nil {
		writeError(w, app.ErrInvalidRequest)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1048576))
	if err != nil {
		writeError(w, app.ErrInvalidRequest)
		return
	}
	at, err := app.DecodeMessageRead(raw, h.decode)
	if err != nil {
		writeError(w, err)
		return
	}
	if err = h.store.MarkMessageRead(r.Context(), security.ClaimsFromContext(r.Context()).Subject, id, at); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	q, err := app.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeError(w, err)
		return
	}
	page, err := h.store.List(r.Context(), security.ClaimsFromContext(r.Context()).Subject, q)
	if err != nil {
		writeError(w, err)
		return
	}
	httpjson.WriteJSON(w, 200, page)
}
