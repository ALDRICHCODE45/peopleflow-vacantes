package http

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/assessment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type AssessmentHandler struct{ store assessment.Store }

func NewAssessmentHandler(store assessment.Store) *AssessmentHandler {
	return &AssessmentHandler{store}
}

// AssessmentPrivacy wraps authentication too: errors must not be cacheable.
func AssessmentPrivacy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
func (h *AssessmentHandler) Get(w http.ResponseWriter, r *http.Request)     { h.serve(w, r, "get") }
func (h *AssessmentHandler) Items(w http.ResponseWriter, r *http.Request)   { h.serve(w, r, "items") }
func (h *AssessmentHandler) Consent(w http.ResponseWriter, r *http.Request) { h.serve(w, r, "consent") }
func (h *AssessmentHandler) Put(w http.ResponseWriter, r *http.Request)     { h.serve(w, r, "put") }
func (h *AssessmentHandler) Delete(w http.ResponseWriter, r *http.Request)  { h.serve(w, r, "delete") }
func (h *AssessmentHandler) List(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		assessmentError(w, errors.New("missing assessment store"))
		return
	}
	result, err := h.store.List(r.Context(), security.ClaimsFromContext(r.Context()).Subject)
	h.respond(w, result, err)
}
func (h *AssessmentHandler) serve(w http.ResponseWriter, r *http.Request, action string) {
	if h == nil || h.store == nil {
		assessmentError(w, errors.New("missing assessment store"))
		return
	}
	a := assessment.Access{Subject: security.ClaimsFromContext(r.Context()).Subject}
	if token := chi.URLParam(r, "token"); token != "" {
		a.Public = true
		a.Token = token
	} else {
		id, err := uuid.Parse(chi.URLParam(r, "iid"))
		if err != nil {
			assessmentError(w, assessment.ErrNotFound)
			return
		}
		a.ID = id
	}
	// Resolve access before decoding any input. This ensures even invalid bodies
	// on unavailable public links receive the one indistinguishable response.
	if action != "get" {
		if _, err := h.store.Execute(r.Context(), a, "get", 0, assessment.Command{}); err != nil {
			assessmentError(w, err)
			return
		}
	}
	position := 0
	if action == "put" || action == "delete" {
		n, err := strconv.Atoi(chi.URLParam(r, "position"))
		if err != nil || n < 1 || n > 63 {
			assessmentError(w, assessment.ErrNotFound)
			return
		}
		position = n
	}
	var c assessment.Command
	if action == "put" || action == "delete" || action == "consent" {
		var err error
		c, err = assessment.Decode(http.MaxBytesReader(w, r.Body, 4096), action)
		if err != nil {
			assessmentError(w, err)
			return
		}
	}
	result, err := h.store.Execute(r.Context(), a, action, position, c)
	h.respond(w, result, err)
}
func (h *AssessmentHandler) respond(w http.ResponseWriter, result assessment.Result, err error) {
	if err != nil {
		assessmentError(w, err)
		return
	}
	if result.Status != 204 {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(result.Status)
	if result.Status != 204 {
		_, _ = w.Write(result.Body)
	}
}
func assessmentError(w http.ResponseWriter, err error) {
	var invalid *assessment.Invalid
	if errors.As(err, &invalid) {
		httpjson.WriteValidationError(w, invalid.Fields)
		return
	}
	code := httpjson.CodeInternalError
	for _, p := range []struct {
		err  error
		code httpjson.Code
	}{
		{assessment.ErrNotFound, httpjson.CodeNotFound}, {assessment.ErrUnavailable, httpjson.CodeAssessmentUnavailable},
		{assessment.ErrConsentRequired, httpjson.CodeConsentRequired}, {assessment.ErrNoticeChanged, httpjson.CodeNoticeChanged},
		{assessment.ErrFinished, httpjson.CodeAssessmentFinished}, {assessment.ErrClosed, httpjson.CodeInvitationClosed},
		{assessment.ErrInvalidRequest, httpjson.CodeInvalidRequest},
	} {
		if errors.Is(err, p.err) {
			code = p.code
			break
		}
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
