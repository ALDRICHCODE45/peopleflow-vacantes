package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestApplicantCountryErrorWire(t *testing.T) {
	for _, code := range []Code{CodeApplicantCountryRequired, CodeApplicantCountryNotAllowed, CodeCVUnavailable} {
		t.Run(string(code), func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteApplicantCountryError(w, Resolve(code), []string{"CO", "MX"})
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != 422 || body["code"] != string(code) {
				t.Fatal(w.Code, body)
			}
			want := map[string]any{"error": Resolve(code).Message, "code": string(code)}
			if code != CodeCVUnavailable {
				want["data"] = map[string]any{"allowed": []any{"CO", "MX"}}
			}
			if !reflect.DeepEqual(body, want) {
				t.Fatal(body)
			}
		})
	}
	w := httptest.NewRecorder()
	WriteApplicantCountryError(w, Resolve(CodeApplicantCountryRequired), nil)
	if w.Body.String() != "{\"error\":\"applicant country required\",\"code\":\"applicant_country_required\",\"data\":{\"allowed\":[]}}\n" {
		t.Fatal(w.Body.String())
	}
}

func TestApplicantCountryCatalog(t *testing.T) {
	for _, code := range []Code{"applicant_country_required", "applicant_country_not_allowed"} {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			if def.Status != 422 || def.Code != code {
				t.Fatalf("definition: %#v", def)
			}
		})
	}
}
