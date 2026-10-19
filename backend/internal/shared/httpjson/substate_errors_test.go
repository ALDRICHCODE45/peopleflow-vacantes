package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// Keep the baseline catalog and all unrelated envelopes unchanged.
func TestSubstateCatalogCodesAndBoundedDetails(t *testing.T) {
	for _, code := range SubstateErrorCodes() {
		if def := Resolve(code); def.Code != code || def.Status != 409 {
			t.Fatal(def)
		}
	}
	for _, tc := range []struct {
		name    string
		def     Definition
		want    int
		details bool
	}{
		{"in use", Resolve(CodeSubstateInUse), 409, true},
		{"requires stage", Resolve(CodeSubstateRequiresInProcess), 409, false},
		{"unrelated", Resolve(CodeInvalidRequest), 400, false},
		{"forged", Definition{Code: CodeSubstateInUse, Status: 400}, 500, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			WriteSubstateError(rec, tc.def, []SubstateDetail{{SubstateID: "one"}, {SubstateID: "two"}})
			var obj map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &obj); err != nil {
				t.Fatal(err)
			}
			_, has := obj["details"]
			if rec.Code != tc.want || has != tc.details {
				t.Fatal(rec.Code, obj)
			}
			if has {
				list := obj["details"].([]any)
				if len(obj) != 3 || len(list) != 2 || len(list[0].(map[string]any)) != 1 || list[0].(map[string]any)["substate_id"] != "one" {
					t.Fatal(obj)
				}
			} else if len(obj) != 2 {
				t.Fatal(obj)
			}
		})
	}
	rec := httptest.NewRecorder()
	WriteSubstateError(rec, Resolve(CodeSubstateInUse), nil)
	var obj map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &obj)
	if list, ok := obj["details"].([]any); !ok || len(list) != 0 {
		t.Fatal(obj)
	}
}
