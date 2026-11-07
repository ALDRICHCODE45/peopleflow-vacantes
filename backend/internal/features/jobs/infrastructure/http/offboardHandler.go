package http

import (
	"errors"
	"net/http"

	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// OffboardHandler adapts the membership endpoints spanning vacancy teams.
// The composition root keeps the existing owner middleware on all three.
type OffboardHandler struct{ store vacancyteam.OffboardStore }

func NewOffboardHandler(store vacancyteam.OffboardStore) *OffboardHandler {
	return &OffboardHandler{store: store}
}
func (h *OffboardHandler) Serve(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cc, ok := requireCompanyContext(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid member id"))
			return
		}
		if h == nil || h.store == nil {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
			return
		}
		if action == "remove" {
			if err := h.store.RemoveCompanyMember(r.Context(), cc.CompanyID, cc.UserID, id); err != nil {
				writeOffboardError(w, err)
				return
			}
			w.WriteHeader(204)
			return
		}
		if action == "preview" {
			result, err := h.store.PreviewOffboard(r.Context(), cc.CompanyID, cc.UserID, id)
			if err != nil {
				writeOffboardError(w, err)
				return
			}
			writeDraftResult(w, 200, result, nil)
			return
		}
		key, ok := requireIdempotencyKey(w, r)
		if !ok {
			return
		}
		body, ok := readDraftBody(w, r)
		if !ok {
			return
		}
		result, err := h.store.OffboardCompanyMember(r.Context(), cc.CompanyID, cc.UserID, id, key, true, body)
		if err != nil {
			writeOffboardError(w, err)
			return
		}
		writeDraftResult(w, 200, result, &result.Replayed)
	}
}
func writeOffboardError(w http.ResponseWriter, err error) {
	var vacancies *vacancyteam.OffboardVacanciesError
	if errors.As(err, &vacancies) {
		httpjson.WriteTeamOffboardVacancies(w, httpjson.Code(vacancies.Code), vacancies.Vacancies)
		return
	}
	switch {
	case errors.Is(err, companies.ErrMemberNotFound):
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeNotFound), "company member not found"))
		return
	case errors.Is(err, companies.ErrLastOwner):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeLastOwner))
		return
	}
	var rule vacancyteam.RuleError
	if errors.As(err, &rule) {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.Code(rule)))
		return
	}
	writeDraftError(w, err)
}
