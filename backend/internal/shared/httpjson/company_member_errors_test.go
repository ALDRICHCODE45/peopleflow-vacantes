package httpjson

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompanyMemberLastOwnerCatalog(t *testing.T) {
	def := Resolve(CodeLastOwner)
	if def.Status != http.StatusConflict || def.Code != CodeLastOwner || def.Message != "company must retain at least one owner" {
		t.Fatalf("definition = %+v", def)
	}
	recorder := httptest.NewRecorder()
	WriteCatalogError(recorder, def)
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != 409 || len(body) != 2 || body["code"] != string(CodeLastOwner) || body["error"] != def.Message {
		t.Fatalf("response = %d %s", recorder.Code, recorder.Body.String())
	}
	codes := CompanyMemberErrorCodes()
	if len(codes) != 1 || codes[0] != CodeLastOwner {
		t.Fatalf("codes = %v", codes)
	}
	codes[0] = CodeInternalError
	if CompanyMemberErrorCodes()[0] != CodeLastOwner {
		t.Fatal("catalog list was mutated")
	}
}
