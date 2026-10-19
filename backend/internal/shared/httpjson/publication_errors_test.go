package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestPublicationErrorCatalog(t *testing.T) {
	for _, tc := range []struct {
		code   Code
		status int
	}{{CodePublicationIncomplete, 422}, {CodeAlreadyPublished, 409}} {
		t.Run(string(tc.code), func(t *testing.T) {
			def := Resolve(tc.code)
			if def.Code != tc.code || def.Status != tc.status || def.Message == "" {
				t.Fatalf("%+v", def)
			}
		})
	}
	codes := PublicationErrorCodes()
	codes[0] = "changed"
	if reflect.DeepEqual(codes, PublicationErrorCodes()) {
		t.Fatal("shared backing slice")
	}
}
func TestPublicationMissingOnlyForIncomplete(t *testing.T) {
	for _, tc := range []struct {
		name         string
		def          Definition
		keys, status int
		code         Code
	}{
		{"incomplete", Resolve(CodePublicationIncomplete), 3, 422, CodePublicationIncomplete},
		{"already", Resolve(CodeAlreadyPublished), 2, 409, CodeAlreadyPublished},
		{"baseline", Resolve(CodeInvalidRequest), 2, 400, CodeInvalidRequest},
		{"unknown", Definition{Code: "unknown", Status: 422}, 2, 500, CodeInternalError},
		{"forged status", Definition{Code: CodePublicationIncomplete, Status: 409}, 2, 500, CodeInternalError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRecorder()
			WritePublicationError(r, tc.def, []string{"title_missing", "commitment_date_past"})
			var obj map[string]any
			if err := json.Unmarshal(r.Body.Bytes(), &obj); err != nil {
				t.Fatal(err)
			}
			if r.Code != tc.status || len(obj) != tc.keys || obj["code"] != string(tc.code) || obj["error"] == "" {
				t.Fatalf("%d %s", r.Code, r.Body.String())
			}
			if tc.keys == 3 && !reflect.DeepEqual(obj["missing"], []any{"title_missing", "commitment_date_past"}) {
				t.Fatal(obj)
			}
		})
	}
	r := httptest.NewRecorder()
	WritePublicationError(r, Resolve(CodePublicationIncomplete), nil)
	var obj map[string]any
	_ = json.Unmarshal(r.Body.Bytes(), &obj)
	if !reflect.DeepEqual(obj["missing"], []any{}) {
		t.Fatalf("nil must be []: %s", r.Body.String())
	}
}
