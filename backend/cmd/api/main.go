// Package main is the composition root for the API server: it wires together
// configuration, the Postgres connection pool, the JWT auth middleware, and
// the HTTP router.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	industrieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/industries/infrastructure/http"
	jobsusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	jobspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/lestrrat-go/jwx/v2/jwk"
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

	// Feature wiring: companies (adapter -> use case -> handler).
	// The bootstrap repository opens the transaction that creates a company
	// AND its founding owner atomically (business rule: the creator is owner).
	//
	// Companies-write WU3 (design D15): NewCompanyRepository now takes the
	// pool, not a *db.Queries handle — the adapter is pool-owning so the
	// write paths (`UpdateCompany`, `SoftDeleteCompany`) can open their own
	// pgx.Tx for the inline close. The read paths borrow `db.New(r.pool)`
	// per call (semantically identical to the pre-WU3 `*db.Queries` shape).
	companyRepo := postgres.NewCompanyRepository(pool)
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

	// Applications wiring: the pool-owning applications repo (D5/D9) + the
	// stateless audit adapter. Create/Transition open their own pool.Begin
	// and co-write the application write + the audit event append atomically
	// (fail-closed: an audit failure rolls the write back). The service uses
	// the identity user repo for the cognitoSub → users.id resolution seam;
	// the handler's per-method accessor lets the composition root gate
	// candidate-apply and recruiter routes differently.
	auditRepo := auditpostgres.NewAuditEventRepository()
	applicationRepo := applicationspostgres.NewApplicationRepository(pool, auditRepo)
	applicationService := applicationsusecases.NewApplicationService(applicationRepo, identityUserRepo)
	applicationHandler := applicationshttp.NewApplicationHandler(applicationService)
	applicationHandlers := applicationHandler.ApplicationHandlers()

	// Verifier wiring: build a real RSA verifier when IDENTITY_JWT_* env
	// vars are set; fall back to a fail-closed verifier when they aren't.
	// The fail-closed path keeps /me/* mounted behind RequireAuth so the
	// middleware always runs — there is no code path that lets an
	// unauthenticated request reach the candidate handler.
	verifier, verifierErr := buildVerifierFromEnv()
	if verifierErr != nil {
		slog.Warn("identity verifier not configured; /me/* will reject every request with 401", "error", verifierErr)
	} else {
		slog.Info("identity verifier ready")
	}

	// Phase 6 D8 hoist: requireAuth + requireRecruiter are now used by
	// BOTH the /me/* subtree AND the jobs write route (PATCH /jobs/{id}),
	// so they're hoisted to run() scope. requireOwner stays local to the
	// /me block (only used by member-mutation routes).
	requireAuth := identityhttp.RequireAuth(verifier)
	requireRecruiter := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, valueobjects.RecruiterRole)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Wiring/health check: pings the DB to prove the HTTP -> DB path end to end.
	r.Get("/healthz", func(w http.ResponseWriter, req *http.Request) {
		if err := pool.Ping(req.Context()); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	r.Mount("/industries", industrieshttp.ListIndustries(queries))

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
	r.Get("/industries", industrieshttp.ListIndustries(queries))

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
	// 401 — the candidate handler is never invoked. With the fail-closed
	// verifier in place (env not set), every request still hits 401, not
	// 404, so the surface can't be probed by accident.
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
		requireOwner := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, valueobjects.OwnerRole)

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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Run the server in a goroutine so the main flow can wait for the shutdown signal.
	serverErr := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	// Block until the server fails or a shutdown signal arrives.
	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	}

	// Give in-flight requests up to 10s to finish before forcing the close.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// buildVerifierFromEnv returns a security.Verifier built from the
// IDENTITY_JWT_* env vars. When the env is fully populated, it parses
// IDENTITY_JWT_PUBLIC_KEY_PEM (accepting both PKCS#1 and PKIX via
// jwk.WithPEM(true)) and returns a real auth.RSAVerifier pinned to
// the configured issuer and audience. When any of the three env vars
// is unset, it returns a fail-closed denyAllVerifier so the
// /me/* route chain still mounts behind RequireAuth — every request
// is rejected with a sentinel error, never silently admitted.
func buildVerifierFromEnv() (security.Verifier, error) {
	pubPEM := os.Getenv("IDENTITY_JWT_PUBLIC_KEY_PEM")
	issuer := os.Getenv("IDENTITY_JWT_ISSUER")
	audience := os.Getenv("IDENTITY_JWT_AUDIENCE")
	if pubPEM == "" || issuer == "" || audience == "" {
		return denyAllVerifier{}, errors.New("IDENTITY_JWT_PUBLIC_KEY_PEM, IDENTITY_JWT_ISSUER, and IDENTITY_JWT_AUDIENCE must be set")
	}
	// jwk.ParseKey with WithPEM(true) accepts both PKCS#1 (header
	// "RSA PUBLIC KEY") and PKIX (header "PUBLIC KEY") PEM blocks; the
	// constructor pins the algorithm to RS256 to block the HS256
	// algorithm-confusion attack class.
	key, err := jwk.ParseKey([]byte(pubPEM), jwk.WithPEM(true))
	if err != nil {
		return nil, fmt.Errorf("parse IDENTITY_JWT_PUBLIC_KEY_PEM: %w", err)
	}
	return auth.NewRSAVerifier(key, issuer, audience)
}

// errFailClosedVerifier is the sentinel a denyAllVerifier surfaces for
// every token. It is intentionally distinct from a real verification
// error so logs can be filtered cleanly.
var errFailClosedVerifier = errors.New("identity verifier is fail-closed: IDENTITY_JWT_* env vars are not configured")

// denyAllVerifier is the fail-closed security.Verifier returned by
// buildVerifierFromEnv when IDENTITY_JWT_* env vars are missing. It
// rejects every token with errFailClosedVerifier, so /me/* mounted
// behind RequireAuth never admits a request by accident even when
// the operator hasn't provisioned the JWT signing key yet.
type denyAllVerifier struct{}

func (denyAllVerifier) Verify(_ context.Context, _ string) (security.Claims, error) {
	return security.Claims{}, errFailClosedVerifier
}

// Compile-time assertion that denyAllVerifier satisfies the port.
var _ security.Verifier = denyAllVerifier{}
