package httpjson

// Replacement processes (docs/contracts/replacement-processes-v1.md, «Error
// codes»). Every one is a 409 whose data carries the process' lifecycle view,
// so the frontend decodes one envelope for the whole lifecycle family.
const (
	CodeReopenRequiresReplacement Code = "reopen_requires_replacement"
	CodeReplacementAlreadyActive  Code = "replacement_already_active"
	CodeReopenSuperseded          Code = "reopen_superseded"
)

func ReplacementErrorCodes() []Code {
	return []Code{CodeReopenRequiresReplacement, CodeReplacementAlreadyActive, CodeReopenSuperseded}
}

func resolveReplacementError(code Code) (Definition, bool) {
	switch code {
	case CodeReopenRequiresReplacement:
		return Definition{code, 409, "reopen requires replacement"}, true
	case CodeReplacementAlreadyActive:
		return Definition{code, 409, "replacement already active"}, true
	case CodeReopenSuperseded:
		return Definition{code, 409, "reopen superseded"}, true
	}
	return Definition{}, false
}
