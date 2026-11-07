package http

import "net/http"

// Vacancies serves GET /v2/me/company/metrics/vacancies (§3.4).
func (h *Handler) Vacancies(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Vacancies(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// Reassignments serves GET /v2/me/company/metrics/reassignments (§3.4).
func (h *Handler) Reassignments(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	body, err := h.service.Reassignments(r.Context(), cc.CompanyID, r.URL.RawQuery)
	respond(w, body, err)
}

// Deliveries serves GET /v2/me/company/metrics/vacancies/{draftId}/deliveries
// (§3.5); a successful read is audited.
func (h *Handler) Deliveries(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	draft, ok := pathID(w, r, "draftId")
	if !ok {
		return
	}
	body, err := h.service.Deliveries(r.Context(), cc.CompanyID, cc.UserID, draft, r.URL.RawQuery)
	respond(w, body, err)
}

// Placements serves GET /v2/me/company/metrics/vacancies/{draftId}/placements
// (§3.5); a successful read is audited.
func (h *Handler) Placements(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	draft, ok := pathID(w, r, "draftId")
	if !ok {
		return
	}
	body, err := h.service.Placements(r.Context(), cc.CompanyID, cc.UserID, draft, r.URL.RawQuery)
	respond(w, body, err)
}
