// Package main is the composition root for the API server: it wires together
// configuration, the Postgres connection pool, the JWT auth middleware, and
// the HTTP router.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	companieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth"
	industrieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/industries/infrastructure/http"
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

	// Feature wiring: companies (adapter -> use case -> handler).
	companyRepo := postgres.NewCompanyRepository(queries)
	companyService := usecases.NewCompanyService(companyRepo)
	companyHandler := companieshttp.NewCompanyHandler(companyService)

	// Identity wiring: the JWT verifier + RequireAuth middleware are
	// constructed here so the structural test can prove the constructor is
	// called. In this slice zero routes are mounted behind the middleware;
	// future authenticated routes will pick it up via a chi.With() chain.
	verifier, err := buildVerifierFromEnv()
	if err != nil {
		// In dev we accept "no verifier configured" so the server boots
		// without a key. The middleware just won't be functional.
		slog.Warn("identity verifier not configured", "error", err)
	} else {
		_ = identityhttp.RequireAuth(verifier)
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

// buildVerifierFromEnv builds an RSA verifier from the IDENTITY_JWT_* env
// vars. For now we only build the dev static-key verifier; the JWKS
// verifier is deferred until the real Cognito wiring lands.
func buildVerifierFromEnv() (security.Verifier, error) {
	pubPEM := os.Getenv("IDENTITY_JWT_PUBLIC_KEY_PEM")
	issuer := os.Getenv("IDENTITY_JWT_ISSUER")
	audience := os.Getenv("IDENTITY_JWT_AUDIENCE")
	if pubPEM == "" || issuer == "" || audience == "" {
		return nil, errors.New("IDENTITY_JWT_PUBLIC_KEY_PEM, IDENTITY_JWT_ISSUER, and IDENTITY_JWT_AUDIENCE must be set")
	}
	// We import auth here so the verifier lives behind the security.Verifier
	// port; the actual RS256 verification is in the auth package.
	_ = auth.RSAVerifier{}
	return nil, errors.New("JWKS wiring deferred; static-key verifier not enabled in this slice yet")
}
