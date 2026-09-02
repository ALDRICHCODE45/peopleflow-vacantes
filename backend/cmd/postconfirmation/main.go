// Command postconfirmation is the composition root for the Cognito
// PostConfirmation Lambda trigger: strict env validation, Postgres
// open/ping, wiring of the existing user repository + application handler
// through the Lambda adapter, and Lambda runtime start. Event adapter and
// composition root only (design D5); every failure is one static safe
// error — never a DSN, credential, env value, raw driver error, or event data.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application"
	lambdapostconfirmation "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/lambdapostconfirmation"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Environment variable names pinned by design §6.2 and the identity spec;
// envEnabled is the same flag the application handler reads at call time.
const (
	envAppEnv   = "APP_ENV"
	envEnabled  = "IDENTITY_POSTCONFIRMATION_ENABLED"
	envDatabase = "DATABASE_URL"
)

// config is the validated executable configuration.
type config struct {
	env     string
	enabled bool
	dsn     string
}

// loadConfig validates APP_ENV, the enablement flag, and DATABASE_URL before
// any dependency is created. Values are case-normalized but otherwise matched
// exactly: unknown APP_ENV values and boolean aliases such as 1/t/yes/on are
// rejected. Production requires the flag to be true; local/test may set false.
// Error messages are static literals so no env value, DSN, or credential leaks.
func loadConfig(getenv func(string) string) (config, error) {
	env := strings.ToLower(strings.TrimSpace(getenv(envAppEnv)))
	switch env {
	case "production", "local", "test":
	default:
		return config{}, errors.New("APP_ENV is required and must be exactly production, local, or test")
	}

	enabledRaw := strings.ToLower(strings.TrimSpace(getenv(envEnabled)))
	if enabledRaw == "" {
		return config{}, errors.New("IDENTITY_POSTCONFIRMATION_ENABLED is required")
	}
	var enabled bool
	switch enabledRaw {
	case "true":
		enabled = true
	case "false":
		enabled = false
	default:
		return config{}, errors.New("IDENTITY_POSTCONFIRMATION_ENABLED must be exactly true or false")
	}
	if env == "production" && !enabled {
		return config{}, errors.New("IDENTITY_POSTCONFIRMATION_ENABLED must be true in production")
	}

	dsn := getenv(envDatabase)
	if dsn == "" {
		return config{}, errors.New("DATABASE_URL is required")
	}
	return config{env: env, enabled: enabled, dsn: dsn}, nil
}

// poolPort is the consumer-side seam over the Postgres pool: the sqlc DBTX
// surface the repository needs, plus ping/close for fail-fast startup and
// deterministic teardown.
type poolPort interface {
	db.DBTX
	Ping(context.Context) error
	Close()
}

// Compile-time assertion that the pgx pool satisfies the seam.
var _ poolPort = (*pgxpool.Pool)(nil)

type (
	// poolOpener creates the Postgres pool; production resolves to pgxpool.New.
	poolOpener func(ctx context.Context, dsn string) (poolPort, error)
	// lambdaStarter starts the Lambda runtime; production resolves to lambda.Start.
	lambdaStarter func(handler any)
)

// openPool is the production pool opener.
func openPool(ctx context.Context, dsn string) (poolPort, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("open post confirmation pool: %w", err)
	}
	return pool, nil
}

// run validates the configuration, opens and pings Postgres, composes the
// application handler through the Lambda adapter, and hands it to the starter.
// Validation strictly precedes dependency creation; every failure is one
// static safe error and the pool is closed exactly once when run returns.
func run(ctx context.Context, getenv func(string) string, open poolOpener, start lambdaStarter) error {
	cfg, err := loadConfig(getenv)
	if err != nil {
		return err
	}

	pool, err := open(ctx, cfg.dsn)
	if err != nil {
		return errors.New("could not open the database connection")
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return errors.New("database is not reachable")
	}

	queries := db.New(pool)
	userRepo := identitypostgres.NewUserRepository(queries)
	handler := application.NewPostConfirmationHandler(userRepo)
	adapter := lambdapostconfirmation.NewAdapter(handler)
	start(adapter)
	return nil
}

// main is the process boundary: one safe, stable, low-cardinality failure
// record and a non-zero exit; run never logs, so no layer duplicates this.
func main() {
	if err := run(context.Background(), os.Getenv, openPool, lambda.Start); err != nil {
		slog.Error("post confirmation executable failed", "error", err)
		os.Exit(1)
	}
}
