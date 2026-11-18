package http

import (
	"encoding/csv"
	"errors"
	"net/http"
	"strings"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// Deliveries list, placements list and the CSV exports of stakeholder-metrics-v2
// §5 and §8.

// DeliveryList serves GET /v2/me/company/metrics/deliveries (v2 §5.1).
func (h *Handler) DeliveryList(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.ListDeliveries(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// PlacementList serves GET /v2/me/company/metrics/placements (v2 §5.3); each
// successful page is audited before it is served.
func (h *Handler) PlacementList(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.ListPlacements(r.Context(), cc.CompanyID, cc.UserID, r.URL.RawQuery)
	respond(w, body, err)
}

// Export serves GET /v2/me/company/metrics/{kind}/export (v2 §8) for one
// kind. Every error is a normal JSON response: the rows are counted and an
// audited kind's MetricsDetailExported is committed before the first byte.
// Once the CSV starts the status is 200; a later failure aborts the
// connection instead of ending a truncated file as if it were complete.
func (h *Handler) Export(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cc, ok := companyContext(w, r)
		if !ok {
			return
		}
		export, err := h.service.Export(r.Context(), cc.CompanyID, cc.UserID, kind, r.URL.RawQuery)
		var tooLarge *app.TooLarge
		if errors.As(err, &tooLarge) {
			httpjson.WriteMetricsExportTooLarge(w, tooLarge.RowCount, tooLarge.Limit)
			return
		}
		if err != nil {
			respond(w, nil, err)
			return
		}
		writeCSV(w, export.Filename, export.Header, export.Len(), export.Record)
	}
}

// utf8BOM lets Excel (es-MX) read the accents.
var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// exportBatch rows are flushed to the client at a time.
const exportBatch = 500

// writeCSV streams the header and rows with the BOM and the formula guard on
// every cell.
func writeCSV(w http.ResponseWriter, filename string, header []string, rows int, record func(int) []string) {
	flusher := http.NewResponseController(w)
	h := w.Header()
	h.Set("Content-Type", "text/csv; charset=utf-8")
	h.Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(utf8BOM); err != nil {
		abortStream(w)
	}
	out := csv.NewWriter(w)
	write := func(cells []string) {
		guarded := make([]string, len(cells))
		for i, v := range cells {
			guarded[i] = guardFormula(v)
		}
		if err := out.Write(guarded); err != nil {
			abortStream(w)
		}
	}
	write(header)
	for i := 0; i < rows; i++ {
		write(record(i))
		if (i+1)%exportBatch == 0 {
			out.Flush()
			if err := out.Error(); err != nil {
				abortStream(w)
			}
			_ = flusher.Flush()
		}
	}
	out.Flush()
	if err := out.Error(); err != nil {
		abortStream(w)
	}
	_ = flusher.Flush()
}

// abortStream ends a response that already sent its 200: the connection is cut
// so the client sees a failed download, not a short file.
func abortStream(w http.ResponseWriter) {
	if rec, ok := w.(httpjson.CatalogCodeRecorder); ok {
		rec.RecordCatalogCode(string(httpjson.CodeInternalError))
	}
	panic(http.ErrAbortHandler)
}

// guardFormula defuses CSV injection like the audit export: a cell a
// spreadsheet would read as a formula (= + - @, tab, carriage return) gets a
// leading '.
func guardFormula(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}
