package board

import (
	"errors"
	"io"
	"net/http"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

func (h *Handler) DuplicatesCheck(w http.ResponseWriter, r *http.Request) {
	cc, id, _, ok := h.params(w, r, false)
	if !ok {
		return
	}
	store, ok := h.store.(app.DuplicateStore)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1048576))
	if err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
		} else {
			writeError(w, app.ErrInvalidRequest)
		}
		return
	}
	out, err := store.DuplicatesCheck(r.Context(), cc.CompanyID, cc.UserID, id, body)
	if err != nil {
		var validation *app.ManualValidationError
		if errors.As(err, &validation) {
			fields := make([]httpjson.ValidationField, len(validation.Fields))
			for i, f := range validation.Fields {
				fields[i] = httpjson.ValidationField{Field: f.Field, Code: f.Code}
			}
			httpjson.WriteValidationError(w, fields)
		} else {
			writeError(w, err)
		}
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}
