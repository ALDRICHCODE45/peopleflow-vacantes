package http

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type placementCreditWriter interface {
	CorrectPlacementCredit(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, bool, string, bool, []byte) (drafts.Result, error)
}

func (h *TeamHandler) CorrectPlacementCredit(restore bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cc, ok := requireCompanyContext(w, r)
		if !ok {
			return
		}
		id, ok := draftID(w, r)
		if !ok {
			return
		}
		pid, err := uuid.Parse(chi.URLParam(r, "pid"))
		if err != nil {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
			return
		}
		cid, err := uuid.Parse(chi.URLParam(r, "credit_id"))
		if err != nil {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
			return
		}
		body, ok := readDraftBody(w, r)
		if !ok {
			return
		}
		store, ok := h.store.(placementCreditWriter)
		if !ok {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
			return
		}
		keys := r.Header.Values("Idempotency-Key")
		result, err := store.CorrectPlacementCredit(r.Context(), cc.CompanyID, cc.UserID, id, pid, cid, restore, strings.Join(keys, ","), len(keys) > 0, body)
		if err != nil {
			var rule vacancyteam.RuleError
			if errors.As(err, &rule) {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.Code(rule)))
			} else {
				writeDraftError(w, err)
			}
			return
		}
		replayed := result.Replayed
		writeDraftResult(w, 200, result, &replayed)
	}
}
