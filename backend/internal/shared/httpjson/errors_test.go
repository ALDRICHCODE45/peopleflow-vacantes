package httpjson

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCatalogVersion(t *testing.T) {
	if ErrorCatalogVersion != 1 {
		t.Errorf("ErrorCatalogVersion=%d, want 1", ErrorCatalogVersion)
	}
}

func TestResolve_KnownCodes(t *testing.T) {
	cases := []struct {
		code       Code
		wantStatus int
		wantMsg    string
	}{
		{CodeInvalidRequest, http.StatusBadRequest, "invalid request"},
		{CodeInvalidStatusTransition, http.StatusBadRequest, "invalid status transition"},
		{CodeUnauthenticated, http.StatusUnauthorized, "unauthenticated"},
		{CodeForbidden, http.StatusForbidden, "forbidden"},
		{CodeCompanyInactive, http.StatusForbidden, "company is inactive"},
		{CodeNotFound, http.StatusNotFound, "not found"},
		{CodeConflict, http.StatusConflict, "resource conflict"},
		{CodeCompanyNotActive, http.StatusConflict, "company is not active"},
		{CodeIndustryUnavailable, http.StatusConflict, "industry unavailable"},
		{CodePayloadTooLarge, http.StatusRequestEntityTooLarge, "payload too large"},
		{CodeInternalError, http.StatusInternalServerError, "an internal error occurred"},
		{CodeAlreadyExists, http.StatusConflict, "resource already exists"},
		{CodeMethodNotAllowed, http.StatusMethodNotAllowed, "method not allowed"},
		{CodeServiceUnavailable, http.StatusServiceUnavailable, "service unavailable"},
	}
	for _, tt := range cases {
		t.Run(string(tt.code), func(t *testing.T) {
			def := Resolve(tt.code)
			if def.Status != tt.wantStatus || def.Code != tt.code || def.Message != tt.wantMsg {
				t.Errorf("got {Status:%d,Code:%q,Message:%q}, want {Status:%d,Code:%q,Message:%q}",
					def.Status, def.Code, def.Message, tt.wantStatus, tt.code, tt.wantMsg)
			}
		})
	}
}

func TestResolve_UnknownCode(t *testing.T) {
	def := Resolve(Code("does_not_exist"))
	if def.Status != http.StatusInternalServerError || def.Code != CodeInternalError {
		t.Errorf("unknown→got {Status:%d,Code:%q}, want {500,internal_error}", def.Status, def.Code)
	}
}

func TestListCodes_CanonicalOrder(t *testing.T) {
	// Canonical V1 order per backend-runtime spec / design §4: internal_error is last.
	// The catalog has exactly 14 codes; already_exists precedes payload limits,
	// method_not_allowed and service_unavailable follow it, and internal_error closes the list.
	want := []Code{
		CodeInvalidRequest, CodeInvalidStatusTransition, CodeUnauthenticated,
		CodeForbidden, CodeCompanyInactive, CodeNotFound, CodeConflict,
		CodeCompanyNotActive, CodeIndustryUnavailable, CodeAlreadyExists,
		CodePayloadTooLarge, CodeMethodNotAllowed, CodeServiceUnavailable,
		CodeInternalError,
	}
	got := ListCodes()
	if len(got) != len(want) {
		t.Fatalf("len=%d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("ListCodes[%d]=%q, want %q", i, got[i], want[i])
		}
	}
}

func TestMutationIsolation(t *testing.T) {
	// ListCodes returns fresh slice each call.
	first := ListCodes()
	first[0] = Code("mutated")
	if ListCodes()[0] == Code("mutated") {
		t.Error("ListCodes slice mutated across calls")
	}
	// Resolve returns immutable Definition copies.
	def1 := Resolve(CodeForbidden)
	orig := def1.Message
	def1.Message = "tampered"
	if Resolve(CodeForbidden).Message == "tampered" || Resolve(CodeForbidden).Message != orig {
		t.Errorf("Resolve returned mutable Definition")
	}
}

