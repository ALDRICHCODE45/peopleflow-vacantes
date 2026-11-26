package inbox

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

// Reader is the read port of the handler.
type Reader interface {
	List(ctx context.Context, scope Scope, q Query) (Page, error)
	UnreadCount(ctx context.Context, scope Scope) (Counts, error)
}

// Handler serves the member routes behind the owner/recruiter/stakeholder gate
// (D18); the scope comes only from the gate's CompanyContext.
type Handler struct{ reader Reader }

func NewHandler(reader Reader) *Handler { return &Handler{reader: reader} }

func scopeOf(r *http.Request) (Scope, bool) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
		return Scope{}, false
	}
	return Scope{UserID: cc.UserID, CompanyID: cc.CompanyID, Owner: cc.Role == valueobjects.OwnerRole}, true
}

// List serves GET B.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	scope, ok := scopeOf(r)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return
	}
	q, err := ParseQuery(r.URL.Query())
	if err != nil {
		var invalid *InvalidFilter
		switch {
		case errors.As(err, &invalid):
			fields := make([]httpjson.ValidationField, len(invalid.Fields))
			for i, f := range invalid.Fields {
				fields[i] = httpjson.ValidationField{Field: f.Field, Code: f.Code}
			}
			httpjson.WriteInvalidFilterFields(w, fields)
		case errors.Is(err, ErrInvalidCursor):
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
		default:
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		}
		return
	}
	page, err := h.reader.List(r.Context(), scope, q)
	if err != nil {
		slog.Error("notifications list failed", "code_class", httpjson.CodeInternalError)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, page)
}

// UnreadCount serves GET B/unread-count.
func (h *Handler) UnreadCount(w http.ResponseWriter, r *http.Request) {
	scope, ok := scopeOf(r)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return
	}
	counts, err := h.reader.UnreadCount(r.Context(), scope)
	if err != nil {
		slog.Error("notifications unread count failed", "code_class", httpjson.CodeInternalError)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, counts)
}
