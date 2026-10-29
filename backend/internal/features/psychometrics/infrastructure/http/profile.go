package http

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/profile"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	store        profile.Store
	contextError func(http.ResponseWriter, error)
}

func NewHandler(store profile.Store, contextError func(http.ResponseWriter, error)) *Handler {
	return &Handler{store: store, contextError: contextError}
}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) { h.serve(w, r, false) }
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) { h.serve(w, r, true) }
func (h *Handler) serve(w http.ResponseWriter, r *http.Request, write bool) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	if h == nil || h.store == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	var result profile.Result
	if write {
		body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, profile.MaxBodyBytes))
		if e != nil {
			code := httpjson.CodeInvalidRequest
			var max *http.MaxBytesError
			if errors.As(e, &max) {
				code = httpjson.CodePayloadTooLarge
			}
			httpjson.WriteCatalogError(w, httpjson.Resolve(code))
			return
		}
		values := r.Header.Values("If-Match")
		result, err = h.store.PutProfile(r.Context(), cc.CompanyID, cc.UserID, id, strings.Join(values, ","), len(values) > 0, body)
	} else {
		result, err = h.store.GetProfile(r.Context(), cc.CompanyID, cc.UserID, id)
	}
	if err != nil {
		var invalid *profile.Invalid
		switch {
		case errors.As(err, &invalid):
			httpjson.WriteValidationError(w, invalid.Fields)
		case errors.Is(err, profile.ErrInvalidRequest):
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		default:
			if h.contextError != nil {
				h.contextError(w, err)
			} else {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
			}
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", result.ETag)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result.Body)
}
