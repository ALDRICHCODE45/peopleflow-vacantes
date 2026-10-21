package board

import (
	"errors"
	"net/http"
	"strconv"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

func (h *Handler) CreateManual(w http.ResponseWriter, r *http.Request) {
	cc, id, _, ok := h.params(w, r, false)
	if !ok {
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
	input, err := readManualMultipart(w, r)
	if err != nil {
		writeManualError(w, err)
		return
	}
	store, ok := h.store.(app.ManualCreateStore)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	out, err := store.CreateManual(r.Context(), cc.CompanyID, cc.UserID, id, app.ManualInput{Data: input.Data, CV: input.CV, FileName: input.Filename, IdempotencyKey: key}, h.inspector, h.storage)
	if err != nil {
		writeManualError(w, err)
		return
	}
	w.Header().Set("ETag", out.ETag)
	w.Header().Set("Idempotency-Replayed", strconv.FormatBool(out.Replayed))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write(out.Body)
}

func writeManualError(w http.ResponseWriter, err error) {
	var validation *app.ManualValidationError
	var duplicates *app.PossibleDuplicates
	var already *app.CandidateAlreadyInProcess
	var code httpjson.Code
	switch {
	case errors.As(err, &validation):
		fields := make([]httpjson.ValidationField, len(validation.Fields))
		for i, f := range validation.Fields {
			fields[i] = httpjson.ValidationField{Field: f.Field, Code: f.Code}
		}
		httpjson.WriteValidationError(w, fields)
		return
	case errors.As(err, &duplicates):
		httpjson.WriteManualIntakeError(w, httpjson.CodePossibleDuplicates, duplicates)
		return
	case errors.As(err, &already):
		httpjson.WriteManualIntakeError(w, httpjson.CodeCandidateAlreadyInProcess, already)
		return
	case errors.Is(err, app.ErrManualIdempotencyConflict):
		code = httpjson.CodeIdempotencyConflict
	case errors.Is(err, app.ErrManualCVContentMismatch):
		code = httpjson.CodeCVContentMismatch
	case errors.Is(err, app.ErrManualCVUnsupportedType):
		code = httpjson.CodeCVUnsupportedType
	case errors.Is(err, app.ErrManualCVTooLarge), errors.Is(err, errManualCVTooLarge):
		code = httpjson.CodeCVTooLarge
	default:
		writeError(w, err)
		return
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
