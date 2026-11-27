package unsubscribe

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

// MaxBodyBytes caps the POST body, which is otherwise ignored (§Limits).
const MaxBodyBytes = 1 << 10

// ErrNoTarget: the token's user is gone, not live or of the other user type,
// or its company is gone. The handler answers it like any invalid token.
var ErrNoTarget = errors.New("unsubscribe target not found")

// Target is the state of a valid token's (user, company, type): the company
// name (nil for candidates) and the email override row (nil = no row).
type Target struct {
	CompanyName *string
	Email       *bool
}

// Verifier checks a token; *Signer implements it (nil = no keys: all invalid).
type Verifier interface {
	Verify(token string) (domain.PreferenceKey, error)
}

// Port is the persistence the handler needs; *Store implements it.
type Port interface {
	// Target reads the state without writing (GET).
	Target(ctx context.Context, k domain.PreferenceKey) (Target, error)
	// TurnOff upserts email = false, source 'unsubscribe' (POST, idempotent).
	TurnOff(ctx context.Context, k domain.PreferenceKey) (Target, error)
}

// Handler serves GET / POST /v2/notifications/unsubscribe?token=…: public, no
// cookies or session, behind Privacy and the per-IP Limiter. Not audited (D5).
type Handler struct {
	verifier Verifier
	store    Port
}

func NewHandler(v Verifier, store Port) *Handler { return &Handler{verifier: v, store: store} }

// Response is the 200 body of both methods.
type Response struct {
	Type    domain.Type `json:"type"`
	Channel string      `json:"channel"`
	Enabled bool        `json:"enabled"`
	Company *Company    `json:"company"`
}

// Company is the member token's company; null for candidates.
type Company struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// Privacy marks every unsubscribe response private (as AssessmentPrivacy):
// never cached, and the token-bearing URL never sent as a referrer.
func Privacy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// Get reports what POST would turn off and its current effective value. It
// never writes (link scanners prefetch GETs).
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	key, ok := h.verify(r)
	if !ok {
		writeInvalid(w)
		return
	}
	h.answer(w, r, key, h.store.Target)
}

// Post turns the email channel off for the token's (user, company, type). The
// body (RFC 8058 `List-Unsubscribe=One-Click`, empty or `{}`) is read up to
// 1 KiB and ignored.
func (h *Handler) Post(w http.ResponseWriter, r *http.Request) {
	if _, err := io.Copy(io.Discard, http.MaxBytesReader(w, r.Body, MaxBodyBytes)); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
		} else {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		}
		return
	}
	key, ok := h.verify(r)
	if !ok {
		writeInvalid(w)
		return
	}
	h.answer(w, r, key, h.store.TurnOff)
}

func (h *Handler) answer(w http.ResponseWriter, r *http.Request, key domain.PreferenceKey, op func(context.Context, domain.PreferenceKey) (Target, error)) {
	target, err := op(r.Context(), key)
	if errors.Is(err, ErrNoTarget) {
		writeInvalid(w)
		return
	}
	if err != nil {
		// Never the token, the user or the company: the class only.
		slog.Error("notification unsubscribe failed", "code_class", httpjson.CodeInternalError)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	out := Response{Type: key.Type, Channel: string(domain.ChannelEmail), Enabled: domain.EffectivePreference(key.Type, domain.ChannelEmail, target.Email)}
	if key.Company != uuid.Nil {
		name := ""
		if target.CompanyName != nil {
			name = *target.CompanyName
		}
		out.Company = &Company{ID: key.Company, Name: name}
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}

// verify reads exactly one token query value and checks it; any failure is
// the same false.
func (h *Handler) verify(r *http.Request) (domain.PreferenceKey, bool) {
	values, ok := r.URL.Query()["token"]
	if !ok || len(values) != 1 || h.verifier == nil {
		return domain.PreferenceKey{}, false
	}
	key, err := h.verifier.Verify(values[0])
	return key, err == nil
}

func writeInvalid(w http.ResponseWriter) {
	httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnsubscribeLinkInvalid))
}
