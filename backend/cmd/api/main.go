// Package main is the composition root for the API server: it wires together
// configuration, the Postgres connection pool, the JWT auth middleware, and
// the HTTP router.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	applicationsusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/usecases"
	applicationshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http"
	applicationspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	candidatesusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/usecases"
	candidateshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/http"
	candidatespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	industrieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/industries/infrastructure/http"
	jobsusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	jobspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/health"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/server"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	if err := run(); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	// Local dev convenience: load .env from the working directory. godotenv.Load
	// returns an error if .env is absent, which is the correct behavior in
	// production (env vars are injected by ECS). In dev, the missing-file error
	// is ignored so the binary still runs against a real environment when needed.
	_ = godotenv.Load()

	// WS5C (task 5.3): verifier ONLY via the WS5A explicit factory; bad
	// IDENTITY_JWT_* config aborts startup (no deny-all fallback).
	verifier, verifierErr := auth.NewVerifierConfigFromEnv(os.Getenv, auth.NewJWKSVerifier)
	if verifierErr != nil {
		return fmt.Errorf("identity verifier configuration: %w", verifierErr)
	}
	// run() owns the verifier: on every return path, Close cancels the
	// verifier-owned JWKS lifecycle context and awaits in-flight refresh work.
	if closer, ok := verifier.(interface{ Close() }); ok {
		defer closer.Close()
	}
	slog.Info("identity verifier ready")

	// Root context cancelled on SIGINT/SIGTERM. This is the graceful shutdown trigger.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}

	// Connection pool: pgx manages a set of reusable connections, not a single one.
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	// Fail fast: prove we can reach Postgres before we start serving traffic.
	if err := pool.Ping(ctx); err != nil {
		return err
	}
	slog.Info("connected to postgres")

	// sqlc data layer wired to the pool.
	queries := db.New(pool)

	// Identity wiring: the postgres adapter for repositories.UserRepository.
	// The candidates use case needs GetByCognitoSub to resolve the JWT
	// subject to a stable users.id (IDOR-resistant boundary).
	identityUserRepo := identitypostgres.NewUserRepository(queries)

	// Stateless audit adapter (companies-audit WU2 / design D4 hoist).
	// The companies slice now also takes the audit adapter as the
	// second constructor argument so the write paths can co-write the
	// CompaniesUpdated / CompaniesDeleted events inside the same
	// pgx.Tx as the domain write. `auditRepo` MUST be constructed
	// before `companyRepo` (it was previously constructed down by
	// the applications wiring block); the applications wiring block
	// below now references the hoisted variable.
	auditRepo := auditpostgres.NewAuditEventRepository()

	// Feature wiring: companies (adapter -> use case -> handler).
	// The bootstrap repository opens the transaction that creates a company
	// AND its founding owner atomically (business rule: the creator is owner).
	//
	// Companies-write WU3 (design D15): NewCompanyRepository now takes the
	// pool, not a *db.Queries handle — the adapter is pool-owning so the
	// write paths (`UpdateCompany`, `SoftDeleteCompany`) can open their own
	// pgx.Tx for the inline close. The read paths borrow `db.New(r.pool)`
	// per call (semantically identical to the pre-WU3 `*db.Queries` shape).
	//
	// companies-audit WU2 (design D4): the constructor now also takes the
	// stateless audit adapter as the second argument; the audit append
	// runs inside the same `pgx.Tx` as the domain write (fail-closed
	// co-write). The `auditRepo` declaration was HOISTED above this
	// block (it used to live down by the applications wiring block)
	// so the constructor call has the variable in scope. The
	// applications wiring block continues to reference the same
	// `auditRepo` variable.
	companyRepo := postgres.NewCompanyRepository(pool, auditRepo)
	companyBootstrapRepo := postgres.NewCompanyBootstrapRepository(pool)
	companyService := usecases.NewCompanyServiceWithBootstrap(companyRepo, identityUserRepo, companyBootstrapRepo)
	companyHandler := companieshttp.NewCompanyHandler(companyService)

	// Feature wiring: company_members (adapter -> use case -> handler).
	// The membership service needs the same identity user repo as the
	// candidates slice so it can resolve the JWT subject per request
	// (design D6 — IDOR-resistant boundary). The companies repo is the
	// existing one above; the member handler's GetMyMembership fetches
	// the company record through it.
	memberRepo := postgres.NewCompanyMemberRepository(queries)
	memberService := usecases.NewCompanyMemberService(memberRepo, identityUserRepo, companyRepo)
	memberHandler := companieshttp.NewMemberHandler(memberService)

	// Candidates wiring: candidates repo (pgxpool for the atomic
	// language-replace tx) -> service (uses identity user repo) ->
	// handler (reads JWT subject from context).
	candidateRepo := candidatespostgres.NewCandidateRepository(pool)
	candidateService := candidatesusecases.NewCandidateService(candidateRepo, identityUserRepo)
	candidateHandler := candidateshttp.NewCandidateHandler(candidateService)

	// Jobs wiring: jobs repo (sqlc data layer over the same pool)
	// -> service -> handler. Public read slice — no identity user
	// repo, no JWT context, no RequireAuth (spec scenario "GET /jobs
	// is public"). The repo takes the *db.Queries handle, not the
	// raw pool, because the jobs read path is pure sqlc — no
	// candidate-style atomic-replace transaction is needed for a
	// read-only slice.
	jobRepo := jobspostgres.NewJobRepository(queries)
	jobService := jobsusecases.NewJobService(jobRepo)
	jobHandler := jobshttp.NewJobHandler(jobService)

	// Applications wiring: the pool-owning applications repo (D5/D9) +
	// the stateless audit adapter (already constructed above, before
	// the companies wiring block so the `companyRepo` constructor
	// could take it as its second arg — companies-audit WU2 / D4
	// hoist). Create/Transition open their own pool.Begin and co-write
	// the application write + the audit event append atomically
	// (fail-closed: an audit failure rolls the write back). The
	// service uses the identity user repo for the cognitoSub →
	// users.id resolution seam; the handler's per-method accessor
	// lets the composition root gate candidate-apply and recruiter
	// routes differently.
	applicationRepo := applicationspostgres.NewApplicationRepository(pool, auditRepo)
	applicationService := applicationsusecases.NewApplicationService(applicationRepo, identityUserRepo)
	applicationHandler := applicationshttp.NewApplicationHandler(applicationService)
	applicationHandlers := applicationHandler.ApplicationHandlers()

	// Phase 6 D8 hoist: requireAuth + requireRecruiter are now used by
	// BOTH the /me/* subtree AND the jobs write route (PATCH /jobs/{id}),
	// so they're hoisted to run() scope. requireOwner stays local to the
	// /me block (only used by member-mutation routes).
	//
	// require-company-role-tombstone-gate slice: the same postgres
	// `*companyRepo` is reused as the narrow `CompanyLivenessRepository`
	// (`IsCompanyLive(ctx, companyID) (bool, error)`); the gate runs
	// after membership resolution and before role comparison so a
	// tombstoned or missing company returns 403 with reason
	// "company is inactive" before the handler runs. The same hoisted
	// instance is consumed at both `RequireCompanyRole` call sites
	// (`requireRecruiter` + `requireOwner`).
	requireAuth := identityhttp.RequireAuth(verifier)
	requireRecruiter := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, companyRepo, valueobjects.RecruiterRole)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Typed runtime configuration (WS6B-1a): conservative hardening
	// timeouts; server.New validates that every one of them is positive.
	cfg := runtimeconfig.DefaultServerConfig(":" + port)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Health composition (WS6B-1b, design §8.1): liveness is a static 200
	// that never touches the DB port; readiness pings the pool once under
	// the shorter configured readiness timeout and answers the catalog
	// service_unavailable 503 envelope on failure. The pool satisfies the
	// narrow health.Pinger port.
	r.Get("/healthz", health.Healthz(pool))
	r.Get("/readyz", health.Readyz(pool, cfg.ReadinessTimeout))

	// GET /industries — the ONLY industries registration: it goes through
	// the production-owned registrar, guarded by
	// TestIndustriesRoute_SingleCanonicalRegistration.

	// /companies is split across two auth planes because its two verbs have
	// different visibility:
	//   - GET  /companies/{id} — public profile (candidate-facing), like GET /jobs.
	//   - POST /companies       — authenticated: the creator becomes owner, so the
	//                             handler needs the JWT subject.
	// Because CompanyHandler.Routes() mounts both verbs under one subrouter,
	// we split them here so GET stays public while POST sits behind RequireAuth.
	{
		companyHandlers := companyHandler.CompanyHandlers()
		// Public read slice: the bare {id} lookup (candidate-facing).
		r.Get("/companies/{id}", companyHandlers.GetCompany)
		// Authenticated write: RequireAuth injects Claims the createCompany
		// handler reads to resolve the subject → users.id.
		r.With(identityhttp.RequireAuth(verifier)).Post("/companies", companyHandlers.CreateCompany)
	}
	industrieshttp.RegisterRoutes(r, queries)

	// /jobs is the public-read job board. Both routes (GET /jobs and
	// GET /jobs/{id}) are reachable WITHOUT authentication: the spec
	// scenario "GET /jobs is public" forbids auth here, so this mount
	// lives outside the /me/* RequireAuth subtree.
	r.Mount("/jobs", jobHandler.Routes())

	// Phase 6 D8: gated write path for PATCH /jobs/{id}. The route is
	// mounted on the ROOT router (outside the public /jobs mount) so a
	// future refactor that adds the PATCH to `Routes()` cannot silently
	// expose the write path. The route shares `/jobs/{id}` with the
	// public GET — chi routes by method, so GET hits the public mount
	// and PATCH hits this gated line.
	jobHandlers := jobHandler.JobHandlers()
	r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)

	// Phase 6 D9 (jobs-create): gated create path for POST /jobs. The
	// route is mounted on the ROOT router (outside the public /jobs
	// mount) for the same reason as the PATCH: a future refactor that
	// adds the POST to `Routes()` cannot silently expose the write
	// path. The AST guard TestJobsCreateRoute_MountedBehindGates pins
	// both `requireAuth` AND `requireRecruiter` on this line; the public
	// /jobs mount stays GET-only (same routing-split defense as PATCH).
	r.With(requireAuth, requireRecruiter).Post("/jobs", jobHandlers.CreateJob)

	// jobs-soft-delete slice: gated soft-delete path for DELETE
	// /jobs/{id}. The route is mounted on the ROOT router (outside the
	// public /jobs mount) for the same reason as PATCH/POST: a future
	// refactor that adds the DELETE to `Routes()` cannot silently
	// expose the write path. The AST guard
	// TestJobsSoftDeleteRoute_MountedBehindGates pins both
	// `requireAuth` AND `requireRecruiter` on this line; the public
	// /jobs mount stays GET-only (same routing-split defense as PATCH
	// and POST). The handler returns 204 No Content on success and
	// 409 + editor view on stale/missing/malformed CAS (design D4/D8).
	r.With(requireAuth, requireRecruiter).Delete("/jobs/{id}", jobHandlers.SoftDeleteJob)

	// Applications — candidate apply + recruiter pipeline. The apply route
	// is RequireAuth ONLY (the candidate's company membership is NOT
	// consulted); the recruiter subtree is RequireAuth + RequireCompanyRole
	// (recruiter). Both live on the ROOT router so the public /jobs mount
	// (GET-only) can never serve them — same routing-split defense as the
	// jobs write routes. GET /me/applications mounts inside the /me subtree
	// below.
	r.With(requireAuth).Post("/jobs/{jobId}/applications", applicationHandlers.ApplyToJob)
	r.With(requireAuth, requireRecruiter).Route("/jobs/{jobId}/applications", func(r chi.Router) {
		r.Get("/", applicationHandlers.ListJobApplications)
		r.Get("/{id}", applicationHandlers.GetApplication)
		r.Patch("/{id}/transition", applicationHandlers.TransitionApplication)
	})

	// /me/* is the authenticated slice. RequireAuth runs first, so any
	// request without a valid Bearer token is rejected pre-handler with
	// 401 — the candidate handler is never invoked; the verifier is
	// factory-built, so the subtree mounts unconditionally behind it.
	//
	// The companies-write handlers (WU6) live here too: the
	// `companyHandlers` struct is hoisted from the public /companies
	// block above so the /me subtree can mount the PATCH/DELETE
	// endpoints next to the membership routes. The handlers are
	// per-method `http.HandlerFunc` adapters (the CompanyHandlers()
	// accessor) so the chi subtree can apply per-method gates.
	companyHandlers := companyHandler.CompanyHandlers()
	_ = companyHandlers // referenced in the /me subtree below

	r.Route("/me", func(r chi.Router) {
		r.Use(requireAuth)
		r.Mount("/profile", candidateHandler.Routes())

		// GET /me/applications — the candidate's own applications. Inherits
		// requireAuth from the /me subtree; identity resolves candidate_id
		// from the JWT sub (no IDOR).
		r.Get("/applications", applicationHandlers.ListMyApplications)

		// /me/company is the company_membership subtree (WU4). The
		// /me Route group already gated with RequireAuth above; here
		// we layer per-route RequireCompanyRole gates on top of the
		// MemberHandler endpoints:
		//
		//   GET    /me/company               — UNGATED by role (the spec
		//                                      scenario "non-member gets
		//                                      404" returns 404, not 403,
		//                                      so this route MUST NOT be
		//                                      behind a role gate).
		//   GET    /me/company/members       — minRole=recruiter.
		//   POST   /me/company/members       — minRole=owner.
		//   PATCH  /me/company/members/{id}  — minRole=owner.
		//   DELETE /me/company/members/{id}  — minRole=owner.
		//
		// Each gate uses the same (users, members) pair as the rest of
		// the company_membership slice; the gate resolves the caller's
		// (company_id, role) per request and injects CompanyContext for
		// the handler. requireRecruiter is the hoisted variable
		// (Phase 6 D8); only requireOwner stays in this block because it
		// is only used here.
		//
		// require-company-role-tombstone-gate slice: same hoisted
		// `companyRepo` reused as the liveness port (narrow
		// CompanyLivenessRepository). The narrowed port keeps the
		// middleware from depending on the entity hydration +
		// write-co-write surface it doesn't need.
		requireOwner := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, companyRepo, valueobjects.OwnerRole)

		// Per-method handler accessors (added in WU4) — they let us
		// apply different gates to different (method, path) pairs,
		// which a single chi.Mount(Routes()) subrouter can't do because
		// the gate would apply uniformly to all sub-routes.
		handlers := memberHandler.MemberHandlers()

		// GET /me/company — UNGATED by role (spec scenario "non-member
		// gets 404" requires 404, not 403; a role gate would turn it
		// into 403).
		r.Get("/company", handlers.GetMyMembership)

		// GET /me/company/members — recruiter+ can read.
		r.With(requireRecruiter).Get("/company/members", handlers.ListMembers)

		// POST /me/company/members — owner only.
		r.With(requireOwner).Post("/company/members", handlers.AddMember)

		// PATCH/DELETE /me/company/members/{id} — owner only.
		r.With(requireOwner).Patch("/company/members/{id}", handlers.UpdateMemberRole)
		r.With(requireOwner).Delete("/company/members/{id}", handlers.RemoveMember)

		// Companies-write (WU6): the two owner-only write endpoints
		// live next to the membership routes. They reuse the
		// hoisted `requireOwner` gate (the /me subtree already has
		// `r.Use(requireAuth)`). The composition-root guard
		// TestCompanyWriteRoutes_MountedBehindGates pins both
		// routes behind `requireOwner` and asserts there is no
		// shadowing `chi.Mount("/me/company", ...)` subrouter.
		r.With(requireOwner).Patch("/company", companyHandlers.UpdateCompany)
		r.With(requireOwner).Delete("/company", companyHandlers.DeleteCompany)
	})

	// Hardened server + lifecycle from the runtime packages (WS6B-1a):
	// Run serves until ctx is cancelled, drains with the configured
	// deadline, and force-closes only if the drain deadline expires.
	srv, err := server.New(cfg, r)
	if err != nil {
		return err
	}
	slog.Info("listening", "addr", srv.Addr)
	return server.Run(ctx, srv, cfg.DrainTimeout)
}
