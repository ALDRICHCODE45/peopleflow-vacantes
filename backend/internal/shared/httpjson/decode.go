package httpjson

import "net/http"

// DecodeJSON decodes exactly one JSON value from r.Body into dst, enforcing a
// request-body limit of limit bytes. It never writes a response itself; on
// failure it returns the catalog Definition for the caller to write through a
// single encoding point, and nil when decoding succeeded.
//
// RED scaffold (task 6.2): this stub deliberately rejects every request with
// the canonical invalid_request definition. GREEN implements the real
// http.MaxBytesReader wrapping, single-value + trailing-EOF decoding, and
// wrapped *http.MaxBytesError classification to payload_too_large.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any, limit int64) *Definition {
	_, _, _, _ = w, r, dst, limit
	def := Resolve(CodeInvalidRequest)
	return &def
}
