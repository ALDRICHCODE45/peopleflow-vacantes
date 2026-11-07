package http

import "net/http"

// Summary serves GET /v2/me/company/metrics/summary (§3.1).
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Summary(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// Recruiters serves GET /v2/me/company/metrics/recruiters (§3.2).
func (h *Handler) Recruiters(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Recruiters(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// Recruiter serves GET /v2/me/company/metrics/recruiters/{userId} (§3.3).
func (h *Handler) Recruiter(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	user, ok := pathID(w, r, "userId")
	if !ok {
		return
	}
	body, err := h.service.Recruiter(r.Context(), cc.CompanyID, user, r.URL.RawQuery)
	respond(w, body, err)
}
