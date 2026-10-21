package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestLifecycleCatalogAndConflictData(t *testing.T) {
	if !reflect.DeepEqual(LifecycleErrorCodes(), []Code{CodeLifecycleTransitionInvalid, CodeVacancyUnavailable, CodeVacancyNotAcceptingApplications, CodeProcessFinished}) {
		t.Fatal(LifecycleErrorCodes())
	}
	for _, tc := range []struct {
		name   string
		def    Definition
		status int
		code   Code
		data   bool
	}{
		{"transition", Resolve(CodeLifecycleTransitionInvalid), 409, CodeLifecycleTransitionInvalid, true},
		{"baseline cannot gain data", Resolve(CodeConflict), 409, CodeConflict, false},
		{"forged status", Definition{Code: CodeLifecycleTransitionInvalid, Status: 200}, 500, CodeInternalError, false},
		{"unknown", Definition{Code: "unknown", Status: 409}, 500, CodeInternalError, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			WriteLifecycleError(response, tc.def, map[string]any{"action": "pause", "lifecycle": map[string]string{"publication": "closed"}})
			var body map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			_, hasData := body["data"]
			if response.Code != tc.status || body["code"] != string(tc.code) || hasData != tc.data {
				t.Fatalf("%d %s", response.Code, response.Body)
			}
		})
	}
}
