package httpjson

import "net/http"

const (
	CodeStageOccupied              Code = "stage_occupied"
	CodeImpactConfirmationRequired Code = "impact_confirmation_required"
	CodeRecoveryStageRequired      Code = "recovery_stage_required"
)

func ColumnErrorCodes() []Code {
	return []Code{CodeStageOccupied, CodeImpactConfirmationRequired, CodeRecoveryStageRequired}
}
func resolveColumnError(code Code) (Definition, bool) {
	switch code {
	case CodeStageOccupied:
		return Definition{code, 409, "stage occupied"}, true
	case CodeImpactConfirmationRequired:
		return Definition{code, 409, "impact confirmation required"}, true
	case CodeRecoveryStageRequired:
		return Definition{code, 409, "recovery stage required"}, true
	default:
		return Definition{}, false
	}
}

type StageDetail struct {
	StageID string `json:"stage_id"`
}

// Conflict details stay exclusively in the catalog, with its usual fail-closed
// normalization and observability recording.
func WriteColumnError(w http.ResponseWriter, def Definition, details []StageDetail) {
	def = normalizeDefinition(def)
	if def.Code != CodeStageOccupied {
		WriteCatalogError(w, def)
		return
	}
	if details == nil {
		details = []StageDetail{}
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, struct {
		Error   string        `json:"error"`
		Code    Code          `json:"code"`
		Details []StageDetail `json:"details"`
	}{def.Message, def.Code, details})
}
