package httpjson

import "net/http"

const (
	CodeCloseReasonNotCovered           Code = "close_reason_not_covered"
	CodeLifecycleTransitionInvalid      Code = "lifecycle_transition_invalid"
	CodeVacancyUnavailable              Code = "vacancy_unavailable"
	CodeVacancyNotAcceptingApplications Code = "vacancy_not_accepting_applications"
	CodeProcessFinished                 Code = "process_finished"
)

func LifecycleErrorCodes() []Code {
	return []Code{CodeLifecycleTransitionInvalid, CodeVacancyUnavailable, CodeVacancyNotAcceptingApplications, CodeProcessFinished, CodeCloseReasonNotCovered}
}
func resolveLifecycleError(code Code) (Definition, bool) {
	switch code {
	case CodeCloseReasonNotCovered:
		return Definition{code, 422, "close reason not covered"}, true
	case CodeLifecycleTransitionInvalid:
		return Definition{code, 409, "lifecycle transition invalid"}, true
	case CodeVacancyUnavailable:
		return Definition{code, 410, "vacancy unavailable"}, true
	case CodeVacancyNotAcceptingApplications:
		return Definition{code, 409, "vacancy not accepting applications"}, true
	case CodeProcessFinished:
		return Definition{code, 409, "process finished"}, true
	}
	return Definition{}, false
}

// WriteLifecycleError is the sole envelope writer for lifecycle conflicts.
// Other catalog codes cannot acquire lifecycle data through this seam.
func WriteLifecycleError(w http.ResponseWriter, def Definition, data any) {
	def = normalizeDefinition(def)
	if _, ok := resolveLifecycleError(def.Code); !ok {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: data})
}
