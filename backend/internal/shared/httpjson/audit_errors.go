package httpjson

import "net/http"

// CodeAuditExportTooLarge refuses an audit export above the row limit
// (audit-log-v1 §8.5). Nothing is exported.
const CodeAuditExportTooLarge Code = "audit_export_too_large"

func AuditErrorCodes() []Code { return []Code{CodeAuditExportTooLarge} }

func resolveAuditError(code Code) (Definition, bool) {
	if code == CodeAuditExportTooLarge {
		return Definition{code, http.StatusUnprocessableEntity, "audit export too large"}, true
	}
	return Definition{}, false
}

// WriteAuditInvalidFilter answers the audit screen's invalid_filter: 422 with
// the {field, code} list (audit-log-v1 §8.1, §8.5; the company metrics filters,
// stakeholder-metrics-v1 §3.0, answer with it too). The shared invalid_filter
// catalog entry stays a 400 for the pool list and the public jobs search, so
// this writer sets its own status and never changes Resolve(CodeInvalidFilter).
func WriteAuditInvalidFilter(w http.ResponseWriter, fields []ValidationField) {
	def := Resolve(CodeInvalidFilter)
	recordCatalogCode(w, def.Code)
	if fields == nil {
		fields = []ValidationField{}
	}
	WriteJSON(w, http.StatusUnprocessableEntity, struct {
		Error  string            `json:"error"`
		Code   Code              `json:"code"`
		Fields []ValidationField `json:"fields"`
	}{def.Message, def.Code, fields})
}

// WriteAuditExportTooLarge puts row_count and limit at the top level of the
// envelope, as the contract pins (audit-log-v1 §8.5).
func WriteAuditExportTooLarge(w http.ResponseWriter, rowCount, limit int) {
	def := Resolve(CodeAuditExportTooLarge)
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, struct {
		Error    string `json:"error"`
		Code     Code   `json:"code"`
		RowCount int    `json:"row_count"`
		Limit    int    `json:"limit"`
	}{def.Message, def.Code, rowCount, limit})
}
