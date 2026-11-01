package httpjson

import (
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestSavedJobCatalogAndLimitData(t *testing.T) {
	if !reflect.DeepEqual(SavedJobErrorCodes(), []Code{CodeJobUnavailable, CodeSavedJobsLimit}) {
		t.Fatal(SavedJobErrorCodes())
	}
	for _, tc := range []struct {
		name   string
		def    Definition
		status int
		body   string
	}{
		{"unavailable", Resolve(CodeJobUnavailable), 409, `{"error":"job unavailable","code":"job_unavailable"}` + "\n"},
		{"limit", Resolve(CodeSavedJobsLimit), 409, `{"error":"saved jobs limit reached","code":"saved_jobs_limit","data":{"limit":200}}` + "\n"},
		{"baseline preserved", Resolve(CodeNotFound), 404, `{"error":"not found","code":"not_found"}` + "\n"},
		{"forged", Definition{Code: CodeSavedJobsLimit, Status: 200}, 500, `{"error":"an internal error occurred","code":"internal_error"}` + "\n"},
		{"unknown", Definition{Code: "unknown", Status: 409}, 500, `{"error":"an internal error occurred","code":"internal_error"}` + "\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteSavedJobError(w, tc.def)
			if w.Code != tc.status || w.Body.String() != tc.body {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}
