package http

import "net/http"

// Closures serves GET /v2/me/company/metrics/closures (v2 §4.2).
func (h *Handler) Closures(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Closures(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// Compliance serves GET /v2/me/company/metrics/compliance (v2 §4.3).
func (h *Handler) Compliance(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Compliance(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// Delays serves GET /v2/me/company/metrics/delays (v2 §4.5).
func (h *Handler) Delays(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Delays(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// Origin serves GET /v2/me/company/metrics/origin (v2 §4.6).
func (h *Handler) Origin(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Origin(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}
