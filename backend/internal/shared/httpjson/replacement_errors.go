package httpjson

// Replacement processes (docs/contracts/replacement-processes-v1.md, «Error
// codes»). Every one carries the process' lifecycle view or the offending ids in
// data, written through WriteLifecycleError, so the frontend decodes one
// envelope for the whole family. R3a implements Start's codes; the carried
// candidate codes (carried_candidate_invalid, carried_stage_invalid) arrive with R3b.
const (
	CodeReopenRequiresReplacement  Code = "reopen_requires_replacement"
	CodeReplacementAlreadyActive   Code = "replacement_already_active"
	CodeReopenSuperseded           Code = "reopen_superseded"
	CodeReplacementSourceNotClosed Code = "replacement_source_not_closed"
	CodeReplacementSourceNotLatest Code = "replacement_source_not_latest"
	CodeReplacementCreditsInvalid  Code = "replacement_credits_invalid"
)

func ReplacementErrorCodes() []Code {
	return []Code{
		CodeReopenRequiresReplacement, CodeReplacementAlreadyActive, CodeReopenSuperseded,
		CodeReplacementSourceNotClosed, CodeReplacementSourceNotLatest, CodeReplacementCreditsInvalid,
	}
}

func resolveReplacementError(code Code) (Definition, bool) {
	switch code {
	case CodeReopenRequiresReplacement:
		return Definition{code, 409, "reopen requires replacement"}, true
	case CodeReplacementAlreadyActive:
		return Definition{code, 409, "replacement already active"}, true
	case CodeReopenSuperseded:
		return Definition{code, 409, "reopen superseded"}, true
	case CodeReplacementSourceNotClosed:
		return Definition{code, 409, "replacement source not closed"}, true
	case CodeReplacementSourceNotLatest:
		return Definition{code, 409, "replacement source not latest"}, true
	case CodeReplacementCreditsInvalid:
		return Definition{code, 422, "replacement credits invalid"}, true
	}
	return Definition{}, false
}
