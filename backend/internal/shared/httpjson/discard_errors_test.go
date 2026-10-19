package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestDiscardErrorExtension(t *testing.T) {
	for _, code := range DiscardErrorCodes() {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			if def.Status != 409 || def.Code != code {
				t.Fatal(def)
			}
			w := httptest.NewRecorder()
			WriteCatalogError(w, def)
			var obj map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &obj); err != nil {
				t.Fatal(err)
			}
			if w.Code != 409 || len(obj) != 2 || obj["code"] != string(code) {
				t.Fatal(w.Code, w.Body.String())
			}
			for _, baseline := range ListCodes() {
				if baseline == code {
					t.Fatal("extension changed baseline")
				}
			}
		})
	}
	if len(DiscardErrorCodes()) != 3 {
		t.Fatal(DiscardErrorCodes())
	}
}
