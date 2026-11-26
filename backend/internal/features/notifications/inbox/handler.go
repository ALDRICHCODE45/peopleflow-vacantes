package inbox

import (
	"context"
	"errors"
	"io"
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

// Writer is the mark and facets port of the handler (N5).
type Writer interface {
	Read(ctx context.Context, scope Scope, req MarkRequest) (MarkResult, error)
	Unread(ctx context.Context, scope Scope, req MarkRequest) (MarkResult, error)
	ReadAll(ctx context.Context, scope Scope, req ReadAllRequest) (MarkResult, error)
	Facets(ctx context.Context, scope Scope, state string) (Facets, error)
}

// Port is everything the handler needs; *Store implements it.
type Port interface {
	Reader
	Writer
}

// Handler serves the member routes behind the owner/recruiter/stakeholder gate
// (D18); the scope comes only from the gate's CompanyContext.
type Handler struct{ store Port }

func NewHandler(store Port) *Handler { return &Handler{store: store} }

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
			writeInvalidFilter(w, invalid)
		case errors.Is(err, ErrInvalidCursor):
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
		default:
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		}
		return
	}
	page, err := h.store.List(r.Context(), scope, q)
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
	counts, err := h.store.UnreadCount(r.Context(), scope)
	if err != nil {
		slog.Error("notifications unread count failed", "code_class", httpjson.CodeInternalError)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, counts)
}

// writeInvalidFilter writes 400 invalid_filter with fields[].
func writeInvalidFilter(w http.ResponseWriter, invalid *InvalidFilter) {
	httpjson.WriteInvalidFilterFields(w, validationFields(invalid.Fields))
}

func validationFields(fields []Field) []httpjson.ValidationField {
	out := make([]httpjson.ValidationField, len(fields))
	for i, f := range fields {
		out[i] = httpjson.ValidationField{Field: f.Field, Code: f.Code}
	}
	return out
}

// readBody reads the request body under MaxBodyBytes; over the cap is
// payload_too_large, any other read failure invalid_request.
func readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
		} else {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		}
		return nil, false
	}
	return raw, true
}

// writeBodyError maps a body parse failure: shape → invalid_request,
// semantic → validation_error with fields[].
func writeBodyError(w http.ResponseWriter, err error) {
	var invalid *InvalidBody
	if errors.As(err, &invalid) {
		httpjson.WriteValidationError(w, validationFields(invalid.Fields))
		return
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
}

// serveMark is the shared flow of read / unread / read-all: scope, body,
// strict parse, one store call. Not audited (D23).
func (h *Handler) serveMark(w http.ResponseWriter, r *http.Request, op string, run func(Scope, []byte) (MarkResult, error)) {
	scope, ok := scopeOf(r)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return
	}
	raw, ok := readBody(w, r)
	if !ok {
		return
	}
	result, err := run(scope, raw)
	if err != nil {
		var invalid *InvalidBody
		if errors.As(err, &invalid) || errors.Is(err, ErrInvalidRequest) {
			writeBodyError(w, err)
			return
		}
		slog.Error("notifications mark failed", "op", op, "code_class", httpjson.CodeInternalError)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, result)
}

// Read serves POST B/read: exactly one of group_keys / ids (D15, D26).
func (h *Handler) Read(w http.ResponseWriter, r *http.Request) {
	h.serveMark(w, r, "read", func(scope Scope, raw []byte) (MarkResult, error) {
		req, err := ParseMark(raw, false)
		if err != nil {
			return MarkResult{}, err
		}
		return h.store.Read(r.Context(), scope, req)
	})
}

// Unread serves POST B/unread: exactly one of group_keys / ids / marked_at
// (the undo of exactly one earlier mark, D15).
func (h *Handler) Unread(w http.ResponseWriter, r *http.Request) {
	h.serveMark(w, r, "unread", func(scope Scope, raw []byte) (MarkResult, error) {
		req, err := ParseMark(raw, true)
		if err != nil {
			return MarkResult{}, err
		}
		return h.store.Unread(r.Context(), scope, req)
	})
}

// ReadAll serves POST B/read-all: optional types / job_ids / before (D16).
func (h *Handler) ReadAll(w http.ResponseWriter, r *http.Request) {
	h.serveMark(w, r, "read_all", func(scope Scope, raw []byte) (MarkResult, error) {
		req, err := ParseReadAll(raw)
		if err != nil {
			return MarkResult{}, err
		}
		return h.store.ReadAll(r.Context(), scope, req)
	})
}

// Facets serves GET B/facets: group counts per type and job over state (D17).
func (h *Handler) Facets(w http.ResponseWriter, r *http.Request) {
	scope, ok := scopeOf(r)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return
	}
	state, err := ParseFacetsQuery(r.URL.Query())
	if err != nil {
		var invalid *InvalidFilter
		if errors.As(err, &invalid) {
			writeInvalidFilter(w, invalid)
		} else {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		}
		return
	}
	facets, err := h.store.Facets(r.Context(), scope, state)
	if err != nil {
		slog.Error("notifications facets failed", "code_class", httpjson.CodeInternalError)
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, facets)
}
