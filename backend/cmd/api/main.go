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
	jobsusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	jobspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	runtimemetrics "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/server"
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

	// Phase 6 D8 hoist: requireAuth + requireRecruiter are now used by
	// BOTH the /me/* subtree AND the jobs write route (PATCH /jobs/{id}),
	// so they're hoisted to run() scope; requireOwner is passed to newRouter.
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
	requireOwner := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, companyRepo, valueobjects.OwnerRole)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Typed runtime configuration (WS6B-1a): conservative hardening
	// timeouts; server.New validates that every one of them is positive.
	cfg := runtimeconfig.DefaultServerConfig(":" + port)

	// Task 6.3 (ws6c-5a): every readiness ping samples the current pool
	// state. The metrics-owned decorator wraps the pool ONLY as the
	// readiness pinger passed through routerDeps.pool; every repository
	// above keeps the original *pgxpool.Pool. Each ping (success or
	// failure) samples pgxpool.Stat() exactly once and forwards the
	// acquired/idle/max counts to DBMetrics.ObservePool. Still no
	// exporter, no metrics endpoint, no background goroutine.
	poolPinger := runtimemetrics.NewDBObservedPinger(pool, func() (int32, int32, int32) {
		s := pool.Stat()
		return s.AcquiredConns(), s.IdleConns(), s.MaxConns()
	}, runtimemetrics.Default)

	// WS6B-1b-b: router.go owns the chi router; the composition root passes it.
	r := newRouter(routerDeps{
		requireAuth: requireAuth, requireRecruiter: requireRecruiter, requireOwner: requireOwner,
		companyHandler: companyHandler, memberHandler: memberHandler,
		candidateHandler: candidateHandler, jobHandler: jobHandler, applicationHandler: applicationHandler,
		queries: queries, pool: poolPinger, readinessTimeout: cfg.ReadinessTimeout,
		// Task 6.3 (design §8.3): compose the no-op HTTP metrics default —
		// zero-dependency, no exporter, no metrics endpoint in this change.
		httpMetrics: runtimemetrics.Default,
		// Task 6.3 (ws6c-4a): inject the readiness-boundary logger and the
		// shared no-op readiness gauge explicitly; health.Readyz keeps safe
		// nil defaults for both. Still no exporter, no metrics endpoint.
		readinessLogger: slog.Default(), readinessMetrics: runtimemetrics.Default,
	})
	// Hardened server + lifecycle from the runtime packages (WS6B-1a):
	// Run serves until ctx is cancelled, drains with the configured
	// deadline, and force-closes only if the drain deadline expires.
	srv, err := server.New(cfg, r)
	if err != nil {
		return err
	}
	// Task 6.3 (ws6c-3a): one structured startup event with an explicit
	// non-secret allowlist (address, effective timeouts, enforced JSON body
	// cap), after server.New validates the config and before server.Run.
	// Replaces the former addr-only slog.Info("listening", ...) record.
	logStartupConfig(slog.Default(), cfg, startupMaxJSONBodyBytes)
	return server.Run(ctx, srv, cfg.DrainTimeout)
}

// startupMaxJSONBodyBytes is the currently enforced 1 MiB JSON request-body
// cap, reported at startup. It is deliberately NOT a centralization: each
// JSON-accepting feature handler compiles its own identical constant, and
// TestBodyLimitBinding_Guarded pins every copy to the same value so the
// startup event stays truthful (changing any copy without the others fails).
const startupMaxJSONBodyBytes int64 = 1_048_576

// logStartupConfig emits the single structured startup event: an explicit
// allowlist of effective, non-secret values — the listen address, every
// server/readiness/drain timeout (canonical time.Duration.String() form), and
// the numeric JSON request-body cap. It accepts only these narrow typed
// inputs, structurally preventing any environment map, DSN, JWT/JWKS/PEM or
// token material, arbitrary config object, or raw error from leaking into
// the record.
func logStartupConfig(logger *slog.Logger, cfg runtimeconfig.ServerConfig, maxBodyBytes int64) {
	logger.Info("startup",
		"event", "startup",
		"action", "startup_config",
		"addr", cfg.Addr,
		"read_header_timeout", cfg.ReadHeaderTimeout.String(),
		"read_timeout", cfg.ReadTimeout.String(),
		"write_timeout", cfg.WriteTimeout.String(),
		"idle_timeout", cfg.IdleTimeout.String(),
		"readiness_timeout", cfg.ReadinessTimeout.String(),
		"drain_timeout", cfg.DrainTimeout.String(),
		"max_json_body_bytes", maxBodyBytes,
	)
}