func TestWriteCatalogError(t *testing.T) {
	for _, code := range []Code{CodeNotFound, CodeForbidden, CodeConflict} {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			w := httptest.NewRecorder()
			WriteCatalogError(w, def)
			if w.Code != def.Status {
				t.Errorf("status=%d, want %d", w.Code, def.Status)
			}
			var env ErrorEnvelope
			if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
				t.Fatalf("body not JSON: %v", err)
			}
			if env.Code != code || env.Error != def.Message || env.Data != nil {
				t.Errorf("got {Code:%q,Error:%q,Data:%v}, want {Code:%q,Error:%q,Data:nil}",
					env.Code, env.Error, env.Data, code, def.Message)
			}
		})
	}
}

func TestWriteCatalogErrorData(t *testing.T) {
	// conflict carries data; non-conflict omits it.
	conflictDef := Resolve(CodeConflict)
	w := httptest.NewRecorder()
	WriteCatalogErrorData(w, conflictDef, map[string]string{"id": "42"})
	if w.Code != http.StatusConflict {
		t.Errorf("conflict status=%d, want 409", w.Code)
	}
	var env ErrorEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if env.Data == nil {
		t.Error("conflict: data is nil, want non-nil")
	}
	notFoundDef := Resolve(CodeNotFound)
	w = httptest.NewRecorder()
	WriteCatalogErrorData(w, notFoundDef, map[string]string{"id": "42"})
	var check struct {
		Error string `json:"error"`
		Code  string `json:"code"`
		Data  any    `json:"data,omitempty"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &check); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if check.Data != nil {
		t.Errorf("not_found: data=%v, want absent", check.Data)
	}
}

func TestWriteCatalogError_InvalidDefinition(t *testing.T) {
	defs := []Definition{
		{Code: Code("bad"), Status: 0, Message: "ignored"},
		{Code: Code("bad"), Status: http.StatusTeapot, Message: "ignored"},
		{Code: CodeForbidden, Status: http.StatusInternalServerError, Message: "ignored"},
		{Code: CodeInternalError, Status: http.StatusInternalServerError, Message: "leaked detail"},
	}
	writers := []func(http.ResponseWriter, Definition){
		WriteCatalogError,
		func(w http.ResponseWriter, def Definition) {
			WriteCatalogErrorData(w, def, map[string]string{"secret": "x"})
		},
	}
	for _, def := range defs {
		for _, write := range writers {
			w := httptest.NewRecorder()
			write(w, def)
			var env ErrorEnvelope
			if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
				t.Fatalf("body not JSON: %v", err)
			}
			if w.Code != http.StatusInternalServerError || env.Code != CodeInternalError || env.Data != nil || strings.Contains(env.Error, "detail") {
				t.Errorf("invalid def emitted status=%d envelope=%+v", w.Code, env)
			}
		}
	}
}

func TestSafeMessage(t *testing.T) {
	base := Resolve(CodeForbidden)
	origMsg := base.Message
	// Override substitutes message, preserves code/status.
	safe := SafeMessage(base, "custom message")
	if safe.Code != CodeForbidden || safe.Status != http.StatusForbidden || safe.Message != "custom message" {
		t.Errorf("override: got {Code:%q,Status:%d,Message:%q}, want {forbidden,403,custom}",
			safe.Code, safe.Status, safe.Message)
	}
	// Empty override falls back.
	if SafeMessage(base, "").Message != origMsg {
		t.Error("empty override did not fall back")
	}
	// internal_error always generic.
	ie := Resolve(CodeInternalError)
	safe = SafeMessage(ie, "something went wrong")
	if safe.Code != CodeInternalError || safe.Status != http.StatusInternalServerError {
		t.Error("SafeMessage altered internal_error code/status")
	}
	if !strings.Contains(safe.Message, "internal") {
		t.Errorf("internal_error Message=%q, want generic", safe.Message)
	}
}
