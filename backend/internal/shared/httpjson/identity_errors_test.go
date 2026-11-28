package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestIdentityErrorCatalog(t *testing.T) {
	codes := IdentityErrorCodes()
	statuses := []int{403, 403, 409, 409, 422, 503}
	names := []Code{"account_required", "wrong_role", "account_exists", "email_in_use", "email_not_verified", "identity_unavailable"}
	// embedded-auth-v1 D5: role-neutral texts; codes and statuses unchanged.
	messages := []string{"account required", "account role not allowed", "account already exists", "email already in use", "email not verified", "identity unavailable"}
	if len(codes) != len(names) {
		t.Fatal("catalog size")
	}
	for i, code := range codes {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			if code != names[i] || def.Code != code || def.Status != statuses[i] || def.Message != messages[i] {
				t.Fatalf("wrong definition: %+v", def)
			}
			w := httptest.NewRecorder()
			WriteCatalogError(w, def)
			var body map[string]any
			if json.Unmarshal(w.Body.Bytes(), &body) != nil || len(body) != 2 || body["code"] != string(code) || body["error"] != def.Message || w.Code != def.Status {
				t.Fatal("wrong envelope")
			}
		})
	}
	codes[0] = CodeInternalError
	if IdentityErrorCodes()[0] != CodeAccountRequired {
		t.Fatal("mutable catalog")
	}
}
