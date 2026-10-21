package http

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

func writeFieldError(w http.ResponseWriter, err error) bool {
	if errors.Is(err, usecases.ErrUnknownField) {
		writeDecodeFailure(w, definition(httpjson.CodeInvalidRequest))
		return true
	}
	var invalid *usecases.ValidationError
	if !errors.As(err, &invalid) {
		return false
	}
	fields := make([]httpjson.ValidationField, 0, len(invalid.Fields))
	for _, f := range invalid.Fields {
		fields = append(fields, httpjson.ValidationField{Field: f.Field, Code: f.Code})
	}
	httpjson.WriteValidationError(w, fields)
	return true
}
func definition(code httpjson.Code) *httpjson.Definition { d := httpjson.Resolve(code); return &d }

// Strictness is local to these replacement endpoints; other shared-decoder
// consumers retain their existing handling of unknown keys.
func (r *upsertProfileRequest) UnmarshalJSON(raw []byte) error {
	type request upsertProfileRequest
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode((*request)(r))
}
func (r *replaceLanguagesRequest) UnmarshalJSON(raw []byte) error {
	type request replaceLanguagesRequest
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode((*request)(r))
}
