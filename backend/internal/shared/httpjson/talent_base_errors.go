package httpjson

import (
	"encoding/json"
	"net/http"
)

const (
	CodeTalentBaseRestricted         Code = "talent_base_restricted"
	CodeTalentBaseVersionConflict    Code = "talent_base_visibility_version_conflict"
	CodeTalentBaseUsersNotApplicable Code = "talent_base_users_not_applicable"
	CodeTalentBaseViewerNotMember    Code = "talent_base_viewer_not_member"
	CodeTalentBaseViewerIsOwner      Code = "talent_base_viewer_is_owner"
)

func TalentBaseErrorCodes() []Code {
	return []Code{CodeTalentBaseRestricted, CodeTalentBaseVersionConflict, CodeTalentBaseUsersNotApplicable, CodeTalentBaseViewerNotMember, CodeTalentBaseViewerIsOwner}
}

func resolveTalentBaseError(code Code) (Definition, bool) {
	switch code {
	case CodeTalentBaseRestricted:
		return Definition{code, http.StatusForbidden, "the company owner restricted the talent base"}, true
	case CodeTalentBaseVersionConflict:
		return Definition{code, http.StatusPreconditionFailed, "talent base visibility changed"}, true
	case CodeTalentBaseUsersNotApplicable:
		return Definition{code, http.StatusUnprocessableEntity, "user_ids must be empty when mode is all_recruiters"}, true
	case CodeTalentBaseViewerNotMember:
		return Definition{code, http.StatusUnprocessableEntity, "user is not a member of this company"}, true
	case CodeTalentBaseViewerIsOwner:
		return Definition{code, http.StatusUnprocessableEntity, "owners always see the talent base"}, true
	}
	return Definition{}, false
}

// WriteTalentBaseRuleError writes one of the 422 talent base rules with the
// offending field, in the same {error, code, fields} envelope as validation_error.
func WriteTalentBaseRuleError(w http.ResponseWriter, code Code, field ValidationField) {
	def := Resolve(code)
	if def.Status != http.StatusUnprocessableEntity {
		WriteCatalogError(w, Resolve(CodeInternalError))
		return
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, struct {
		Error  string            `json:"error"`
		Code   Code              `json:"code"`
		Fields []ValidationField `json:"fields"`
	}{def.Message, def.Code, []ValidationField{field}})
}

// WriteTalentBaseVersionConflict answers 412 with the current settings document
// (the GET body) plus the catalog error and code, so the client can reconcile
// without another request. The caller sets the current ETag header.
func WriteTalentBaseVersionConflict(w http.ResponseWriter, current any) {
	def := Resolve(CodeTalentBaseVersionConflict)
	body := map[string]json.RawMessage{}
	raw, err := json.Marshal(current)
	if err == nil {
		err = json.Unmarshal(raw, &body)
	}
	if err != nil {
		WriteCatalogError(w, Resolve(CodeInternalError))
		return
	}
	message, _ := json.Marshal(def.Message)
	code, _ := json.Marshal(def.Code)
	body["error"], body["code"] = message, code
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, body)
}
