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
	companyRepo := postgres.NewCompanyRepository(queries)
	companyService := usecases.NewCompanyService(companyRepo)
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

	r.Mount("/companies", companyHandler.Routes())
	r.Get("/industries", industrieshttp.ListIndustries(queries))

	// /jobs is the public-read job board. Both routes (GET /jobs and
	// GET /jobs/{id}) are reachable WITHOUT authentication: the spec
	// scenario "GET /jobs is public" forbids auth here, so this mount
	// lives outside the /me/* RequireAuth subtree.
	r.Mount("/jobs", jobHandler.Routes())

	// /me/* is the authenticated slice. RequireAuth runs first, so any
	// request without a valid Bearer token is rejected pre-handler with
	// 401 — the candidate handler is never invoked. With the fail-closed
	// verifier in place (env not set), every request still hits 401, not
	// 404, so the surface can't be probed by accident.
	r.Route("/me", func(r chi.Router) {
		r.Use(identityhttp.RequireAuth(verifier))
		r.Mount("/profile", candidateHandler.Routes())

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
		// the handler.
		requireOwner := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, valueobjects.OwnerRole)
		requireRecruiter := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, valueobjects.RecruiterRole)

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
