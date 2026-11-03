package httpjson

import "strings"

const CodeTeamAccessEnded Code = "team_access_ended"

func resolveTeamError(code Code) (Definition, bool) {
	status := 409
	switch code {
	case "team_action_forbidden":
		status = 403
	case "team_version_conflict":
		status = 412
	case "not_company_member", "reassignment_note_required", "responsible_not_on_team", "recruiter_deadline_not_applicable", "responsible_not_applicable":
		status = 422
	case "team_member_not_found":
		status = 404
	case "credit_status_unchanged", "team_member_already_active", "team_last_member", "responsible_cannot_leave", "use_reassign_responsible", "reassign_target_is_responsible", "team_mode_mismatch", "team_mode_unchanged":
	default:
		return Definition{}, false
	}
	return Definition{code, status, strings.ReplaceAll(string(code), "_", " ")}, true
}
