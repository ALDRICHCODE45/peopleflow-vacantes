package httpjson

// Replacement processes (docs/contracts/replacement-processes-v1.md, «Error
// codes»). Every one carries the process' lifecycle view or the offending ids in
// data, written through WriteLifecycleError, so the frontend decodes one
// envelope for the whole family.
const (
	CodeReopenRequiresReplacement  Code = "reopen_requires_replacement"
	CodeReplacementAlreadyActive   Code = "replacement_already_active"
	CodeReopenSuperseded           Code = "reopen_superseded"
	CodeReplacementSourceNotClosed Code = "replacement_source_not_closed"
	CodeReplacementSourceNotLatest Code = "replacement_source_not_latest"
	CodeReplacementCreditsInvalid  Code = "replacement_credits_invalid"
	CodeCarriedCandidateInvalid    Code = "carried_candidate_invalid"
	CodeCarriedStageInvalid        Code = "carried_stage_invalid"
)

func ReplacementErrorCodes() []Code {
	return []Code{
		CodeReopenRequiresReplacement, CodeReplacementAlreadyActive, CodeReopenSuperseded,
		CodeReplacementSourceNotClosed, CodeReplacementSourceNotLatest, CodeReplacementCreditsInvalid,
		CodeCarriedCandidateInvalid, CodeCarriedStageInvalid,
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
	case CodeCarriedCandidateInvalid:
		return Definition{code, 422, "carried candidate invalid"}, true
	case CodeCarriedStageInvalid:
		return Definition{code, 422, "carried stage invalid"}, true
	}
	return Definition{}, false
}
