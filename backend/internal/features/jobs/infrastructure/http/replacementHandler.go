package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/replacement"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// ReplacementHandler serves the replacement process routes
// (docs/contracts/replacement-processes-v1.md, «Endpoints»).
type ReplacementHandler struct{ store replacement.Store }

func NewReplacementHandler(store replacement.Store) *ReplacementHandler {
	return &ReplacementHandler{store: store}
}

type ReplacementHandlers struct{ Start http.HandlerFunc }

func (h *ReplacementHandler) ReplacementHandlers() ReplacementHandlers {
	return ReplacementHandlers{Start: h.start}
}

// ReplacementHandlers serves the replacement routes from the lifecycle handler's
// store: Start finishes a closed-active source, so it is the same transactional
// adapter. A store that does not start replacements (a route-test fake) answers
// the generic 500, never a nil dereference.
func (h *LifecycleHandler) ReplacementHandlers() ReplacementHandlers {
	if h == nil {
		return NewReplacementHandler(nil).ReplacementHandlers()
	}
	store, _ := h.store.(replacement.Store)
	return NewReplacementHandler(store).ReplacementHandlers()
}

// start is POST /v2/me/company/job-drafts/{id}/replacements: 201 with the new
// process' lifecycle ETag and Location; a replayed key answers 201 again with
// Idempotency-Replayed: true.
func (h *ReplacementHandler) start(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	keys := r.Header.Values("Idempotency-Key")
	tag, present := ifMatchHeader(r)
	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}
	if h.store == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	result, err := h.store.StartReplacement(r.Context(), cc.CompanyID, cc.UserID, id, strings.Join(keys, ","), len(keys) > 0, tag, present, body)
	if err != nil {
		writeReplacementError(w, err)
		return
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(result.Body, &created); err != nil || created.ID == "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	w.Header().Set("Location", "/v2/me/company/job-drafts/"+created.ID)
	replayed := result.Replayed
	writeDraftResult(w, http.StatusCreated, result, &replayed)
}

func writeReplacementError(w http.ResponseWriter, err error) {
	var invalid *replacement.Invalid
	if errors.As(err, &invalid) {
		fields := make([]httpjson.ValidationField, len(invalid.Fields))
		for i, f := range invalid.Fields {
			fields[i] = httpjson.ValidationField{Field: f.Field, Code: f.Code}
		}
		httpjson.WriteValidationError(w, fields)
		return
	}
	var notClosed *replacement.SourceNotClosed
	if errors.As(err, &notClosed) {
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeReplacementSourceNotClosed), notClosed)
		return
	}
	var notLatest *replacement.SourceNotLatest
	if errors.As(err, &notLatest) {
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeReplacementSourceNotLatest), notLatest)
		return
	}
	var credits *replacement.CreditsInvalid
	if errors.As(err, &credits) {
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeReplacementCreditsInvalid), credits)
		return
	}
	var rule vacancyteam.RuleError
	if errors.As(err, &rule) {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.Code(rule)))
		return
	}
	// ReplacementAlreadyActive, stale/missing ETags, idempotency and draft errors.
	writeLifecycleError(w, err)
}
