// router.go owns chi router construction, middleware, health, and feature registrations;
// main.go stays the composition root, wiring via routerDeps.
package main

import (
	"net/http"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	applicationshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http"
	candidateshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/http"
	companieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/http"
	industrieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/industries/infrastructure/http"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/health"
	rtmetrics "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics"
	runtimemw "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// routerDeps = the composition root's explicit dependencies (gates built in main.go,
// handlers, health ports); no globals, no init().
type routerDeps struct {
	requireAuth        func(http.Handler) http.Handler
	requireRecruiter   func(http.Handler) http.Handler
	requireOwner       func(http.Handler) http.Handler
	companyHandler     *companieshttp.CompanyHandler
	memberHandler      *companieshttp.MemberHandler
	candidateHandler   *candidateshttp.CandidateHandler
	jobHandler         *jobshttp.JobHandler
	applicationHandler *applicationshttp.ApplicationHandler
	queries            *db.Queries
	pool               health.Pinger
	readinessTimeout   time.Duration
	// httpMetrics = the no-op HTTP metrics default composed by the
	// composition root (main.go); RequestObservability also defaults the
	// completion logger to slog.Default() when nil. No exporter/endpoint.
	httpMetrics rtmetrics.HTTPMetrics
}

// newRouter builds the chi router: middleware, health, all feature registrations
// (exact multiset pinned by TestRouteTopology_ExactRegistrations).
func newRouter(d routerDeps) chi.Router {
	r := chi.NewRouter()
	// Task 6.3 production wiring (design §8.3): RequestID runs FIRST (the
	// completion record's request_id is read from the request context, never
	// a second generated ID), RequestObservability wraps Recoverer/handlers
	// so each request emits exactly one structured completion record and one
	// bounded metrics observation. chi's legacy middleware.Logger is removed:
	// it duplicated per-request logging now owned by RequestObservability.
	r.Use(middleware.RequestID, runtimemw.RequestObservability(nil, d.httpMetrics), middleware.Recoverer)

	// Health (§8.1): static liveness; readiness pings once under the timeout.
	r.Get("/healthz", health.Healthz(d.pool))
	r.Get("/readyz", health.Readyz(d.pool, d.readinessTimeout))

	// The ONLY industries registration (TestIndustriesRoute_SingleCanonicalRegistration).
	industrieshttp.RegisterRoutes(r, d.queries)

	// GET /{id} is a public profile; POST behind RequireAuth (creator becomes owner).
	companyHandlers := d.companyHandler.CompanyHandlers()
	r.Get("/companies/{id}", companyHandlers.GetCompany)
	r.With(d.requireAuth).Post("/companies", companyHandlers.CreateCompany)

	// /jobs is the public-read job board (spec: "GET /jobs is public").
	r.Mount("/jobs", d.jobHandler.Routes())

	// Gated writes on the ROOT router (outside the public mount), each with
	// requireAuth + requireRecruiter (routing-split defense).
	jobHandlers := d.jobHandler.JobHandlers()
	r.With(d.requireAuth, d.requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)
	r.With(d.requireAuth, d.requireRecruiter).Post("/jobs", jobHandlers.CreateJob)
	r.With(d.requireAuth, d.requireRecruiter).Delete("/jobs/{id}", jobHandlers.SoftDeleteJob)

	// Applications — candidate apply (RequireAuth ONLY) + recruiter pipeline
	// (requireAuth + requireRecruiter); ROOT router so /jobs mount never serves them.
	applicationHandlers := d.applicationHandler.ApplicationHandlers()
	r.With(d.requireAuth).Post("/jobs/{jobId}/applications", applicationHandlers.ApplyToJob)
	r.With(d.requireAuth, d.requireRecruiter).Route("/jobs/{jobId}/applications", func(r chi.Router) {
		r.Get("/", applicationHandlers.ListJobApplications)
		r.Get("/{id}", applicationHandlers.GetApplication)
		r.Patch("/{id}/transition", applicationHandlers.TransitionApplication)
	})

	// /me/* authenticated slice: RequireAuth rejects invalid tokens pre-handler.
	r.Route("/me", func(r chi.Router) {
		r.Use(d.requireAuth)
		r.Mount("/profile", d.candidateHandler.Routes())
		// The candidate's own applications; identity resolves candidate_id
		// from the JWT sub (no IDOR).
		r.Get("/applications", applicationHandlers.ListMyApplications)

		// Membership gates: GET /company UNGATED by role (spec "non-member gets 404");
		// reads need recruiter; mutations owner. requireOwner reuses companyRepo as the
		// narrow CompanyLivenessRepository (tombstone gate).
		handlers := d.memberHandler.MemberHandlers()
		r.Get("/company", handlers.GetMyMembership)
		r.With(d.requireRecruiter).Get("/company/members", handlers.ListMembers)
		r.With(d.requireOwner).Post("/company/members", handlers.AddMember)
		r.With(d.requireOwner).Patch("/company/members/{id}", handlers.UpdateMemberRole)
		r.With(d.requireOwner).Delete("/company/members/{id}", handlers.RemoveMember)

		// Companies-write (WU6): owner-only, no shadowing mount.
		r.With(d.requireOwner).Patch("/company", companyHandlers.UpdateCompany)
		r.With(d.requireOwner).Delete("/company", companyHandlers.DeleteCompany)
	})
	return r
}
