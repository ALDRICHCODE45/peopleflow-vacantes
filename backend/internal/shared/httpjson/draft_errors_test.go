package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestDraftErrorCatalog(t *testing.T) {
	for _, tc := range []struct {
		code   Code
		status int
	}{
		{"validation_error", 400}, {"empty_patch", 400}, {"idempotency_key_required", 400},
		{"invalid_idempotency_key", 400}, {"idempotency_conflict", 409},
		{"version_conflict", 412}, {"precondition_required", 428},
	} {
		t.Run(string(tc.code), func(t *testing.T) {
			def := Resolve(tc.code)
			if def.Code != tc.code || def.Status != tc.status {
				t.Fatalf("Resolve(%s)=%+v", tc.code, def)
			}
			w := httptest.NewRecorder()
			WriteCatalogErrorData(w, def, map[string]string{"secret": "must not escape"})
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != tc.status || body["code"] != string(tc.code) {
				t.Fatalf("response=%d %s", w.Code, w.Body.String())
			}
			if _, ok := body["data"]; ok {
				t.Fatalf("private error leaked data: %s", w.Body.String())
			}
		})
	}
}
