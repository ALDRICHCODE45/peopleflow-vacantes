// Package http exposes the applications bounded-context HTTP handlers.
//
// The slice exposes five endpoints, mounted via the per-method
// `ApplicationHandlers()` accessor so the composition root can apply
// per-route middleware (RequireAuth / RequireCompanyRole):
//
//	POST  /jobs/{jobId}/applications               → ApplyToJob
//	GET   /me/applications                         → ListMyApplications
//	GET   /jobs/{jobId}/applications               → ListJobApplications
//	GET   /jobs/{jobId}/applications/{id}          → GetApplication
//	PATCH /jobs/{jobId}/applications/{id}/transition → TransitionApplication
//
// Handlers are thin: `requireSub` (401) / `requireCompanyContext` (500
// fail-closed) → parse path/body (400) → invoke use case → classify via
// the flat `classifyApplicationError` errors.Is dispatcher. PII discipline
// (D12): cv_s3_key / anonymized_at NEVER appear in any DTO; the candidate
// snippet renders only `full_name` + `professional_title` +
// `years_of_experience`.
package http

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/dtos"
	applicationsusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/usecases"
	applicationsentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	applicationsvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// ApplicationHandler is the HTTP adapter for the applications use cases.
// It depends only on the application service; the persistence and
// identity ports are owned by the service.
type ApplicationHandler struct {
	service *applicationsusecases.ApplicationService
}

// NewApplicationHandler wires the handler around the applications service.
// Composition root (cmd/api/main.go) builds the service and passes it in;
// this constructor does no IO.
func NewApplicationHandler(service *applicationsusecases.ApplicationService) *ApplicationHandler {
	return &ApplicationHandler{service: service}
}

// ApplicationHandlers exposes each endpoint as a public http.HandlerFunc
// so the composition root can apply per-method middleware. Mirrors the
// `JobHandlers` / `MemberHandlers` accessor pattern.
type ApplicationHandlers struct {
	ApplyToJob            http.HandlerFunc
	ListMyApplications    http.HandlerFunc
	ListJobApplications   http.HandlerFunc
	GetApplication        http.HandlerFunc
	TransitionApplication http.HandlerFunc
}

// ApplicationHandlers returns the per-endpoint http.HandlerFunc surface
// for main.go to mount with per-method middleware.
func (h *ApplicationHandler) ApplicationHandlers() ApplicationHandlers {
	return ApplicationHandlers{
		ApplyToJob:            http.HandlerFunc(h.applyToJob),
		ListMyApplications:    http.HandlerFunc(h.listMyApplications),
		ListJobApplications:   http.HandlerFunc(h.listJobApplications),
		GetApplication:        http.HandlerFunc(h.getApplication),
		TransitionApplication: http.HandlerFunc(h.transitionApplication),
	}
}

// --- applyToJob ----------------------------------------------------------

// applyToJob implements POST /jobs/{jobId}/applications.
//
// Flow:
//  1. requireSub (401 on missing/blank JWT subject).
//  2. Parse {jobId} as UUID (400 on malformed).
//  3. Decode body as ApplyRequestDto (400 on invalid JSON).
//  4. Invoke ApplyJob.
//  5. classifyAndWriteError on err (404 / 409 / 400 / 500).
//  6. Success → 201 + ApplicationResponse.
//
// cv_s3_key and anonymized_at are intentionally absent from
// ApplicationResponse (D11) — the columns are reserved and the slice
// never exposes them.
func (h *ApplicationHandler) applyToJob(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireSub(w, r)
	if !ok {
		return
	}

	jobID, err := uuid.Parse(chi.URLParam(r, "jobId"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	var in dtos.ApplyRequestDto
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	app, err := h.service.ApplyJob(r.Context(), sub, jobID, in)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}

	httpjson.WriteJSON(w, http.StatusCreated, toApplicationResponse(app))
}

// --- listMyApplications --------------------------------------------------

// listMyApplications implements GET /me/applications.
//
// Flow:
//  1. requireSub (401).
//  2. ListMyApplications (resolves sub → candidateID internally).
//  3. Success → 200 + MyApplicationsResponse. Empty list → non-nil
//     empty `applications: []`.
func (h *ApplicationHandler) listMyApplications(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireSub(w, r)
	if !ok {
		return
	}

	apps, err := h.service.ListMyApplications(r.Context(), sub)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}

	out := make([]dtos.MyApplicationListItemDto, 0, len(apps))
	for _, a := range apps {
		out = append(out, toMyApplicationListItem(a))
	}
	httpjson.WriteJSON(w, http.StatusOK, dtos.MyApplicationsResponse{Applications: out})
}

