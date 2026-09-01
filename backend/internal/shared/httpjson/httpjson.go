// Package httpjson provides minimal JSON response helpers shared across
// feature HTTP adapters. It is plumbing, not business logic.
package httpjson

import (
	"encoding/json"
	"net/http"
)

// WriteJSON serializes v as JSON with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
