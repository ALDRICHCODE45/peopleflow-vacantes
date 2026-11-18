package httpjson

import (
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestMetricsErrorCodes(t *testing.T) {
	if want := []Code{"metrics_export_too_large"}; !reflect.DeepEqual(MetricsErrorCodes(), want) {
		t.Fatal(MetricsErrorCodes())
	}
	def := Resolve(CodeMetricsExportTooLarge)
	if def.Code != CodeMetricsExportTooLarge || def.Status != 422 || def.Message != "metrics export too large" {
		t.Fatal(def)
	}
	list := MetricsErrorCodes()
	list[0] = "oops"
	if MetricsErrorCodes()[0] != CodeMetricsExportTooLarge {
		t.Fatal("mutable list")
	}
}

// Same body shape as audit_export_too_large (stakeholder-metrics-v2 §8).
func TestMetricsExportTooLargeEnvelope(t *testing.T) {
	w := httptest.NewRecorder()
	WriteMetricsExportTooLarge(w, 50001, 50000)
	want := `{"error":"metrics export too large","code":"metrics_export_too_large","row_count":50001,"limit":50000}` + "\n"
	if w.Code != 422 || w.Body.String() != want {
		t.Fatal(w.Code, w.Body.String())
	}
}