// --- listJobApplications -------------------------------------------------

// listJobApplications implements GET /jobs/{jobId}/applications (recruiter).
//
// Flow:
//  1. requireCompanyContext (500 fail-closed on missing middleware).
//  2. Parse {jobId} as UUID (400).
//  3. ListApplicationsByJob → 404 on cross-company/non-existent
//     (ErrApplicationNotFound); 200 with non-nil empty array on
//     own-company zero applications.
//  4. Success → 200 + RecruiterApplicationsResponse.
func (h *ApplicationHandler) listJobApplications(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	jobID, err := uuid.Parse(chi.URLParam(r, "jobId"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	apps, err := h.service.ListApplicationsByJob(r.Context(), cc.CompanyID, jobID)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}

	out := make([]dtos.ApplicationListItemDto, 0, len(apps))
	for _, a := range apps {
		out = append(out, toApplicationListItem(a))
	}
	httpjson.WriteJSON(w, http.StatusOK, dtos.RecruiterApplicationsResponse{Applications: out})
}

// --- getApplication ------------------------------------------------------

// getApplication implements GET /jobs/{jobId}/applications/{id}.
//
// Flow:
//  1. requireCompanyContext.
//  2. Parse {jobId}, {id} as UUIDs (400 on malformed).
//  3. GetApplicationDetail → 404 on cross-company/non-existent/mismatched
//     job (ErrApplicationNotFound).
//  4. Success → 200 + ApplicationListItemDto (the same shape the list
//     endpoint returns, so clients reuse their parser).
func (h *ApplicationHandler) getApplication(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	jobID, err := uuid.Parse(chi.URLParam(r, "jobId"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	appID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid application id")
		return
	}

	app, err := h.service.GetApplicationDetail(r.Context(), cc.CompanyID, jobID, appID)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toApplicationListItem(*app))
}

// --- transitionApplication ----------------------------------------------

// transitionApplication implements PATCH /jobs/{jobId}/applications/{id}/transition.
//
// Flow:
//  1. requireCompanyContext.
//  2. Parse {jobId}, {id} as UUIDs (400).
//  3. Decode body as TransitionRequestDto (400 on invalid JSON).
//  4. TransitionApplication — request-first validation, then matrix,
//     then guarded write.
//  5. Success → 200 + ApplicationResponse (updated row).
func (h *ApplicationHandler) transitionApplication(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}

	jobID, err := uuid.Parse(chi.URLParam(r, "jobId"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	appID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid application id")
		return
	}

	var in dtos.TransitionRequestDto
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	app, err := h.service.TransitionApplication(r.Context(), cc.CompanyID, cc.UserID, jobID, appID, in)
	if err != nil {
		h.classifyAndWriteError(w, r, err)
		return
	}

	httpjson.WriteJSON(w, http.StatusOK, toApplicationResponse(app))
}

// --- classification & helpers -------------------------------------------

// classifyAndWriteError centralizes the error → HTTP mapping for every
// handler. The real error is logged at error severity when the
// classifier lands on 500 so an operator can correlate with the
// generic 5xx response the client sees.
func (h *ApplicationHandler) classifyAndWriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, msg := classifyApplicationError(err)
	if status == http.StatusInternalServerError {
		slog.Error("applications handler failed", "method", r.Method, "path", r.URL.Path, "error", err)
	}
	httpjson.WriteError(w, status, msg)
}

