package httpjson

import (
	"fmt"
	"net/http/httptest"
	"testing"
)

func TestPsychometricErrorExtension(t *testing.T) {
	messages := []string{"psychometric profile disabled", "psychometric assessment already finished", "participation inactive", "psychometric invitation closed", "psychometric assessment unavailable", "psychometric consent required", "psychometric notice changed", "psychometric assessment finished"}
	statuses := []int{409, 409, 409, 409, 404, 403, 409, 409}
	codes := PsychometricErrorCodes()
	if len(codes) != len(messages) {
		t.Fatal(codes)
	}
	for i, code := range codes {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			w := httptest.NewRecorder()
			WriteCatalogError(w, def)
			if def.Code != code || w.Code != statuses[i] || w.Body.String() != fmt.Sprintf("{\"error\":%q,\"code\":%q}\n", messages[i], code) {
				t.Fatal(def, w.Code, w.Body.String())
			}
			for _, base := range ListCodes() {
				if base == code {
					t.Fatal("baseline changed")
				}
			}
		})
	}
	// Extending Resolve preserves both existing catalog entries and fail-closed unknowns.
	for _, tc := range []struct {
		code   Code
		status int
		body   string
	}{
		{CodeInvalidRequest, 400, "{\"error\":\"invalid request\",\"code\":\"invalid_request\"}\n"},
		{Code("psychometric_unknown"), 500, "{\"error\":\"an internal error occurred\",\"code\":\"internal_error\"}\n"},
	} {
		w := httptest.NewRecorder()
		WriteCatalogError(w, Resolve(tc.code))
		if w.Code != tc.status || w.Body.String() != tc.body {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
