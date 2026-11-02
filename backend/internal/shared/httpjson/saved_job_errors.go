package httpjson

import "net/http"

const (
	CodeJobUnavailable Code = "job_unavailable"
	CodeSavedJobsLimit Code = "saved_jobs_limit"
)

func SavedJobErrorCodes() []Code { return []Code{CodeJobUnavailable, CodeSavedJobsLimit} }
func resolveSavedJobError(code Code) (Definition, bool) {
	switch code {
	case CodeJobUnavailable:
		return Definition{code, http.StatusConflict, "job unavailable"}, true
	case CodeSavedJobsLimit:
		return Definition{code, http.StatusConflict, "saved jobs limit reached"}, true
	}
	return Definition{}, false
}

// WriteSavedJobError adds only the fixed public limit, never arbitrary data.
func WriteSavedJobError(w http.ResponseWriter, def Definition) {
	def = normalizeDefinition(def)
	if def.Code != CodeSavedJobsLimit {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: struct {
		Limit int `json:"limit"`
	}{200}})
}
