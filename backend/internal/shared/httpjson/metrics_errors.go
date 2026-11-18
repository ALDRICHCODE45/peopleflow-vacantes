package httpjson

import "net/http"

// CodeMetricsExportTooLarge refuses a metrics CSV export above the row limit
// (stakeholder-metrics-v2 §8). Nothing is exported.
const CodeMetricsExportTooLarge Code = "metrics_export_too_large"

func MetricsErrorCodes() []Code { return []Code{CodeMetricsExportTooLarge} }

func resolveMetricsError(code Code) (Definition, bool) {
	if code == CodeMetricsExportTooLarge {
		return Definition{code, http.StatusUnprocessableEntity, "metrics export too large"}, true
	}
	return Definition{}, false
}

// WriteMetricsExportTooLarge puts row_count and limit at the top level of the
// envelope, the body of audit_export_too_large (v2 §8).
func WriteMetricsExportTooLarge(w http.ResponseWriter, rowCount, limit int) {
	def := Resolve(CodeMetricsExportTooLarge)
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, struct {
		Error    string `json:"error"`
		Code     Code   `json:"code"`
		RowCount int    `json:"row_count"`
		Limit    int    `json:"limit"`
	}{def.Message, def.Code, rowCount, limit})
}
