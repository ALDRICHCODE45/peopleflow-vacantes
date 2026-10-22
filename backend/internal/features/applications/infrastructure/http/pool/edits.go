package pool

import (
	"errors"
	"io"
	"net/http"
	"strings"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

func editError(w http.ResponseWriter, err error) {
	var validation *board.ManualValidationError
	switch {
	case errors.As(err, &validation):
		fields := make([]httpjson.ValidationField, 0, len(validation.Fields))
		for _, f := range validation.Fields {
			fields = append(fields, httpjson.ValidationField{Field: f.Field, Code: f.Code})
		}
		httpjson.WriteValidationError(w, fields)
	case errors.Is(err, board.ErrInvalidRequest):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
	case errors.Is(err, app.ErrPreconditionFailed):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePreconditionFailed))
	case errors.Is(err, app.ErrInvalidCursor):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
	default:
		detailError(w, err)
	}
}
func (h *Handler) Edit(w http.ResponseWriter, r *http.Request) {
	cc, kind, id, ok := detailParams(w, r)
	if !ok {
		return
	}
	match := strings.TrimSpace(r.Header.Get("If-Match"))
	if match == "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePreconditionRequired))
		return
	}
	// No wildcard, weak ETag or tag list matches the single strong current token.
	// The store compares the exact token while holding the row lock.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 128*1024))
	if err != nil {
		editError(w, board.ErrInvalidRequest)
		return
	}
	out, err := h.service.Edit(r.Context(), cc.CompanyID, cc.UserID, kind, id, match, body)
	if err != nil {
		editError(w, err)
		return
	}
	w.Header().Set("ETag", out.ETag)
	httpjson.WriteJSON(w, http.StatusOK, out)
}
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	cc, kind, id, ok := detailParams(w, r)
	if !ok {
		return
	}
	out, err := h.service.History(r.Context(), cc.CompanyID, kind, id, r.URL.RawQuery)
	if err != nil {
		editError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}
