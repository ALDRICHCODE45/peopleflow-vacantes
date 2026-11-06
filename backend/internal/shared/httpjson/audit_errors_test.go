package httpjson

import (
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestAuditErrorCodes(t *testing.T) {
	if want := []Code{"audit_export_too_large"}; !reflect.DeepEqual(AuditErrorCodes(), want) {
		t.Fatal(AuditErrorCodes())
	}
	def := Resolve(CodeAuditExportTooLarge)
	if def.Code != CodeAuditExportTooLarge || def.Status != 422 || def.Message != "audit export too large" {
		t.Fatal(def)
	}
	list := AuditErrorCodes()
	list[0] = "oops"
	if AuditErrorCodes()[0] != CodeAuditExportTooLarge {
		t.Fatal("mutable list")
	}
}

// The audit screen's invalid_filter is a 422 with fields; the pool list (400)
// and the public jobs catalog envelope keep their bytes.
func TestAuditInvalidFilterEnvelope(t *testing.T) {
	for _, tc := range []struct {
		name   string
		fields []ValidationField
		want   string
	}{
		{"fields", []ValidationField{{Field: "from", Code: "required"}, {Field: "to", Code: "range"}}, `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"from","code":"required"},{"field":"to","code":"range"}]}`},
		{"nil", nil, `{"error":"invalid filter","code":"invalid_filter","fields":[]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteAuditInvalidFilter(w, tc.fields)
			if w.Code != 422 || w.Body.String() != tc.want+"\n" {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
	if def := Resolve(CodeInvalidFilter); def.Status != 400 {
		t.Fatalf("shared invalid_filter status changed: %d", def.Status)
	}
}

func TestAuditExportTooLargeEnvelope(t *testing.T) {
	w := httptest.NewRecorder()
	WriteAuditExportTooLarge(w, 61234, 50000)
	want := `{"error":"audit export too large","code":"audit_export_too_large","row_count":61234,"limit":50000}` + "\n"
	if w.Code != 422 || w.Body.String() != want {
		t.Fatal(w.Code, w.Body.String())
	}
}
