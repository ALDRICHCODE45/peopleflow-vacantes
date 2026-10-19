package httpjson

import "net/http"

const (
	CodeSubstateRequiresInProcess Code = "substate_requires_in_process"
	CodeSubstateInUse             Code = "substate_in_use"
)

func SubstateErrorCodes() []Code { return []Code{CodeSubstateRequiresInProcess, CodeSubstateInUse} }
func resolveSubstateError(code Code) (Definition, bool) {
	switch code {
	case CodeSubstateRequiresInProcess:
		return Definition{code, 409, "substate requires in_process"}, true
	case CodeSubstateInUse:
		return Definition{code, 409, "substate in use"}, true
	default:
		return Definition{}, false
	}
}

type SubstateDetail struct {
	SubstateID string `json:"substate_id"`
}

// Only this additive code may carry substate conflict details. Normalize first,
// preserving the catalog's fail-closed behavior and observability recorder.
func WriteSubstateError(w http.ResponseWriter, def Definition, details []SubstateDetail) {
	def = normalizeDefinition(def)
	if def.Code != CodeSubstateInUse {
		WriteCatalogError(w, def)
		return
	}
	if details == nil {
		details = []SubstateDetail{}
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, struct {
		Error   string           `json:"error"`
		Code    Code             `json:"code"`
		Details []SubstateDetail `json:"details"`
	}{def.Message, def.Code, details})
}
