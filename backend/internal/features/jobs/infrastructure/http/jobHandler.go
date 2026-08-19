// Package http exposes the jobs bounded-context HTTP handlers.
//
// The jobs slice is read-only: the only public endpoints are
// `GET /jobs` (search + filters + keyset pagination) and
// `GET /jobs/{id}` (detail). Both routes are PUBLIC — no auth
// middleware is layered in here; an `Authorization` header is ignored
// per the spec scenario "GET /jobs is public".
//
// Wire format matches the design envelope exactly: the list endpoint
// returns `{items: [...], next_cursor: string|null}` and the detail
// endpoint returns the same item shape (Decision 4 + 5). Invalid or
// unknown query params are silently ignored (spec scenarios "unknown
// query param is ignored" / "invalid filter value is ignored"); the
// underlying `websearch_to_tsquery` is a safe parser so a malformed
// `q` is also tolerated (spec scenario "malformed q does not 500").
package http

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
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

// Routes returns the feature-scoped router, mounted under `/jobs`.
// Both routes are public — no `RequireAuth` middleware is applied;
// the spec scenario "GET /jobs is public" forbids auth here.
func (h *JobHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.listJobs)
	r.Get("/{id}", h.getJob)
	return r
}

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
		// Spec: bad input is silently ignored, no 400. Let the use
		// case handle the zero-default.
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
// (Decision 4). The detail endpoint reuses `SearchJobsItem` so list
// and detail share one wire shape.
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

// classifyAndWriteError centralizes the ErrJobNotFound → 404 /
// any-other → 500 mapping that both handlers need. The real error
// is logged at error severity so an operator can correlate with the
// generic 5xx response the client sees.
func (h *JobHandler) classifyAndWriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, msg := classifyError(err)
	if status == http.StatusInternalServerError {
		slog.Error("jobs handler failed", "method", r.Method, "path", r.URL.Path, "error", err)
	}
	httpjson.WriteError(w, status, msg)
}

// classifyError maps a use-case error into an HTTP status + a
// client-safe message. `ErrJobNotFound` is the only domain sentinel
// 4xx the read path can produce (the visibility rule is enforced in
// SQL, so even draft/closed/soft-deleted/non-active-company rows
// surface as ErrJobNotFound, not 400). Anything else is a 500.
func classifyError(err error) (int, string) {
	if errors.Is(err, entities.ErrJobNotFound) {
		return http.StatusNotFound, "job not found"
	}
	return http.StatusInternalServerError, "internal server error"
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
