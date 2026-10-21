// Private vacancy draft HTTP adapter (T4).
//
// This file is the transport for the private draft slice:
//
//	POST  /me/company/job-drafts        -> createDraft
//	GET   /me/company/job-drafts/{id}   -> getDraft
//	PATCH /me/company/job-drafts/{id}   -> saveDraft
//
// The adapter is deliberately thin. It owns only the HTTP shape and never
// re-implements a store rule:
//
//   - identity comes solely from CompanyContext (never a client actor or
//     company id);
//   - the request body is capped with http.MaxBytesReader BEFORE it is read in
//     full, then forwarded as raw bytes to the store, which owns the strict
//     decode and the field budget;
//   - POST requires exactly one non-empty Idempotency-Key header line; the
//     header is read with Header.Values so a repeated line is never silently
//     collapsed to its first value;
//   - PATCH forwards the raw If-Match value and its presence flag verbatim —
//     the store owns parsing, 428-vs-400, and the after-authorization compare;
//   - the success body is the exact stored JSON bytes plus the stored ETag,
//     and Idempotency-Replayed is projected only for POST;
//   - every failure is a catalog envelope with no DTO or editor data.
//
// NoStore is the cache-header middleware. It runs BEFORE the auth and
// authorization gates so every private response — including a middleware
// rejection — carries Cache-Control: no-store; it is mounted only on these
// routes and never changes the public surface.
package http

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NoStore forces Cache-Control: no-store on the response before any downstream
// handler or gate runs. Because it writes the header before calling next, a
// 401/403/404/412/428 produced by an earlier-mounted gate is equally
// uncacheable. It is wired only onto the private draft routes.
func NoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// DraftHandler adapts the private-draft persistence port to the HTTP
// transport. It depends only on drafts.Store; the store owns authorization,
// preconditions, idempotency and audit.
type DraftHandler struct {
	store drafts.Store
}

// NewDraftHandler wires the handler around the draft store. The constructor
// performs no IO.
func NewDraftHandler(store drafts.Store) *DraftHandler {
	return &DraftHandler{store: store}
}

// DraftHandlers exposes each private endpoint as a public http.HandlerFunc so
// the composition root applies the no-store + auth middleware chain. Mirrors
// the JobHandlers / MemberHandlers accessor pattern.
type DraftHandlers struct {
	CreateDraft http.HandlerFunc
	GetDraft    http.HandlerFunc
	SaveDraft   http.HandlerFunc
}

// DraftHandlers returns the per-endpoint http.HandlerFunc surface.
func (h *DraftHandler) DraftHandlers() DraftHandlers {
	return DraftHandlers{
		CreateDraft: http.HandlerFunc(h.createDraft),
		GetDraft:    http.HandlerFunc(h.getDraft),
		SaveDraft:   http.HandlerFunc(h.saveDraft),
	}
}

// createDraft implements POST /me/company/job-drafts.
//
// Flow: CompanyContext (fail-closed 500) -> exactly one non-empty
// Idempotency-Key -> bounded raw body -> store.Create. Success is 201 with the
// stored Body/ETag and Idempotency-Replayed false or true.
func (h *DraftHandler) createDraft(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
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

	result, err := h.store.Create(r.Context(), cc.CompanyID, cc.UserID, key, body)
	if err != nil {
		writeDraftError(w, err)
		return
	}

	replayed := result.Replayed
	writeDraftResult(w, http.StatusCreated, result, &replayed)
}

// getDraft implements GET /me/company/job-drafts/{id}.
//
// Flow: CompanyContext -> lexical path UUID -> store.Get. Authorization and
// the owner-or-principal rule live in the store, which collapses missing,
// cross-company and non-principal drafts to NotFound.
func (h *DraftHandler) getDraft(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	id, ok := draftID(w, r)
	if !ok {
		return
	}

	result, err := h.store.Get(r.Context(), cc.CompanyID, cc.UserID, id)
	if err != nil {
		writeDraftError(w, err)
		return
	}

	writeDraftResult(w, http.StatusOK, result, nil)
}

// saveDraft implements PATCH /me/company/job-drafts/{id}.
//
// Flow: CompanyContext -> lexical path UUID -> raw If-Match + presence ->
// bounded raw body -> store.Save. The handler never parses or compares the
// precondition: the store evaluates authorization first, then 428/400, then
// the CAS 412, and only then decodes and writes.
func (h *DraftHandler) saveDraft(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	id, ok := draftID(w, r)
	if !ok {
		return
	}

	ifMatch, present := ifMatchHeader(r)

	body, ok := readDraftBody(w, r)
	if !ok {
		return
	}

	result, err := h.store.Save(r.Context(), cc.CompanyID, cc.UserID, id, ifMatch, present, body)
	if err != nil {
		writeDraftError(w, err)
		return
	}

	writeDraftResult(w, http.StatusOK, result, nil)
}

// --- header + body helpers ------------------------------------------------

// requireIdempotencyKey enforces the POST idempotency header discipline: the
// header must be present (missing is its own contract code), exactly one line,
// and non-empty. A present-but-empty value is distinct from a missing header,
// and a repeated header line is rejected instead of being silently collapsed
// to its first value. A non-empty value is forwarded verbatim; the store owns
// the UUID-shape check.
func requireIdempotencyKey(w http.ResponseWriter, r *http.Request) (string, bool) {
	values := r.Header.Values("Idempotency-Key")
	if len(values) == 0 {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeIdempotencyKeyRequired))
		return "", false
	}
	if len(values) != 1 || values[0] == "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidIdempotencyKey))
		return "", false
	}
	return values[0], true
}

