package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestPipelineErrors_ExtensionListIsIndependentAndDefensive(t *testing.T) {
	want := []Code{CodeNonBusinessDate, CodeCutoffStageInUse}
	got := PipelineErrorCodes()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("codes=%v", got)
	}
	got[0] = CodeInternalError
	if !reflect.DeepEqual(PipelineErrorCodes(), want) {
		t.Fatal("mutable extension list")
	}
	for _, code := range want {
		for _, baseline := range ListCodes() {
			if baseline == code {
				t.Fatal("changed pinned baseline")
			}
		}
	}
}

func TestPipelineErrors_CatalogEnvelopeAndRecordedCode(t *testing.T) {
	for _, tc := range []struct {
		code    Code
		status  int
		message string
	}{{Code("non_business_date"), 400, "commitment date is not a business day"}, {Code("cutoff_stage_in_use"), 409, "cutoff stage is in use"}} {
		t.Run(string(tc.code), func(t *testing.T) {
			def := Resolve(tc.code)
			if def.Code != tc.code || def.Status != tc.status || def.Message != tc.message {
				t.Fatalf("definition=%+v", def)
			}
			for _, data := range []bool{false, true} {
				rec := &codeRecorder{ResponseRecorder: httptest.NewRecorder()}
				if data {
					WriteCatalogErrorData(rec, def, map[string]string{"stageId": "must not leak"})
				} else {
					WriteCatalogError(rec, def)
				}
				var obj map[string]any
				if err := json.Unmarshal(rec.Body.Bytes(), &obj); err != nil {
					t.Fatal(err)
				}
				if rec.Code != tc.status || rec.code != string(tc.code) || len(obj) != 2 || obj["code"] != string(tc.code) || obj["error"] != tc.message {
					t.Fatalf("response=%d %s recorded=%s", rec.Code, rec.Body, rec.code)
				}
			}
		})
	}
}
