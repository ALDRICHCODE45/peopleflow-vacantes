package httpjson

import "net/http"

const (
	CodePossibleDuplicates        Code = "possible_duplicates"
	CodeCandidateAlreadyInProcess Code = "candidate_already_in_process"
)

func ManualIntakeErrorCodes() []Code {
	return []Code{CodePossibleDuplicates, CodeCandidateAlreadyInProcess}
}

func resolveManualIntakeError(code Code) (Definition, bool) {
	switch code {
	case CodePossibleDuplicates:
		return Definition{code, http.StatusConflict, "possible duplicates"}, true
	case CodeCandidateAlreadyInProcess:
		return Definition{code, http.StatusConflict, "candidate already in process"}, true
	}
	return Definition{}, false
}

// WriteManualIntakeError permits data only for the two intake conflicts.
func WriteManualIntakeError(w http.ResponseWriter, code Code, data any) {
	def := Resolve(code)
	if _, ok := resolveManualIntakeError(code); !ok {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: data})
}
