package preferences

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/inbox"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

// Port is what the handler needs; *Store implements it.
type Port interface {
	Catalog(ctx context.Context, scope inbox.Scope) (Catalog, error)
	Put(ctx context.Context, scope inbox.Scope, entries []Entry) (Catalog, error)
}

// CandidatePort adds the candidate account lookup of the candidate tree.
type CandidatePort interface {
	Port
	CandidateUser(ctx context.Context, sub string) (uuid.UUID, error)
}

// Handler serves GET / PUT …/preferences of one route tree with the same
// shapes; the scope (and so the tree) comes from the same resolvers as the
// inbox of that tree. Not audited (D5).
type Handler struct {
	store Port
	scope inbox.ScopeFunc
}

// NewHandler serves /v2/me/company/notifications/preferences behind the
// owner/recruiter/stakeholder gate (stakeholders get the member catalog,
// D23); the company comes only from the gate's CompanyContext.
func NewHandler(store Port) *Handler { return &Handler{store: store, scope: inbox.MemberScope} }

// NewCandidateHandler serves /v2/me/notifications/preferences behind
// requireCandidate: the session's candidate account, company NULL.
func NewCandidateHandler(store CandidatePort) *Handler {
	return &Handler{store: store, scope: inbox.CandidateScope(store.CandidateUser)}
}

// Get serves GET …/preferences: the caller tree's full catalog.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scope(w, r)
	if !ok {
		return
	}
	catalog, err := h.store.Catalog(r.Context(), scope)
	if err != nil {
		slog.Error("notification preferences read failed", "code_class", httpjson.CodeInternalError)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, catalog)
}

// Put serves PUT …/preferences: strict body, whole-list validation, 422 on
// locked types, then one transaction; 200 with the catalog after the change.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scope(w, r)
	if !ok {
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
		} else {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		}
		return
	}
	entries, err := ParsePut(raw, kind(scope))
	if err != nil {
		var invalid *InvalidBody
		var locked *LockedError
		switch {
		case errors.As(err, &invalid):
			httpjson.WriteValidationError(w, invalid.Fields)
		case errors.As(err, &locked):
			httpjson.WriteNotificationPreferenceLocked(w, locked.Types)
		default:
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		}
		return
	}
	catalog, err := h.store.Put(r.Context(), scope, entries)
	if err != nil {
		slog.Error("notification preferences write failed", "code_class", httpjson.CodeInternalError)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, catalog)
}
