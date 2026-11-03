package http

import (
	"errors"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"net/http"
	"strings"
)

type TeamHandler struct{ store vacancyteam.Store }

func NewTeamHandler(store vacancyteam.Store) *TeamHandler { return &TeamHandler{store} }
func (h *TeamHandler) Get(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetTeam(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}

// Write dispatches only the closed team action set registered by the router.
func (h *TeamHandler) Write(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cc, ok := requireCompanyContext(w, r)
		if !ok {
			return
		}
		id, ok := draftID(w, r)
		if !ok {
			return
		}
		body, ok := readDraftBody(w, r)
		if !ok {
			return
		}
		target := uuid.Nil
		if action == vacancyteam.Remove || action == vacancyteam.Deadline {
			var err error
			target, err = uuid.Parse(chi.URLParam(r, "user_id"))
			if err != nil || target == uuid.Nil {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
				return
			}
		}
		store, ok := h.store.(vacancyteam.WriteStore)
		if !ok {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
			return
		}
		keys := r.Header.Values("Idempotency-Key")
		tag, present := ifMatchHeader(r)
		result, err := store.WriteTeam(r.Context(), cc.CompanyID, cc.UserID, id, vacancyteam.Write{Action: action, Target: target, Key: strings.Join(keys, ","), KeyPresent: len(keys) > 0, IfMatch: tag, MatchPresent: present, Body: body})
		if err != nil {
			var rule vacancyteam.RuleError
			if errors.As(err, &rule) {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.Code(rule)))
			} else {
				writeDraftError(w, err)
			}
			return
		}
		if r.Method == http.MethodPost {
			replayed := result.Replayed
			writeDraftResult(w, 200, result, &replayed)
		} else {
			writeDraftResult(w, 200, result, nil)
		}
	}
}

// AssignmentHistory is company-scoped, not guarded by current vacancy access.
func (h *TeamHandler) AssignmentHistory(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	store, ok := h.store.(vacancyteam.AssignmentHistoryStore)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	result, err := store.GetAssignmentHistory(r.Context(), cc.CompanyID, cc.UserID, r.URL.Query().Get("cursor"))
	if errors.Is(err, vacancyteam.ErrInvalidCursor) {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
		return
	}
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}

func (h *TeamHandler) History(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetTeamHistory(r.Context(), cc.CompanyID, cc.UserID, id, r.URL.Query().Get("cursor"))
	if errors.Is(err, vacancyteam.ErrInvalidCursor) {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
		return
	}
	if err != nil {
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
