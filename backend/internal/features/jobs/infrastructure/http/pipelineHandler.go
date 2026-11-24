package http

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
)

// PipelineHandler is thin transport over the pipeline store. Identity, error
// vocabulary, body budget and If-Match forwarding are shared with draft routes.
type PipelineHandler struct {
	store pipelineconfig.Store
}

func NewPipelineHandler(store pipelineconfig.Store) *PipelineHandler {
	return &PipelineHandler{store: store}
}

type PipelineHandlers struct {
	GetPipeline     http.HandlerFunc
	PutPipeline     http.HandlerFunc
	PreviewPipeline http.HandlerFunc
}

func (h *PipelineHandler) PipelineHandlers() PipelineHandlers {
	return PipelineHandlers{GetPipeline: h.getPipeline, PutPipeline: h.putPipeline, PreviewPipeline: h.previewPipeline}
}

func (h *PipelineHandler) getPipeline(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	result, err := h.store.GetPipeline(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		logPipelineFailure(r, err)
		writeDraftError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}

func writePipelineError(w http.ResponseWriter, err error) {
	var occupied *pipelineconfig.Occupied
	if errors.As(err, &occupied) {
		details := make([]httpjson.StageDetail, len(occupied.StageIDs))
		for i, id := range occupied.StageIDs {
			details[i] = httpjson.StageDetail{StageID: id}
		}
		httpjson.WriteColumnError(w, httpjson.Resolve(httpjson.CodeStageOccupied), details)
		return
	}
	if errors.Is(err, pipelineconfig.ErrImpactConfirmation) {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeImpactConfirmationRequired))
		return
	}
	writeDraftError(w, err)
}

// pipelineInternal reports whether writePipelineError answers err with 500.
func pipelineInternal(err error) bool {
	var occupied *pipelineconfig.Occupied
	var finished *lifecycle.ProcessFinished
	var geography *vacancygeo.Invalid
	if errors.As(err, &occupied) || errors.Is(err, pipelineconfig.ErrImpactConfirmation) || errors.As(err, &finished) || errors.As(err, &geography) {
		return false
	}
	return classifyDraftError(err).Status == http.StatusInternalServerError
}

// logPipelineFailure records the cause of a pipeline 500 so it is diagnosable
// (bugfix pipeline-preview-500). Bounded fields only, as the other handlers:
// request id, method, matched route pattern (never the raw URL) and code class,
// plus the Go error type and cause. A PostgreSQL error contributes only its
// SQLSTATE, never its message, which can echo submitted values; other causes in
// this path are pgx scan/driver or invariant errors that carry no row values.
// The response stays the generic catalog 500.
func logPipelineFailure(r *http.Request, err error) {
	if !pipelineInternal(err) {
		return
	}
	route := "unmatched"
	if rctx := chi.RouteContext(r.Context()); rctx != nil && rctx.RoutePattern() != "" {
		route = rctx.RoutePattern()
	}
	// A driver error logs only its SQLSTATE; any other cause logs its text.
	sqlstate, cause := "", err.Error()
	var pg interface{ SQLState() string }
	if errors.As(err, &pg) {
		sqlstate, cause = pg.SQLState(), ""
	}
	slog.ErrorContext(r.Context(), "pipeline handler failed",
		"request_id", chimw.GetReqID(r.Context()),
		"method", r.Method,
		"path", route,
		"code_class", string(httpjson.CodeInternalError),
		"error_type", fmt.Sprintf("%T", err),
		"sqlstate", sqlstate,
		"cause", cause,
	)
}

func (h *PipelineHandler) previewPipeline(w http.ResponseWriter, r *http.Request) {
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
	result, err := h.store.PreviewPipeline(r.Context(), cc.CompanyID, cc.UserID, id, body)
	if err != nil {
		logPipelineFailure(r, err)
		writePipelineError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusOK, result)
}

func (h *PipelineHandler) putPipeline(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	id, ok := draftID(w, r)
	if !ok {
		return
	}
	tag, present := ifMatchHeader(r)
	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}
	result, err := h.store.PutPipeline(r.Context(), cc.CompanyID, cc.UserID, id, tag, present, body)
	if err != nil {
		logPipelineFailure(r, err)
		writePipelineError(w, err)
		return
	}
	writeDraftResult(w, http.StatusOK, result, nil)
}
