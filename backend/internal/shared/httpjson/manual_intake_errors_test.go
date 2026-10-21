package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestManualIntakeCatalogAndData(t *testing.T) {
	for _, code := range ManualIntakeErrorCodes() {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			if def.Code != code || def.Status != 409 {
				t.Fatal(def)
			}
			w := httptest.NewRecorder()
			WriteManualIntakeError(w, code, map[string]string{"safe": "value"})
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != 409 || body["code"] != string(code) || body["data"] == nil || len(body) != 3 {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
	w := httptest.NewRecorder()
	WriteManualIntakeError(w, CodeForbidden, map[string]string{"secret": "must not escape"})
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 403 || body["data"] != nil {
		t.Fatal(w.Code, w.Body.String())
	}
}
