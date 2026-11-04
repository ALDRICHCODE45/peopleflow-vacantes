package http

import (
	"context"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
)

// SessionHandler serves the two calls the BFF makes around a session
// (audit-log-v1 §3). Like the other body-less POST actions, the request body is
// not read. Both answer 204; whether anything was recorded is not observable.
type SessionHandler struct{ service *usecases.Sessions }

func NewSessionHandler(service *usecases.Sessions) *SessionHandler {
	return &SessionHandler{service: service}
}

// Start is POST /v2/me/session/start: once per sign-in.
func (h *SessionHandler) Start(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, func(ctx context.Context, subject string) error { return h.service.Started(ctx, subject) })
}

// End is POST /v2/me/session/end: when the user clicks «Cerrar sesión».
func (h *SessionHandler) End(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, func(ctx context.Context, subject string) error { return h.service.Ended(ctx, subject) })
}

func (h *SessionHandler) serve(w http.ResponseWriter, r *http.Request, record func(context.Context, string) error) {
	w.Header().Set("Cache-Control", "no-store")
	subject := security.ClaimsFromContext(r.Context()).Subject
	if subject == "" {
		respondUnauthorized(w, "missing authenticated subject")
		return
	}
	if h == nil || h.service == nil {
		respondServerError(w)
		return
	}
	if err := record(r.Context(), subject); err != nil {
		logLookupFailure(r, "session audit failed")
		respondServerError(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
