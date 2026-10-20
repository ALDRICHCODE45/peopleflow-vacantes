// router.go owns chi router construction, middleware, health, and feature registrations;
// main.go stays the composition root, wiring via routerDeps.
package main

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	applicationshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http"
	movementhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/board"
	applicationsv2http "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/v2"
	candidateshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/http"
	cvshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/http/cvs"
	companieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/http"
	geohttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/http"
	geopostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/postgres"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
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
	requireAuth          func(http.Handler) http.Handler
	requireCandidate     func(http.Handler) http.Handler
	identityHandler      *identityhttp.CandidateIdentityHandler
	requireRecruiter     func(http.Handler) http.Handler
	requireOwner         func(http.Handler) http.Handler
	companyHandler       *companieshttp.CompanyHandler
	memberHandler        *companieshttp.MemberHandler
	candidateHandler     *candidateshttp.CandidateHandler
	publicJobsHandler    *jobshttp.PublicJobsHandler
	jobHandler           *jobshttp.JobHandler
	draftHandler         *jobshttp.DraftHandler
	draftV2Handler       *jobshttp.DraftV2Handler
	draftListHandler     *jobshttp.DraftListHandler
	pipelineHandler      *jobshttp.PipelineHandler
	substatesHandler     *jobshttp.SubstatesHandler
	deliveryHandler      *jobshttp.DeliveryHandler
	managementHandler    *jobshttp.ManagementHandler
	publicationHandler   *jobshttp.PublicationHandler
	requesterHandler     *jobshttp.RequesterHandler
	applicationHandler   *applicationshttp.ApplicationHandler
	cvHandler            *cvshttp.Handler
	participationHandler *applicationsv2http.Handler
	movementHandler      *movementhttp.Handler
	queries              *db.Queries
	pool                 health.Pinger
	readinessTimeout     time.Duration
	// httpMetrics = the no-op HTTP metrics default composed by the
	// composition root (main.go); RequestObservability also defaults the
	// completion logger to slog.Default() when nil. No exporter/endpoint.
	httpMetrics rtmetrics.HTTPMetrics
	// readinessLogger/readinessMetrics = the readiness-boundary observability
	// dependencies (Task 6.3, ws6c-4a); health.Readyz applies safe nil
	// defaults (slog.Default / no-op) when either is nil. The metrics value
	// is the shared no-op default composed by the composition root (main.go).
	// No exporter/endpoint.
	readinessLogger  *slog.Logger
	readinessMetrics rtmetrics.ReadinessMetrics
}

