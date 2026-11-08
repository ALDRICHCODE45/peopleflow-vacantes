package httpjson

import "net/http"

// Stakeholder role and invitation codes (stakeholder-metrics-v1 §1.2-§1.3).
const (
	CodeInvitationInvalid                 Code = "invitation_invalid"
	CodeInvitationLimitReached            Code = "invitation_limit_reached"
	CodeCandidateAccount                  Code = "candidate_account"
	CodeAlreadyCompanyMember              Code = "already_company_member"
	CodeStakeholderRoleChangeNotSupported Code = "stakeholder_role_change_not_supported"
)

// StakeholderErrorCodes lists the additive stakeholder catalog entries.
func StakeholderErrorCodes() []Code {
	return []Code{CodeInvitationInvalid, CodeInvitationLimitReached, CodeCandidateAccount, CodeAlreadyCompanyMember, CodeStakeholderRoleChangeNotSupported}
}

func resolveStakeholderError(code Code) (Definition, bool) {
	switch code {
	case CodeInvitationInvalid:
		// One code for unknown, expired, revoked and foreign-used tokens: no oracle.
		return Definition{code, http.StatusNotFound, "invitation is invalid or expired"}, true
	case CodeInvitationLimitReached:
		return Definition{code, http.StatusUnprocessableEntity, "too many pending invitations"}, true
	case CodeCandidateAccount:
		return Definition{code, http.StatusForbidden, "candidate accounts cannot join a company"}, true
	case CodeAlreadyCompanyMember:
		return Definition{code, http.StatusConflict, "user already belongs to a company"}, true
	case CodeStakeholderRoleChangeNotSupported:
		return Definition{code, http.StatusUnprocessableEntity, "stakeholder role changes are not supported"}, true
	}
	return Definition{}, false
}
