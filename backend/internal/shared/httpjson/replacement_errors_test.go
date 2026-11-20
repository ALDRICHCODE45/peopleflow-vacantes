package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestReplacementCatalogAndEnvelope(t *testing.T) {
	if want := []Code{"reopen_requires_replacement", "replacement_already_active", "reopen_superseded"}; !reflect.DeepEqual(ReplacementErrorCodes(), want) {
		t.Fatal(ReplacementErrorCodes())
	}
	ReplacementErrorCodes()[0] = "mutated"
	if ReplacementErrorCodes()[0] != CodeReopenRequiresReplacement {
		t.Fatal("the code list must be a fresh slice")
	}
	for _, code := range ReplacementErrorCodes() {
		def := Resolve(code)
		if def.Code != code || def.Status != 409 || def.Message == "" {
			t.Fatalf("%s resolves to %+v", code, def)
		}
		response := httptest.NewRecorder()
		WriteLifecycleError(response, def, map[string]any{"lifecycle": map[string]string{"publication": "closed"}})
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		data, _ := body["data"].(map[string]any)
		if response.Code != 409 || body["code"] != string(code) || data["lifecycle"] == nil {
			t.Fatalf("%s: %d %s", code, response.Code, response.Body)
		}
	}
	// The generic writer still strips data from replacement codes: only the lifecycle seam carries it.
	response := httptest.NewRecorder()
	WriteCatalogErrorData(response, Resolve(CodeReplacementAlreadyActive), map[string]any{"leak": true})
	var generic map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &generic); err != nil {
		t.Fatal(err)
	}
	if _, has := generic["data"]; has {
		t.Fatalf("data leaked through the generic writer: %s", response.Body)
	}
	// A forged status is not accepted.
	forged := httptest.NewRecorder()
	WriteLifecycleError(forged, Definition{Code: CodeReopenSuperseded, Status: 200}, map[string]any{})
	if forged.Code != 500 {
		t.Fatalf("forged status accepted: %d", forged.Code)
	}
}