// newRouter builds the chi router: middleware, health, all feature registrations
// (exact multiset pinned by TestRouteTopology_ExactRegistrations).
func newRouter(d routerDeps) chi.Router {
	// A missing composition dependency fails closed, never grants candidate access.
	if d.requireCandidate == nil {
		d.requireCandidate = identityhttp.RequireCandidateRole(nil)
	}
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
	r.Get("/readyz", health.Readyz(d.pool, d.readinessTimeout, d.readinessLogger, d.readinessMetrics))

	// The ONLY industries registration (TestIndustriesRoute_SingleCanonicalRegistration).
	industrieshttp.RegisterRoutes(r, d.queries)
	// Public reference lookups stay outside authentication and NoStore groups.
	geohttp.RegisterRoutes(r, geopostgres.NewReader(d.queries))

	// GET /{id} is a public profile; POST behind RequireAuth (creator becomes owner).
	companyHandlers := d.companyHandler.CompanyHandlers()
	r.Get("/companies/{id}", companyHandlers.GetCompany)
	r.With(d.requireAuth).Post("/companies", companyHandlers.CreateCompany)

	// /jobs is the public-read job board (spec: "GET /jobs is public").
	r.Mount("/jobs", d.jobHandler.Routes())
	// Additive anonymous catalog. Deliberately outside private NoStore/auth groups.
	r.Get("/v2/jobs", d.publicJobsHandler.List)
	r.Get("/v2/jobs/{id}", d.publicJobsHandler.Get)
	r.Get("/v2/jobs/{id}/screening", d.publicJobsHandler.Screening)
	r.Group(func(r chi.Router) {
		r.Use(identityhttp.NoStore, d.requireAuth, d.requireCandidate)
		r.Get("/v2/me/cvs", d.cvHandler.List)
		r.Post("/v2/me/cvs", d.cvHandler.Upload)
		r.Patch("/v2/me/cvs/{id}", d.cvHandler.Rename)
		r.Delete("/v2/me/cvs/{id}", d.cvHandler.Remove)
		r.Get("/v2/me/cvs/{id}/file", d.cvHandler.File)
		r.Post("/v2/jobs/{id}/applications", d.participationHandler.Apply)
		r.Get("/v2/me/applications", d.participationHandler.List)
	})

	// Gated writes on the ROOT router (outside the public mount), each with
	// requireAuth + requireRecruiter (routing-split defense).
	jobHandlers := d.jobHandler.JobHandlers()
	r.With(d.requireAuth, d.requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)
	r.With(d.requireAuth, d.requireRecruiter).Post("/jobs", jobHandlers.CreateJob)
	r.With(d.requireAuth, d.requireRecruiter).Delete("/jobs/{id}", jobHandlers.SoftDeleteJob)

	r.Group(func(r chi.Router) {
		r.Use(identityhttp.NoStore, d.requireAuth)
		r.Get("/v2/me", d.identityHandler.Me)
		r.Post("/v2/me/candidate-account", d.identityHandler.CreateCandidateAccount)
	})

	// Applications — candidate apply (RequireAuth + live candidate) + recruiter pipeline
	// (requireAuth + requireRecruiter); ROOT router so /jobs mount never serves them.
	applicationHandlers := d.applicationHandler.ApplicationHandlers()
	// One mount with per-method gates: a recruiter-gated mount at this same
	// path would also intercept the candidate POST before its own middleware.
	r.Route("/jobs/{jobId}/applications", func(r chi.Router) {
		r.With(identityhttp.NoStore, d.requireAuth, d.requireCandidate).Post("/", applicationHandlers.ApplyToJob)
		r.With(d.requireAuth, d.requireRecruiter).Get("/", applicationHandlers.ListJobApplications)
		r.With(d.requireAuth, d.requireRecruiter).Get("/{id}", applicationHandlers.GetApplication)
		r.With(d.requireAuth, d.requireRecruiter).Patch("/{id}/transition", applicationHandlers.TransitionApplication)
	})

	// Candidate self-service: NoStore wraps even authentication failures.
	r.Group(func(r chi.Router) {
		r.Use(identityhttp.NoStore, d.requireAuth, d.requireCandidate)
		r.Mount("/me/profile", d.candidateHandler.Routes())
		r.Get("/me/applications", applicationHandlers.ListMyApplications)
	})

	// Company /me routes retain their existing authorization and status codes.
	r.Route("/me", func(r chi.Router) {
		r.Use(d.requireAuth)

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

	// Private vacancy drafts. Registered on the ROOT router (outside the /me
	// subtree) so the no-store middleware runs BEFORE the auth gates: a 401/403
	// produced by requireAuth/requireRecruiter must be as uncacheable as a
	// handler 404/412/428. The same requireAuth + requireRecruiter gates apply;
	// the finer owner-or-principal rule lives in the store, which collapses a
	// non-principal or foreign draft to 404 after the general gates.
	draftHandlers := d.draftHandler.DraftHandlers()
	r.Group(func(r chi.Router) {
		r.Use(jobshttp.NoStore, d.requireAuth, d.requireRecruiter)
		r.Post("/me/company/job-drafts", draftHandlers.CreateDraft)
		r.Get("/me/company/job-drafts/{id}", draftHandlers.GetDraft)
		r.Patch("/me/company/job-drafts/{id}", draftHandlers.SaveDraft)
	})
	// Schema-2 employer drafts use explicit v2 capabilities on the same store.
	// Keep NoStore before both gates, including their rejected responses.
	draftV2Handlers := d.draftV2Handler.DraftHandlers()
	pipelineHandlers := d.pipelineHandler.PipelineHandlers()
	substatesHandlers := d.substatesHandler.SubstatesHandlers()
	deliveryHandlers := d.deliveryHandler.DeliveryHandlers()
	managementHandlers := d.managementHandler.ManagementHandlers()
	publicationHandlers := d.publicationHandler.PublicationHandlers()
	r.Group(func(r chi.Router) {
		r.Use(jobshttp.NoStore, d.requireAuth, d.requireRecruiter)
		r.Post("/v2/me/company/job-drafts", draftV2Handlers.CreateDraft)
		// The list applies the same owner-or-principal rule in the store.
		r.Get("/v2/me/company/job-drafts", d.draftListHandler.ListDrafts)
		r.Get("/v2/me/company/job-drafts/{id}", draftV2Handlers.GetDraft)
		r.Patch("/v2/me/company/job-drafts/{id}", draftV2Handlers.SaveDraft)
		r.Get("/v2/me/company/job-drafts/{id}/board", d.movementHandler.Board)
		r.Post("/v2/me/company/job-drafts/{id}/participations/{pid}/moves", d.movementHandler.Move)
		r.Post("/v2/me/company/job-drafts/{id}/participations/{pid}/discard", d.movementHandler.Discard)
		r.Post("/v2/me/company/job-drafts/{id}/participations/{pid}/recover", d.movementHandler.Recover)
		r.Post("/v2/me/company/job-drafts/{id}/participations/{pid}/substate", d.movementHandler.SetSubstate)
		r.Get("/v2/me/company/job-drafts/{id}/participations/{pid}", d.movementHandler.Detail)
		r.Get("/v2/me/company/job-drafts/{id}/participations/{pid}/history", d.movementHandler.History)
		r.Get("/v2/me/company/job-drafts/{id}/participations/{pid}/cv", d.movementHandler.File)
		r.Get("/v2/me/company/job-drafts/{id}/pipeline", pipelineHandlers.GetPipeline)
		r.Put("/v2/me/company/job-drafts/{id}/pipeline", pipelineHandlers.PutPipeline)
		r.Post("/v2/me/company/job-drafts/{id}/pipeline/preview", pipelineHandlers.PreviewPipeline)
		r.Get("/v2/me/company/job-drafts/{id}/pipeline/substates", substatesHandlers.GetSubstates)
		r.Put("/v2/me/company/job-drafts/{id}/pipeline/substates", substatesHandlers.PutSubstates)
		r.Get("/v2/me/company/job-drafts/{id}/pipeline/delivery", deliveryHandlers.GetDelivery)
		r.Put("/v2/me/company/job-drafts/{id}/pipeline/delivery", deliveryHandlers.PutDelivery)
		r.Get("/v2/me/company/job-drafts/{id}/pipeline/delivery/status", deliveryHandlers.Status)
		r.Post("/v2/me/company/job-drafts/{id}/pipeline/delivery/preview", deliveryHandlers.Preview)
		r.Get("/v2/me/company/job-drafts/{id}/management", managementHandlers.GetManagement)
		r.Put("/v2/me/company/job-drafts/{id}/management", managementHandlers.PutManagement)
		r.Get("/v2/me/company/job-drafts/{id}/publication", publicationHandlers.GetPublication)
		r.Post("/v2/me/company/job-drafts/{id}/publication", publicationHandlers.Publish)
	})
	// Requester catalog (contract §7): private like the drafts, so NoStore runs
	// before both gates. The store re-checks user, company and membership.
	requesterHandlers := d.requesterHandler.RequesterHandlers()
	r.Group(func(r chi.Router) {
		r.Use(jobshttp.NoStore, d.requireAuth, d.requireRecruiter)
		r.Get("/me/company/requesters", requesterHandlers.ListRequesters)
		r.Post("/me/company/requesters", requesterHandlers.CreateRequester)
	})
	return r
}
