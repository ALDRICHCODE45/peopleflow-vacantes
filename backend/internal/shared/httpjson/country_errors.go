package httpjson

import "net/http"

// WriteApplicantCountryError adds data only to the two apply country errors.
func WriteApplicantCountryError(w http.ResponseWriter, def Definition, allowed []string) {
	def = normalizeDefinition(def)
	if def.Code != CodeApplicantCountryRequired && def.Code != CodeApplicantCountryNotAllowed {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	data := struct {
		Allowed []string `json:"allowed"`
	}{append([]string{}, allowed...)}
	WriteJSON(w, def.Status, struct {
		Error string `json:"error"`
		Code  Code   `json:"code"`
		Data  any    `json:"data"`
	}{def.Message, def.Code, data})
}
