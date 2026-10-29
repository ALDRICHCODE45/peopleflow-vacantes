package httpjson

const (
	CodeProfileDisabled       Code = "profile_disabled"
	CodeAlreadyFinished       Code = "already_finished"
	CodeParticipationInactive Code = "participation_inactive"
	CodeInvitationClosed      Code = "invitation_closed"
)

func PsychometricErrorCodes() []Code {
	return []Code{CodeProfileDisabled, CodeAlreadyFinished, CodeParticipationInactive, CodeInvitationClosed}
}
func resolvePsychometricError(code Code) (Definition, bool) {
	switch code {
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