// ifMatchHeader returns the raw If-Match value and whether the header was
// present at all. It deliberately never calls Header.Get: repeated header
// lines are joined with a comma so the store's precondition parser sees (and
// rejects) a list instead of silently trusting the first line. An absent
// header reports present=false, which the store projects as 428; a present but
// empty header reports present=true so it is projected as 400.
func ifMatchHeader(r *http.Request) (string, bool) {
	values := r.Header.Values("If-Match")
	if len(values) == 0 {
		return "", false
	}
	return strings.Join(values, ","), true
}

// draftID parses the lexical {id} path parameter into a UUID, writing the
// invalid_request catalog error on a malformed value.
func draftID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid draft id"))
		return uuid.Nil, false
	}
	return id, true
}

// readDraftBody reads the request body under the draft body budget. The budget
// is enforced while reading (http.MaxBytesReader), so an oversized body is
// rejected before the full payload is materialized and before the store is
// called; the handler never truncates — it rejects. Every other read failure
// is invalid_request.
func readDraftBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, draftinput.MaxBodyBytes))
	if err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
			return nil, false
		}
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return nil, false
	}
	return body, true
}

// writeDraftResult writes the exact stored JSON bytes plus the stored ETag.
// replayed is non-nil only for POST, which always projects
// Idempotency-Replayed true/false; GET and PATCH omit the header.
func writeDraftResult(w http.ResponseWriter, status int, result drafts.Result, replayed *bool) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", result.ETag)
	if replayed != nil {
		w.Header().Set("Idempotency-Replayed", strconv.FormatBool(*replayed))
	}
	w.WriteHeader(status)
	_, _ = w.Write(result.Body)
}

// writeDraftError projects a store sentinel through the closed catalog. No
// handler-local auxiliary record is emitted: the runtime request completion
// record already carries the request id and the catalog code_class for this
// response, so the server log gains no second, unbounded copy of the failure.
func writeDraftError(w http.ResponseWriter, err error) {
	var finished *lifecycle.ProcessFinished
	if errors.As(err, &finished) {
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeProcessFinished), finished)
		return
	}
	var geography *vacancygeo.Invalid
	if errors.As(err, &geography) {
		code := httpjson.CodeInvalidLocation
		if geography.Remote {
			code = httpjson.CodeInvalidRemoteScope
		}
		details := make([]httpjson.GeoDetail, 0, len(geography.Details))
		for _, d := range geography.Details {
			details = append(details, httpjson.GeoDetail{Field: d.Field, Reason: d.Reason})
		}
		httpjson.WriteGeoError(w, httpjson.Resolve(code), details)
		return
	}
	httpjson.WriteCatalogError(w, classifyDraftError(err))
}

// classifyDraftError is the flat errors.Is dispatcher over the drafts
// sentinels. Every mapped definition is a canonical catalog entry, so the
// response never carries a domain error string, a DTO or editor data.
func classifyDraftError(err error) httpjson.Definition {
	switch {
	case errors.Is(err, drafts.ErrUnauthenticated):
		return httpjson.Resolve(httpjson.CodeUnauthenticated)
	case errors.Is(err, drafts.ErrForbidden):
		return httpjson.Resolve(httpjson.CodeForbidden)
	case errors.Is(err, drafts.ErrCompanyInactive):
		return httpjson.Resolve(httpjson.CodeCompanyInactive)
	case errors.Is(err, drafts.ErrCompanyNotActive):
		return httpjson.Resolve(httpjson.CodeCompanyNotActive)
	case errors.Is(err, drafts.ErrNotFound):
		return httpjson.Resolve(httpjson.CodeNotFound)
	case errors.Is(err, drafts.ErrPayloadTooLarge):
		return httpjson.Resolve(httpjson.CodePayloadTooLarge)
	case errors.Is(err, drafts.ErrInvalidRequest):
		return httpjson.Resolve(httpjson.CodeInvalidRequest)
	case errors.Is(err, deliveryconfig.ErrNonBusinessDate):
		return httpjson.Resolve(httpjson.CodeNonBusinessDate)
	case errors.Is(err, pipelineconfig.ErrStructureLocked):
		return httpjson.Resolve(httpjson.CodeStageChangeRequiresEmptyPipeline)
	case errors.Is(err, pipelineconfig.ErrCutoffStageInUse):
		return httpjson.Resolve(httpjson.CodeCutoffStageInUse)
	case errors.Is(err, drafts.ErrValidation):
		return httpjson.Resolve(httpjson.CodeValidationError)
	case errors.Is(err, drafts.ErrEmptyPatch):
		return httpjson.Resolve(httpjson.CodeEmptyPatch)
	case errors.Is(err, drafts.ErrIdempotencyKeyRequired):
		return httpjson.Resolve(httpjson.CodeIdempotencyKeyRequired)
	case errors.Is(err, drafts.ErrInvalidIdempotencyKey):
		return httpjson.Resolve(httpjson.CodeInvalidIdempotencyKey)
	case errors.Is(err, drafts.ErrIdempotencyConflict):
		return httpjson.Resolve(httpjson.CodeIdempotencyConflict)
	case errors.Is(err, drafts.ErrPreconditionRequired):
		return httpjson.Resolve(httpjson.CodePreconditionRequired)
	case errors.Is(err, drafts.ErrVersionConflict):
		return httpjson.Resolve(httpjson.CodeVersionConflict)
	default:
		// Includes drafts.ErrVersionOverflow (a server invariant failure) and
		// every unexpected error: fail closed with the generic 500.
		return httpjson.Resolve(httpjson.CodeInternalError)
	}
}
