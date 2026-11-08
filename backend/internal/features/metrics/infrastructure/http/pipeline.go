package http

import "net/http"

// Pipeline section, candidates list and applications list of
// stakeholder-metrics-v2 §4.4, §5.5 and §5.6.

// Pipeline serves GET /v2/me/company/metrics/pipeline (v2 §4.4).
func (h *Handler) Pipeline(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Pipeline(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// CandidateList serves GET /v2/me/company/metrics/candidates (v2 §5.5); each
// successful page is audited before it is served.
func (h *Handler) CandidateList(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.ListCandidates(r.Context(), cc.CompanyID, cc.UserID, r.URL.RawQuery)
	respond(w, body, err)
}

// ApplicationList serves GET /v2/me/company/metrics/applications (v2 §5.6).
func (h *Handler) ApplicationList(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.ListApplications(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}
