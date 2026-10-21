package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestWriteValidationErrorFields(t *testing.T) {
	w := httptest.NewRecorder()
	WriteValidationError(w, []ValidationField{{Field: "contact", Code: "required"}})
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if w.Code != 400 || len(got) != 3 || got["code"] != "validation_error" || got["error"] != Resolve(CodeValidationError).Message {
		t.Fatal(w.Code, got)
	}
	fields := got["fields"].([]any)
	field := fields[0].(map[string]any)
	if len(fields) != 1 || len(field) != 2 || field["field"] != "contact" || field["code"] != "required" {
		t.Fatal(got)
	}
}
