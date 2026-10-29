package httpjson

import "net/http"

const (
	CodeIncomplete            Code = "incomplete"
	CodeAssessmentUnavailable Code = "assessment_unavailable"
	CodeConsentRequired       Code = "consent_required"
	CodeNoticeChanged         Code = "notice_changed"
	CodeAssessmentFinished    Code = "assessment_finished"
	CodeProfileDisabled       Code = "profile_disabled"
	CodeProfileUnconfirmed    Code = "profile_unconfirmed"
	CodeAlreadyFinished       Code = "already_finished"
	CodeParticipationInactive Code = "participation_inactive"
	CodeInvitationClosed      Code = "invitation_closed"
)

// WritePsychometricIncomplete exposes only the scorer's safe ordered positions;
// the generic conflict-data helper deliberately strips non-conflict data.
func WritePsychometricIncomplete(w http.ResponseWriter, missing []int) {
	def := Resolve(CodeIncomplete)
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: struct {
		MissingPositions []int `json:"missing_positions"`
	}{missing}})
}

func PsychometricErrorCodes() []Code {
	return []Code{CodeProfileDisabled, CodeAlreadyFinished, CodeParticipationInactive, CodeInvitationClosed, CodeAssessmentUnavailable, CodeConsentRequired, CodeNoticeChanged, CodeAssessmentFinished, CodeIncomplete, CodeProfileUnconfirmed}
}
func resolvePsychometricError(code Code) (Definition, bool) {
	switch code {
	case CodeIncomplete:
		return Definition{code, 422, "psychometric assessment incomplete"}, true
	case CodeAssessmentUnavailable:
		return Definition{code, 404, "psychometric assessment unavailable"}, true
	case CodeConsentRequired:
		return Definition{code, 403, "psychometric consent required"}, true
	case CodeNoticeChanged:
		return Definition{code, 409, "psychometric notice changed"}, true
	case CodeAssessmentFinished:
		return Definition{code, 409, "psychometric assessment finished"}, true
	case CodeProfileUnconfirmed:
		return Definition{code, 409, "psychometric profile unconfirmed"}, true
	case CodeProfileDisabled:
		return Definition{code, 409, "psychometric profile disabled"}, true
	case CodeAlreadyFinished:
		return Definition{code, 409, "psychometric assessment already finished"}, true
	case CodeParticipationInactive:
		return Definition{code, 409, "participation inactive"}, true
	case CodeInvitationClosed:
		return Definition{code, 409, "psychometric invitation closed"}, true
	default:
		return Definition{}, false
	}
}
