package httpjson

import "net/http"

// CodeInvalidCursor is additive; existing draft lists keep invalid_request.
const CodeInvalidCursor Code = "invalid_cursor"

// WriteInvalidFilterFields adds validation details only when explicitly called.
// WriteCatalogError(CodeInvalidFilter) retains the public jobs two-key envelope.
func WriteInvalidFilterFields(w http.ResponseWriter, fields []ValidationField) {
	def := Resolve(CodeInvalidFilter)
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
