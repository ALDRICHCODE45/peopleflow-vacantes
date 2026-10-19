package httpjson

import "net/http"

const (
	CodeAccountRequired     Code = "account_required"
	CodeWrongRole           Code = "wrong_role"
	CodeAccountExists       Code = "account_exists"
	CodeEmailInUse          Code = "email_in_use"
	CodeEmailNotVerified    Code = "email_not_verified"
	CodeIdentityUnavailable Code = "identity_unavailable"
)

func IdentityErrorCodes() []Code {
	return []Code{CodeAccountRequired, CodeWrongRole, CodeAccountExists, CodeEmailInUse, CodeEmailNotVerified, CodeIdentityUnavailable}
}
func resolveIdentityError(code Code) (Definition, bool) {
	switch code {
	case CodeAccountRequired:
		return Definition{code, http.StatusForbidden, "candidate account required"}, true
	case CodeWrongRole:
		return Definition{code, http.StatusForbidden, "candidate role required"}, true
	case CodeAccountExists:
		return Definition{code, http.StatusConflict, "account already exists"}, true
	case CodeEmailInUse:
		return Definition{code, http.StatusConflict, "email already in use"}, true
	case CodeEmailNotVerified:
		return Definition{code, http.StatusUnprocessableEntity, "email not verified"}, true
	case CodeIdentityUnavailable:
		return Definition{code, http.StatusServiceUnavailable, "identity unavailable"}, true
	default:
		return Definition{}, false
	}
}
