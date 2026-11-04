// Package http exposes the owner's audit screen API (audit-log-v1 §8). The
// owner gate and NoStore run in the router; every response here is JSON except
// a successful export, a CSV stream.
package http

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/application/auditlog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

const maxExportBodyBytes = 16_384

type Handler struct{ service *app.Service }

func NewHandler(service *app.Service) *Handler { return &Handler{service: service} }

// WithExportLimit lowers the export row cap (tests only).
func (h *Handler) WithExportLimit(n int) *Handler {
	h.service.WithExportLimit(n)
	return h
}

func companyContext(w http.ResponseWriter, r *http.Request) (security.CompanyContext, bool) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return cc, false
	}
	return cc, true
}

// internalError writes the catalog 500; the request-completion record already
// carries its code class, so nothing else is logged here.
func internalError(w http.ResponseWriter) {
	httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
}

// abortStream ends a response that already sent its 200: the connection is cut
// so the client sees a failed download, not a short file. The completion record
// is told the request failed.
func abortStream(w http.ResponseWriter) {
	if rec, ok := w.(httpjson.CatalogCodeRecorder); ok {
		rec.RecordCatalogCode(string(httpjson.CodeInternalError))
	}
	panic(http.ErrAbortHandler)
}

func invalidFilter(w http.ResponseWriter, filter *app.InvalidFilter) {
	fields := make([]httpjson.ValidationField, len(filter.Fields))
	for i, f := range filter.Fields {
		fields[i] = httpjson.ValidationField{Field: f.Field, Code: f.Code}
	}
	httpjson.WriteAuditInvalidFilter(w, fields)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	page, err := h.service.List(r.Context(), cc.CompanyID, r.URL.RawQuery)
	var filter *app.InvalidFilter
	switch {
	case err == nil:
		httpjson.WriteJSON(w, http.StatusOK, page)
	case errors.As(err, &filter):
		invalidFilter(w, filter)
	case errors.Is(err, app.ErrInvalidCursor):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
	default:
		internalError(w)
	}
}

func (h *Handler) Types(w http.ResponseWriter, r *http.Request) {
	if _, ok := companyContext(w, r); !ok {
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, h.service.Types())
}

func (h *Handler) Actors(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	out, err := h.service.Actors(r.Context(), cc.CompanyID)
	if err != nil {
		internalError(w)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) Vacancies(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	out, err := h.service.Vacancies(r.Context(), cc.CompanyID)
	if err != nil {
		internalError(w)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}

// utf8BOM lets Excel (es-MX) read the accents.
var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

var csvHeader = []string{"occurred_at", "occurred_at_mx", "event_type", "category", "actor_user_id", "actor_name", "actor_email", "entity_type", "entity_id", "entity_label", "vacancy_id", "vacancy_title", "ip", "user_agent", "metadata"}

// Export answers every error as a normal JSON response: the count and the
// AuditLogExported commit happen before the first byte. Once the CSV starts the
// status is 200; a later failure aborts the connection instead of ending a
// truncated file as if it were complete.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxExportBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
		} else {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		}
		return
	}
	loc, err := time.LoadLocation(app.TimeZone)
	if err != nil {
		internalError(w)
		return
	}
	export, err := h.service.Export(r.Context(), cc.CompanyID, cc.UserID, body)
	var filter *app.InvalidFilter
	var tooLarge *app.TooLarge
	switch {
	case err == nil:
	case errors.As(err, &filter):
		invalidFilter(w, filter)
		return
	case errors.As(err, &tooLarge):
		httpjson.WriteAuditExportTooLarge(w, tooLarge.RowCount, tooLarge.Limit)
		return
	case errors.Is(err, app.ErrInvalidBody):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	default:
		internalError(w)
		return
	}
	defer export.Stream.Close()

	flusher := http.NewResponseController(w)
	header := w.Header()
	header.Set("Content-Type", "text/csv; charset=utf-8")
	header.Set("Content-Disposition", `attachment; filename="`+export.Filename+`"`)
	header.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(utf8BOM); err != nil {
		abortStream(w)
	}
	out := csv.NewWriter(w)
	if err := out.Write(csvHeader); err != nil {
		abortStream(w)
	}
	out.Flush()
	// The record is committed and the headers are out: let the client see them.
	_ = flusher.Flush()
	for {
		batch, err := export.Stream.Next(r.Context())
		if err != nil {
			abortStream(w)
		}
		if len(batch) == 0 {
			break
		}
		for _, row := range batch {
			if err := out.Write(csvRecord(row, loc)); err != nil {
				abortStream(w)
			}
		}
		out.Flush()
		if err := out.Error(); err != nil {
			abortStream(w)
		}
		_ = flusher.Flush()
	}
}

func csvRecord(row app.ExportRow, loc *time.Location) []string {
	str := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	id := func(u *uuid.UUID) string {
		if u == nil {
			return ""
		}
		return u.String()
	}
	// jsonb prints with spaces; the file carries the compact form the API serves.
	metadata := string(row.Metadata)
	if raw, err := json.Marshal(row.Metadata); err == nil {
		metadata = string(raw)
	}
	record := []string{
		row.OccurredAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		row.OccurredAt.In(loc).Format("2006-01-02T15:04:05.000-07:00"),
		row.EventType,
		row.Category,
		id(row.ActorUserID),
		str(row.ActorName),
		str(row.ActorEmail),
		row.EntityType,
		row.EntityID.String(),
		str(row.EntityLabel),
		id(row.VacancyID),
		str(row.VacancyTitle),
		str(row.IP),
		str(row.UserAgent),
		metadata,
	}
	for i, v := range record {
		record[i] = guardFormula(v)
	}
	return record
}

// guardFormula defuses CSV injection: a cell a spreadsheet would read as a
// formula (= + - @, and the tab / carriage return variants) gets a leading '.
func guardFormula(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}
