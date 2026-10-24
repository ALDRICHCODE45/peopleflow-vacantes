package http

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dashboard"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"net/http"
)

type DashboardHandler struct{ service *dashboard.Service }

func NewDashboardHandler(service *dashboard.Service) *DashboardHandler {
	return &DashboardHandler{service: service}
}
func (h *DashboardHandler) Get(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	out, err := h.service.Read(r.Context(), cc.CompanyID, cc.UserID)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}
