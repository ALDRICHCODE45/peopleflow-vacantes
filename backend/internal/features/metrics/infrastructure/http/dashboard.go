package http

import (
	"context"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
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
