package httpjson

import (
	"net/http/httptest"
	"testing"
)

func TestPoolInvalidFilterFields(t *testing.T) {
	for _, tc := range []struct {
		name   string
		fields []ValidationField
		want   string
	}{
		{"one", []ValidationField{{Field: "years", Code: "invalid"}}, `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"years","code":"invalid"}]}`},
		{"nil", nil, `{"error":"invalid filter","code":"invalid_filter","fields":[]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteInvalidFilterFields(w, tc.fields)
			if w.Code != 400 || w.Body.String() != tc.want+"\n" {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}

func TestPoolCursorCatalogError(t *testing.T) {
	w := httptest.NewRecorder()
	WriteCatalogError(w, Resolve(Code("invalid_cursor")))
	if w.Code != 400 || w.Body.String() != `{"error":"invalid cursor","code":"invalid_cursor"}`+"\n" {
		t.Fatal(w.Code, w.Body.String())
	}
}

// GET /v2/jobs uses this generic catalog writer. The private list's fields
// extension must never change these existing bytes.
func TestPublicInvalidFilterCatalogBytesUnchanged(t *testing.T) {
	w := httptest.NewRecorder()
	WriteCatalogError(w, Resolve(CodeInvalidFilter))
	if w.Code != 400 || w.Body.String() != `{"error":"invalid filter","code":"invalid_filter"}`+"\n" {
		t.Fatal(w.Code, w.Body.String())
	}
}
