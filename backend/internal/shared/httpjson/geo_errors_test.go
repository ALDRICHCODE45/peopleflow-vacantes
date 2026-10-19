package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestGeoErrors(t *testing.T) {
	for _, tc := range []struct {
		code   Code
		status int
	}{
		{CodeCountryNotFound, 404}, {CodeStateNotFound, 404}, {CodeInvalidPostalCode, 400}, {CodePostalCodeNotFound, 404}, {CodeInvalidLocation, 422},
	} {
		t.Run(string(tc.code), func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteCatalogError(w, Resolve(tc.code))
			var env ErrorEnvelope
			if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
				t.Fatal(err)
			}
			if w.Code != tc.status || env.Code != tc.code {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
}
