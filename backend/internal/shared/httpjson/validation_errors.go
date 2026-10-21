package httpjson

import "net/http"

// ValidationField identifies a public field and a bounded validation code,
// never the rejected value.
type ValidationField struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

// WriteValidationError preserves the shared 400 catalog envelope and adds fields.
func WriteValidationError(w http.ResponseWriter, fields []ValidationField) {
	def := Resolve(CodeValidationError)
	recordCatalogCode(w, def.Code)
	if fields == nil {
		fields = []ValidationField{}
	}
	WriteJSON(w, def.Status, struct {
		Error  string            `json:"error"`
		Code   Code              `json:"code"`
		Fields []ValidationField `json:"fields"`
	}{def.Message, def.Code, fields})
}
