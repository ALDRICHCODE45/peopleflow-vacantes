package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestGeoErrorDetailsExactWire(t *testing.T) {
	for _, code := range []Code{CodeInvalidLocation, CodeInvalidRemoteScope} {
		t.Run(string(code), func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteGeoError(w, Resolve(code), []GeoDetail{{Field: "fields.location.state", Reason: "required"}})
			var body map[string]json.RawMessage
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != 422 || len(body) != 3 || string(body["code"]) != `"`+string(code)+`"` || string(body["details"]) != `[{"field":"fields.location.state","reason":"required"}]` {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
	w := httptest.NewRecorder()
	WriteGeoError(w, Resolve(CodeInternalError), []GeoDetail{{Field: "private", Reason: "private"}})
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 2 || w.Code != 500 {
		t.Fatal(w.Code, w.Body)
	}
}

func TestGeoErrors(t *testing.T) {
	for _, tc := range []struct {
		code   Code
		status int
	}{
		{CodeCountryNotFound, 404}, {CodeStateNotFound, 404}, {CodeInvalidPostalCode, 400}, {CodePostalCodeNotFound, 404}, {CodeInvalidLocation, 422}, {CodeInvalidRemoteScope, 422},
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
