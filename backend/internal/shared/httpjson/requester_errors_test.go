package httpjson

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type codeRecorder struct {
	*httptest.ResponseRecorder
	code string
}

func (r *codeRecorder) RecordCatalogCode(code string) { r.code = code }

// The requester duplicate is a dedicated typed projection: it always carries
// data.existing and does not go through the generic data-stripping writer.
func TestWriteRequesterAlreadyExists(t *testing.T) {
	rec := &codeRecorder{ResponseRecorder: httptest.NewRecorder()}
	WriteRequesterAlreadyExists(rec, RequesterRef{ID: "44444444-4444-4444-4444-444444444444", Kind: "client", Name: "Área"})

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	want := `{"error":"requester already exists","code":"requester_already_exists","data":{"existing":{"id":"44444444-4444-4444-4444-444444444444","kind":"client","name":"Área"}}}`
	if got := strings.TrimSpace(rec.Body.String()); got != want {
		t.Errorf("body = %s\nwant   %s", got, want)
	}
	if rec.code != "requester_already_exists" {
		t.Errorf("recorded code = %q", rec.code)
	}
}

// The generic writer must keep stripping data for this code.
func TestWriteCatalogErrorData_StripsRequesterData(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteCatalogErrorData(rec, Resolve(CodeRequesterAlreadyExists), map[string]string{"leak": "x"})
	if strings.Contains(rec.Body.String(), "leak") {
		t.Errorf("generic writer leaked data: %s", rec.Body)
	}
}
