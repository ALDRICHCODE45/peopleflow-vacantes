// Package http exposes the jobs bounded-context HTTP handlers.
//
// The jobs slice exposes three endpoints:
//
//	GET  /jobs       — public search + filters + keyset pagination
//	GET  /jobs/{id}  — public detail
//	PATCH /jobs/{id} — gated write path (RequireAuth + RequireCompanyRole)
//
// The first two are mounted via the public `Routes()` accessor; the
// third is mounted on a per-method `r.With(...).Patch(...)` line in
// the composition root, mirroring the companies' `MemberHandlers()`
// split-mounting pattern (see
// backend/internal/features/companies/infrastructure/http/memberHandler.go).
//
// Wire format matches the design envelope exactly: list returns
// `{items: [...], next_cursor: string|null}`, detail returns the same
// item shape (Decision 4 + 5), and the editor view
// (JobEditorViewDto) carries `status` + `updated_at` plus the
// embedded `{company: {id, name}}`.
package http

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// JobHandler adapts the jobs use cases to the HTTP transport.
type JobHandler struct {
	service *usecases.JobService
}

// NewJobHandler builds the handler around the jobs use case. The
// dependency is the concrete `*JobService` (not an interface) to match
// the existing company handler convention; tests stand up the handler
// with a stub repository routed through `usecases.NewJobService`.
func NewJobHandler(service *usecases.JobService) *JobHandler {
	return &JobHandler{service: service}
}

// Routes returns the feature-scoped PUBLIC router, mounted under
// `/jobs`. Both routes are public — no `RequireAuth` middleware is
// applied; the spec scenario "GET / jobs is public" forbids auth here.
//
// The gated PATCH route lives OUTSIDE this mount: composition root
// uses `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}",
// jobHandlers.UpdateJob)` after pulling the handler out via
// `JobHandlers()`. The split is structural — a future refactor that
// adds the PATCH to `Routes()` would silently expose the write path
// to anonymous requests, which the route-boundary tests guard against.
func (h *JobHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.listJobs)
	r.Get("/{id}", h.getJob)
	return r
}

// JobHandlers exposes each endpoint as a public http.HandlerFunc so
// the composition root (cmd/api/main.go) can apply per-method
// middleware — specifically, the per-route RequireAuth + RequireCompanyRole
// gates for PATCH /jobs/{id} and POST /jobs. Mirrors MemberHandlers()
// in companies/.../memberHandler.go.
//
// Each field is a thin http.HandlerFunc adapter over the unexported
// method body; the unexported bodies stay in this file so the
// handler stays the single source of truth for endpoint logic.
type JobHandlers struct {
	ListJobs  http.HandlerFunc
	GetJob    http.HandlerFunc
	UpdateJob http.HandlerFunc
	CreateJob http.HandlerFunc
}

// JobHandlers returns the per-endpoint http.HandlerFunc surface for
// main.go to mount with per-method middleware.
func (h *JobHandler) JobHandlers() JobHandlers {
	return JobHandlers{
		ListJobs:  http.HandlerFunc(h.listJobs),
		GetJob:    http.HandlerFunc(h.getJob),
		UpdateJob: http.HandlerFunc(h.updateJob),
		CreateJob: http.HandlerFunc(h.createJob),
	}
}

// --- handlers ------------------------------------------------------------

// listJobs implements `GET /jobs`. It parses the query string into a
// `SearchJobsDto`, asks the use case to search, and writes the envelope.
//
// Every query param is treated as OPTIONAL + tolerant:
//   - unknown keys are silently ignored;
//   - `limit` is integer-parsed; non-integer values fall back to the
//     use case's default page size (20), no 400;
//   - `q/seniority/work_mode/employment_type/location/currency`
//     collapse to nil pointers in the use case (whitespace → nil);
//   - `cursor` is forwarded as raw string; the use case tolerantly
//     decodes a malformed cursor to "first page" (Decision 8).
func (h *JobHandler) listJobs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit, ok := parseLimit(q.Get("limit"))
	if !ok {
		_ = limit
	}

	in := dtos.SearchJobsDto{
		Q:              rawQ(q.Get("q")),
		Seniority:      rawQ(q.Get("seniority")),
		WorkMode:       rawQ(q.Get("work_mode")),
		EmploymentType: rawQ(q.Get("employment_type")),
		Location:       rawQ(q.Get("location")),
		SalaryCurrency: rawQ(q.Get("currency")),
		Cursor:         rawQ(q.Get("cursor")),
		Limit:          limit,
	}

	res, err := h.service.SearchJobs(r.Context(), in)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, res)
}

// getJob implements `GET /jobs/{id}`. The response body is the bare
// job (no envelope), which is the same shape a list item carries
// (Decision 4).
func (h *JobHandler) getJob(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "id")
	id, err := uuid.Parse(raw)
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	job, err := h.service.GetJobByID(r.Context(), id)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toDetailResponse(job))
}

