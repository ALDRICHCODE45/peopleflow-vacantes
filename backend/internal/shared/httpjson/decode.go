package httpjson

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// DecodeJSON decodes exactly one JSON value from r.Body into dst, enforcing a
// request-body limit of limit bytes via http.MaxBytesReader. It never writes a
// response itself; on failure it returns the catalog Definition for the caller
// to write through a single encoding point, and nil when decoding succeeded.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any, limit int64) *Definition {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return decodeFailure(err)
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return decodeFailure(err)
	}
	return nil
}

// decodeFailure classifies a body error: a wrapped *http.MaxBytesError (found
// through errors.As) is payload_too_large; every other body failure — empty,
// malformed, or a trailing second JSON/non-whitespace value — is
// invalid_request.
func decodeFailure(err error) *Definition {
	var maxBytes *http.MaxBytesError
	code := CodeInvalidRequest
	if errors.As(err, &maxBytes) {
		code = CodePayloadTooLarge
	}
	def := Resolve(code)
	return &def
}
