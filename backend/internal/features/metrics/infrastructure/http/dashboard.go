package http

import (
	"context"
	"errors"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

// Company dashboard v2 sections (company-dashboard-v2 §3). The recruiter gate
// (owner, recruiter) runs in the router; the scope comes from the session's
// role: an owner sees the company, anyone else their own vacancies (DD1).

type dashboardSection[T any] func(ctx context.Context, company uuid.UUID, viewer app.Viewer, raw string) (T, error)

func serveDashboard[T any](section dashboardSection[T]) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cc, ok := companyContext(w, r)
		if !ok {
			return
		}
		viewer := app.Viewer{UserID: cc.UserID, Owner: cc.Role == valueobjects.OwnerRole}
		body, err := section(r.Context(), cc.CompanyID, viewer, r.URL.RawQuery)
		respond(w, body, err)
	}
}

// DashboardSummary serves GET /v2/me/company/dashboard/summary (§3.1).
func (h *Handler) DashboardSummary(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardSummary)(w, r)
}

// DashboardAttention serves GET /v2/me/company/dashboard/attention (§3.2).
func (h *Handler) DashboardAttention(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardAttention)(w, r)
}

// DashboardPipeline serves GET /v2/me/company/dashboard/pipeline (§3.3).
func (h *Handler) DashboardPipeline(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardPipeline)(w, r)
}

// DashboardVacancies serves GET /v2/me/company/dashboard/vacancies (§3.4).
func (h *Handler) DashboardVacancies(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardVacancies)(w, r)
}

// DashboardRecent serves GET /v2/me/company/dashboard/recent (§3.5).
func (h *Handler) DashboardRecent(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardRecent)(w, r)
}

// DashboardOrigin serves GET /v2/me/company/dashboard/origin (§3.5).
func (h *Handler) DashboardOrigin(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardOrigin)(w, r)
}

// Company dashboard lists (company-dashboard-v2 §5) under /dashboard/lists/
// (/dashboard/vacancies is the §3.4 section): the same scope from the role,
// not audited (DD4).

// DashboardCandidateList serves GET …/dashboard/lists/candidates.
func (h *Handler) DashboardCandidateList(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardCandidateList)(w, r)
}

// DashboardDeliveryList serves GET …/dashboard/lists/deliveries.
func (h *Handler) DashboardDeliveryList(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardDeliveryList)(w, r)
}

// DashboardVacancyList serves GET …/dashboard/lists/vacancies.
func (h *Handler) DashboardVacancyList(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardVacancyList)(w, r)
}

// DashboardApplicationList serves GET …/dashboard/lists/applications.
func (h *Handler) DashboardApplicationList(w http.ResponseWriter, r *http.Request) {
	serveDashboard(h.service.DashboardApplicationList)(w, r)
}

// DashboardExport serves GET …/dashboard/lists/{kind}/export, streamed like
// the metrics exports (every error before the first byte is JSON).
func (h *Handler) DashboardExport(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cc, ok := companyContext(w, r)
		if !ok {
			return
		}
		viewer := app.Viewer{UserID: cc.UserID, Owner: cc.Role == valueobjects.OwnerRole}
		export, err := h.service.DashboardExport(r.Context(), cc.CompanyID, viewer, kind, r.URL.RawQuery)
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