// classifyApplicationError is the flat errors.Is dispatcher for every
// domain sentinel the use cases can surface. The mapping table mirrors
// the design §3 D9 classifier exactly:
//
//	ErrUnknownSubject                → 401 "unauthenticated"
//	ErrApplicationNotFound           → 404 "application not found"
//	ErrJobNotApplicable              → 404 "job not applicable"
//	ErrAlreadyApplied                → 409 "already applied"
//	ErrStatusRequired                → 400 "status is required"
//	ErrInvalidStatusTransition       → 400 err.Error()  (the
//	                                              unwrapped "invalid
//	                                              status transition"
//	                                              or the wrapped
//	                                              "<from> -> <to>"
//	                                              form)
//	ErrCoverLetterEmpty              → 400 "cover_letter must not be empty"
//	ErrCoverLetterTooLong            → 400 "cover_letter must be at most 2000 characters"
//	ErrInvalidSource                 → 400 "invalid source"
//	ErrInvalidApplicationReference   → 400 "invalid application reference"
//	ErrMissingActorIdentity          → 500 "internal server error" (fail-closed:
//	                                              no status change, no event)
//	default                          → 500 "internal server error"
func classifyApplicationError(err error) (int, string) {
	switch {
	case errors.Is(err, applicationsusecases.ErrUnknownSubject):
		return http.StatusUnauthorized, "unauthenticated"
	case errors.Is(err, applicationsentities.ErrApplicationNotFound):
		return http.StatusNotFound, "application not found"
	case errors.Is(err, applicationsentities.ErrJobNotApplicable):
		return http.StatusNotFound, "job not applicable"
	case errors.Is(err, applicationsentities.ErrAlreadyApplied):
		return http.StatusConflict, "already applied"
	case errors.Is(err, applicationsentities.ErrStatusRequired):
		return http.StatusBadRequest, "status is required"
	case errors.Is(err, applicationsvalueobjects.ErrInvalidStatusTransition):
		// Render err.Error() directly: the unwrapped sentinel message is
		// "invalid status transition" (unknown parse); the wrapped form is
		// "invalid status transition: <from> -> <to>" (illegal matrix).
		// Both are spec-mandated body shapes.
		return http.StatusBadRequest, err.Error()
	case errors.Is(err, applicationsentities.ErrCoverLetterEmpty):
		return http.StatusBadRequest, "cover_letter must not be empty"
	case errors.Is(err, applicationsentities.ErrCoverLetterTooLong):
		return http.StatusBadRequest, "cover_letter must be at most 2000 characters"
	case errors.Is(err, applicationsvalueobjects.ErrInvalidSource):
		return http.StatusBadRequest, "invalid source"
	case errors.Is(err, applicationsentities.ErrInvalidApplicationReference):
		return http.StatusBadRequest, "invalid application reference"
	case errors.Is(err, applicationsusecases.ErrMissingActorIdentity):
		// Fail-closed 500: a missing CompanyContext.UserID must never
		// surface as 4xx (no existence leak) and never write (D8).
		return http.StatusInternalServerError, "internal server error"
	default:
		return http.StatusInternalServerError, "internal server error"
	}
}

// requireSub extracts the JWT subject from the request context. Mirrors
// the candidates-side implementation; sources are unexported in the
// identity http package so a little copying is better than a dependency.
// Returns (sub, true) on success, writes 401 and returns ("", false)
// otherwise.
func requireSub(w http.ResponseWriter, r *http.Request) (string, bool) {
	claims := identitysecurity.ClaimsFromContext(r.Context())
	if claims.Subject == "" {
		httpjson.WriteError(w, http.StatusUnauthorized, "unauthenticated")
		return "", false
	}
	return claims.Subject, true
}

