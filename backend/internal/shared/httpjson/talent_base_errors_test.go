package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestTalentBaseErrorCodes(t *testing.T) {
	want := []Code{"talent_base_restricted", "talent_base_visibility_version_conflict", "talent_base_users_not_applicable", "talent_base_viewer_not_member", "talent_base_viewer_is_owner"}
	if !reflect.DeepEqual(TalentBaseErrorCodes(), want) {
		t.Fatal(TalentBaseErrorCodes())
	}
	statuses := []int{403, 412, 422, 422, 422}
	messages := []string{"the company owner restricted the talent base", "talent base visibility changed", "user_ids must be empty when mode is all_recruiters", "user is not a member of this company", "owners always see the talent base"}
	for i, code := range want {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			if def.Code != code || def.Status != statuses[i] || def.Message != messages[i] {
				t.Fatal(def)
			}
		})
	}
	list := TalentBaseErrorCodes()
	list[0] = "oops"
	if TalentBaseErrorCodes()[0] != CodeTalentBaseRestricted {
		t.Fatal("mutable list")
	}
}

func TestTalentBaseRestrictedEnvelope(t *testing.T) {
	w := httptest.NewRecorder()
	WriteCatalogError(w, Resolve(CodeTalentBaseRestricted))
	if w.Code != 403 || w.Body.String() != `{"error":"the company owner restricted the talent base","code":"talent_base_restricted"}`+"\n" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestTalentBaseRuleEnvelope(t *testing.T) {
	w := httptest.NewRecorder()
	WriteTalentBaseRuleError(w, CodeTalentBaseViewerIsOwner, ValidationField{Field: "user_ids[1]", Code: "is_owner"})
	want := `{"error":"owners always see the talent base","code":"talent_base_viewer_is_owner","fields":[{"field":"user_ids[1]","code":"is_owner"}]}` + "\n"
	if w.Code != 422 || w.Body.String() != want {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	WriteTalentBaseRuleError(w, CodeTalentBaseRestricted, ValidationField{Field: "x", Code: "y"})
	if w.Code != 500 {
		t.Fatalf("non-422 code must fail closed, got %d", w.Code)
	}
}

func TestTalentBaseVersionConflictEnvelope(t *testing.T) {
	w := httptest.NewRecorder()
	WriteTalentBaseVersionConflict(w, map[string]any{"mode": "all_recruiters", "viewers": []any{}, "version": 3})
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"mode": "all_recruiters", "viewers": []any{}, "version": float64(3), "error": "talent base visibility changed", "code": "talent_base_visibility_version_conflict"}
	if w.Code != 412 || !reflect.DeepEqual(got, want) {
		t.Fatalf("%d %v", w.Code, got)
	}
}
