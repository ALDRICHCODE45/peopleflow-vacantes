package httpjson

import "net/http"

// CodeLastOwner identifies a rejected mutation of a company's final owner.
const CodeLastOwner Code = "last_owner"

// CompanyMemberErrorCodes lists additive company-membership catalog entries.
func CompanyMemberErrorCodes() []Code { return []Code{CodeLastOwner} }

func resolveCompanyMemberError(code Code) (Definition, bool) {
	if code == CodeLastOwner {
		return Definition{code, http.StatusConflict, "company must retain at least one owner"}, true
	}
	return Definition{}, false
}