// requireCompanyContext reads the CompanyContext that RequireCompanyRole
// injected after resolving sub → users.id → company_members. Fail-closed
// 500 if the middleware was bypassed (mirrors the jobs handler).
func requireCompanyContext(w http.ResponseWriter, r *http.Request) (identitysecurity.CompanyContext, bool) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok {
		httpjson.WriteError(w, http.StatusInternalServerError, "internal server error")
		return identitysecurity.CompanyContext{}, false
	}
	return cc, true
}

// --- projections ---------------------------------------------------------

// toApplicationResponse projects a domain Application into the wire shape
// shared with POST /jobs/{jobId}/applications (201) and PATCH
// /jobs/{jobId}/applications/{id}/transition (200). cv_s3_key and
// anonymized_at are intentionally absent (D11).
func toApplicationResponse(a *applicationsentities.Application) dtos.ApplicationResponse {
	return dtos.ApplicationResponse{
		ID:          a.ID.String(),
		JobID:       a.JobID.String(),
		CandidateID: a.CandidateID.String(),
		Status:      a.Status.String(),
		Source:      applicationSourcePtrToString(a.Source),
		CoverLetter: a.CoverLetter,
		CreatedAt:   a.CreatedAt,
		UpdatedAt:   a.UpdatedAt,
	}
}

// toApplicationListItem projects a domain ApplicationWithCandidate into
// the recruiter list/detail wire shape. The embedded `candidate`
// snippet is the PII-minimized projection (D12).
func toApplicationListItem(a applicationsentities.ApplicationWithCandidate) dtos.ApplicationListItemDto {
	return dtos.ApplicationListItemDto{
		ID:          a.ID.String(),
		JobID:       a.JobID.String(),
		CandidateID: a.CandidateID.String(),
		Status:      a.Status.String(),
		Source:      applicationSourcePtrToString(a.Source),
		CoverLetter: a.CoverLetter,
		CreatedAt:   a.CreatedAt,
		UpdatedAt:   a.UpdatedAt,
		Candidate:   toCandidateSnippetDto(a.Candidate),
	}
}

// toMyApplicationListItem projects a domain MyApplication into the
// candidate's /me/applications wire shape. NO candidate_id field (the
// caller is the candidate) — only the job summary carries the
// cross-reference.
func toMyApplicationListItem(a applicationsentities.MyApplication) dtos.MyApplicationListItemDto {
	return dtos.MyApplicationListItemDto{
		ID:          a.ID.String(),
		JobID:       a.JobID.String(),
		Status:      a.Status.String(),
		Source:      applicationSourcePtrToString(a.Source),
		CoverLetter: a.CoverLetter,
		CreatedAt:   a.CreatedAt,
		UpdatedAt:   a.UpdatedAt,
		Job: dtos.JobSummaryDto{
			ID:    a.Job.ID.String(),
			Title: a.Job.Title,
			Company: dtos.CompanySummaryDto{
				ID:   a.Job.CompanyID.String(),
				Name: a.Job.CompanyName,
			},
		},
	}
}

// toCandidateSnippetDto projects the PII-minimized snippet. NO salary,
// birth_date, phone, email, skills, languages, expected_salary,
// education_level, city, address, or bio.
func toCandidateSnippetDto(s applicationsentities.CandidateSnippet) dtos.CandidateSnippetDto {
	return dtos.CandidateSnippetDto{
		UserID:            s.UserID.String(),
		FullName:          s.FullName,
		ProfessionalTitle: s.ProfessionalTitle,
		YearsOfExperience: s.YearsOfExperience,
	}
}

// applicationSourcePtrToString folds a `*ApplicationSource` into a
// `*string` for the wire shape. nil → nil (renders `null`); non-nil →
// &canonical.
func applicationSourcePtrToString(s *applicationsvalueobjects.ApplicationSource) *string {
	if s == nil {
		return nil
	}
	v := s.String()
	return &v
}