// updateJob implements `PATCH /jobs/{id}` (design D6). It is mounted
// in main.go behind `r.With(requireAuth, requireRecruiter).Patch(...)`.
//
// Flow:
//  1. requireCompanyContext (fail-closed 500 if missing — a routing
//     misconfiguration must be loud, not a misleading 401).
//  2. Parse the path `{id}` as UUID (400 on malformed).
//  3. Decode the body as UpdateJobDto (400 on malformed JSON).
//  4. Parse `If-Unmodified-Since` (RFC 3339; absent/malformed → zero
//     time, which the use case treats as a CAS mismatch).
//  5. Invoke EditJob.
//  6. ErrConcurrencyConflict → write the editor view directly with 409
//     (the 409 body MUST be the same shape as a 200; design D6).
//  7. Else → classifyAndWriteError (the dispatcher covers 400/404/500).
//
// The handler is intentionally thin: the use case owns the
// validation, transition table, and CAS logic. The handler's only
// "smart" decisions are (a) the 500-on-missing-context fail-closed
// check, (b) the 409-with-view special-case (because classifyError
// alone would render a generic {"error":"conflict"} body).
func (h *JobHandler) updateJob(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	var in dtos.UpdateJobDto
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	ifUnmodifiedSince := parseIfUnmodifiedSince(r.Header.Get("If-Unmodified-Since"))

	view, err := h.service.EditJob(r.Context(), cc.CompanyID, id, in, ifUnmodifiedSince)
	if err != nil {
		if errors.Is(err, entities.ErrConcurrencyConflict) {
			// The 409 body MUST be the editor view of the latest row
			// (spec requirement: 409 body uses the same shape as 200).
			// We special-case this BEFORE classifyAndWriteError so the
			// generic {"error":"conflict"} envelope is not written.
			httpjson.WriteJSON(w, http.StatusConflict, view)
			return
		}
		h.classifyAndWriteError(w, r, err)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, view)
}

// createJob implements `POST /jobs` (design D9). It is mounted in
// main.go behind `r.With(requireAuth, requireRecruiter).Post(...)`.
//
// Flow:
//  1. requireCompanyContext (fail-closed 500 if missing -- same
//     invariant as updateJob; a routing misconfiguration must be
//     loud, not a misleading 401).
//  2. Decode the body as CreateJobDto (400 on malformed JSON).
//  3. Invoke CreateJob with the caller's CompanyID.
//  4. classifyAndWriteError on err (the dispatcher covers 400/409/500).
//  5. Success -> 201 + JobEditorViewDto.
//
// No path `{id}`, no `If-Unmodified-Since` parse -- create has no
// CAS. `company_id` comes exclusively from `requireCompanyContext`
// (the middleware injected `CompanyContext`); the DTO has no
// `company_id` field, so any body value is silently dropped by
// encoding/json (spec scenario "company_id from body is ignored").
func (h *JobHandler) createJob(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	var in dtos.CreateJobDto
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	view, err := h.service.CreateJob(r.Context(), cc.CompanyID, in)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}

	httpjson.WriteJSON(w, http.StatusCreated, view)
}

// --- classification & helpers -------------------------------------------

// classifyAndWriteError centralizes the ErrJobNotFound → 404 / any
// other → 500 mapping that both read handlers need. The real error
// is logged at error severity so an operator can correlate with the
// generic 5xx response the client sees. `classifyError` is the flat
// dispatcher that knows every domain sentinel the use cases can
// surface.
func (h *JobHandler) classifyAndWriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, msg := classifyError(err)
	if status == http.StatusInternalServerError {
		slog.Error("jobs handler failed", "method", r.Method, "path", r.URL.Path, "error", err)
	}
	httpjson.WriteError(w, status, msg)
}

