package httpjson

import (
	"net/http"
	"strings"
)

const CodeTeamAccessEnded Code = "team_access_ended"

func resolveTeamError(code Code) (Definition, bool) {
	status := 409
	switch code {
	case "team_action_forbidden":
		status = 403
	case "team_version_conflict":
		status = 412
	case "not_company_member", "reassignment_note_required", "responsible_not_on_team", "recruiter_deadline_not_applicable", "responsible_not_applicable", "offboard_unresolved_vacancies", "offboard_reassignment_not_applicable":
		status = 422
	case "team_member_not_found":
		status = 404
	case "member_is_responsible", "responsible_required", "credit_status_unchanged", "team_member_already_active", "team_last_member", "responsible_cannot_leave", "use_reassign_responsible", "reassign_target_is_responsible", "team_mode_mismatch", "team_mode_unchanged":
	default:
		return Definition{}, false
	}
	return Definition{code, status, strings.ReplaceAll(string(code), "_", " ")}, true
}

// WriteTeamOffboardVacancies is the sole envelope writer for offboard refusals
// that list the member's blocking vacancies. Other codes get no data here.
func WriteTeamOffboardVacancies(w http.ResponseWriter, code Code, vacancies any) {
	def := normalizeDefinition(Resolve(code))
	if def.Code != "member_is_responsible" && def.Code != "offboard_unresolved_vacancies" {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: map[string]any{"vacancies": vacancies}})
}
