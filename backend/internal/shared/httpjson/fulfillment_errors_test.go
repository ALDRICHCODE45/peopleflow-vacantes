package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestFulfillmentErrorsAreAdditiveAndExact(t *testing.T) {
	for _, code := range []Code{"delivery_fulfilled", "fulfillment_confirmation_required"} {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			if def.Code != code || def.Status != 409 {
				t.Fatalf("unregistered code: %+v", def)
			}
			w := httptest.NewRecorder()
			WriteCatalogError(w, def)
			var body map[string]json.RawMessage
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != 409 || len(body) != 2 || string(body["code"]) != `"`+string(code)+`"` {
				t.Fatal(w.Code, w.Body.String())
			}
			for _, base := range ListCodes() {
				if base == code {
					t.Fatal("baseline catalog changed")
				}
			}
		})
	}
}
