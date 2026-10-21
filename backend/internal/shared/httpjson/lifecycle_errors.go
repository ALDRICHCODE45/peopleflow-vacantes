package httpjson

import "net/http"

const CodeLifecycleTransitionInvalid Code = "lifecycle_transition_invalid"

func LifecycleErrorCodes() []Code { return []Code{CodeLifecycleTransitionInvalid} }
func resolveLifecycleError(code Code) (Definition, bool) {
	if code == CodeLifecycleTransitionInvalid {
		return Definition{code, 409, "lifecycle transition invalid"}, true
	}
	return Definition{}, false
}

// WriteLifecycleError is the sole envelope writer for lifecycle conflicts.
// Other catalog codes cannot acquire lifecycle data through this seam.
func WriteLifecycleError(w http.ResponseWriter, def Definition, data any) {
	def = normalizeDefinition(def)
	if def.Code != CodeLifecycleTransitionInvalid {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: data})
}
