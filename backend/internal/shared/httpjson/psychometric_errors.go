package httpjson

const (
	CodeAssessmentUnavailable Code = "assessment_unavailable"
	CodeConsentRequired       Code = "consent_required"
	CodeNoticeChanged         Code = "notice_changed"
	CodeAssessmentFinished    Code = "assessment_finished"
	CodeProfileDisabled       Code = "profile_disabled"
	CodeAlreadyFinished       Code = "already_finished"
	CodeParticipationInactive Code = "participation_inactive"
	CodeInvitationClosed      Code = "invitation_closed"
)

func PsychometricErrorCodes() []Code {
	return []Code{CodeProfileDisabled, CodeAlreadyFinished, CodeParticipationInactive, CodeInvitationClosed, CodeAssessmentUnavailable, CodeConsentRequired, CodeNoticeChanged, CodeAssessmentFinished}
}
func resolvePsychometricError(code Code) (Definition, bool) {
	switch code {
	case CodeAssessmentUnavailable:
		return Definition{code, 404, "psychometric assessment unavailable"}, true
	case CodeConsentRequired:
		return Definition{code, 403, "psychometric consent required"}, true
	case CodeNoticeChanged:
		return Definition{code, 409, "psychometric notice changed"}, true
	case CodeAssessmentFinished:
		return Definition{code, 409, "psychometric assessment finished"}, true
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
