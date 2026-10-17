package httpjson

const (
	CodeAlreadyDiscarded                     Code = "already_discarded"
	CodeNotDiscarded                         Code = "not_discarded"
	CodePlacementReentryConfirmationRequired Code = "placement_reentry_confirmation_required"
)

func DiscardErrorCodes() []Code {
	return []Code{CodeAlreadyDiscarded, CodeNotDiscarded, CodePlacementReentryConfirmationRequired}
}
func resolveDiscardError(code Code) (Definition, bool) {
	switch code {
	case CodeAlreadyDiscarded:
		return Definition{code, 409, "participation already discarded"}, true
	case CodeNotDiscarded:
		return Definition{code, 409, "participation not discarded"}, true
	case CodePlacementReentryConfirmationRequired:
		return Definition{code, 409, "placement reentry confirmation required"}, true
	default:
		return Definition{}, false
	}
}