// classifyError maps a use-case error into an HTTP status + a
// client-safe message. The dispatcher is a flat `errors.Is` chain:
//
//	ErrJobNotFound              → 404 "job not found"
//	ErrConcurrencyConflict      → 409 "conflict"          (fallback; updateJob writes view first)
//	ErrInvalidStatusTransition  → 400 "invalid status transition"
//	ErrCompanyNotActive         → 409 "company is not active"   (POST /jobs)
//	ErrCompanyGone              → 409 "company is gone"         (POST /jobs, defense-in-depth)
//	ErrEmptyTitle               → 400 "title must not be empty"
//	ErrEmptyDescription         → 400 "description must not be empty"
//	ErrInvalidSalaryRange       → 400 "salary_min must be less than or equal to salary_max"
//	ErrInvalidWorkMode          → 400 "invalid work_mode"
//	ErrInvalidEmploymentType    → 400 "invalid employment_type"
//	ErrInvalidSeniority         → 400 "invalid seniority"
//	ErrInvalidSalaryCurrency    → 400 "invalid salary_currency"
//	ErrInvalidJobStatus         → 400 "invalid status"
//	default                     → 500 "internal server error"
//
// Adding a new sentinel means adding one branch here; no other call
// site needs to change.
//
// Both ErrCompanyNotActive and ErrCompanyGone map to 409: the caller
// is already an admitted member (RequireCompanyRole resolved a real
// membership), so the reject is a server-side company-state conflict
// — never 403 (membership is fine) and never 404 (would leak
// company/row existence). ErrCompanyGone is unreachable and shares
// the 409 class with ErrCompanyNotActive (design D9 §6.2).
func classifyError(err error) (int, string) {
	switch {
	case errors.Is(err, entities.ErrJobNotFound):
		return http.StatusNotFound, "job not found"
	case errors.Is(err, entities.ErrConcurrencyConflict):
		return http.StatusConflict, "conflict"
	case errors.Is(err, entities.ErrInvalidStatusTransition):
		return http.StatusBadRequest, "invalid status transition"
	case errors.Is(err, entities.ErrCompanyNotActive):
		return http.StatusConflict, "company is not active"
	case errors.Is(err, entities.ErrCompanyGone):
		return http.StatusConflict, "company is gone"
	case errors.Is(err, entities.ErrEmptyTitle):
		return http.StatusBadRequest, "title must not be empty"
	case errors.Is(err, entities.ErrEmptyDescription):
		return http.StatusBadRequest, "description must not be empty"
	case errors.Is(err, entities.ErrInvalidSalaryRange):
		return http.StatusBadRequest, "salary_min must be less than or equal to salary_max"
	case errors.Is(err, valueobjects.ErrInvalidWorkMode):
		return http.StatusBadRequest, "invalid work_mode"
	case errors.Is(err, valueobjects.ErrInvalidEmploymentType):
		return http.StatusBadRequest, "invalid employment_type"
	case errors.Is(err, valueobjects.ErrInvalidSeniority):
		return http.StatusBadRequest, "invalid seniority"
	case errors.Is(err, valueobjects.ErrInvalidSalaryCurrency):
		return http.StatusBadRequest, "invalid salary_currency"
	case errors.Is(err, valueobjects.ErrInvalidJobStatus):
		return http.StatusBadRequest, "invalid status"
	default:
		return http.StatusInternalServerError, "internal server error"
	}
}

// requireCompanyContext reads the CompanyContext that
// RequireCompanyRole injected after resolving
// `sub → users.id → company_members` (design D6 — "resolves once").
// It is the entry guard for every gated handler in this file.
//
// If CompanyContext is missing from the request context, the handler
// has been reached without going through the middleware — a routing
// misconfiguration. We short-circuit fail-closed with 500 (NOT 401):
// a 401 would mislead the client into re-authenticating; the real
// failure is internal and should be loud. This mirrors the
// companies-side `requireCompanyContext` in memberHandler.go.
func requireCompanyContext(w http.ResponseWriter, r *http.Request) (identitysecurity.CompanyContext, bool) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok {
		httpjson.WriteError(w, http.StatusInternalServerError, "internal server error")
		return identitysecurity.CompanyContext{}, false
	}
	return cc, true
}

// parseIfUnmodifiedSince parses the `If-Unmodified-Since` header
// value as RFC 3339. Absent or malformed headers collapse to the
// zero `time.Time{}` so the use case's CAS compare sees a guaranteed
// mismatch (the row's real UpdatedAt can never equal zero time) —
// same outcome as a stale CAS, which is exactly the spec scenario
// "missing If-Unmodified-Since returns 409".
//
// We use `time.Parse(time.RFC3339, …)` (whole-second precision in the
// RFC spec) for INCOMING headers — Go's parser is the inverse of
// Go's RFC 3339Nano marshaler, so a CAS round-trip
// `client.Marshal → server.Parse → server.Cmp` is exact when the
// client uses `time.RFC3339Nano` (which Go's default `time.Time`
// MarshalJSON does).
func parseIfUnmodifiedSince(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return t
}

// parseLimit parses the `limit` query param into a non-negative int.
// Non-integer values produce (0, false) so the caller can fall back
// to the use case's default page size (20) without raising a 400 —
// spec scenario "unknown query param is ignored" applies: bad limit
// is just an unknown query value.
func parseLimit(raw string) (int, bool) {
	if raw == "" {
		return 0, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

// rawQ returns a *string pointing at the trimmed value, or nil when
// the param is absent or whitespace-only. The whitespace-collapse
// lives in the use case (optString); this helper just hands the raw
// payload through and avoids leaking empty strings to the use case's
// filters on the hot path.
func rawQ(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}

// toDetailResponse projects a domain `Job` into the wire shape
// shared with the list endpoint (`SearchJobsItem`). Putting both
// callers through the same projection keeps the wire shape stable
// across endpoints — a refactor that changes one shape must change
// the other.
func toDetailResponse(j *entities.Job) dtos.SearchJobsItem {
	return dtos.SearchJobsItem{
		ID:             j.ID.String(),
		Title:          j.Title,
		Description:    j.Description,
		WorkMode:       j.WorkMode.String(),
		EmploymentType: j.EmploymentType.String(),
		Seniority:      j.Seniority.String(),
		Location:       j.Location,
		SalaryMin:      j.SalaryMin,
		SalaryMax:      j.SalaryMax,
		SalaryCurrency: j.SalaryCurrency.String(),
		PublishedAt:    j.PublishedAt,
		Company: dtos.CompanyDto{
			ID:   j.Company.ID.String(),
			Name: j.Company.Name,
		},
	}
}
