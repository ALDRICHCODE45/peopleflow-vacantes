// Command localidentitybootstrap is the composition root for the temporary
// TMP-IDENTITY-001 local users-only identity bootstrap. It is disabled by
// default, only runs with APP_ENV=local, binds a literal loopback listener,
// requires an explicit private-terminal approval, and performs exactly one
// users-only creation attempt before exiting. It never loads dotenv files and
// never prints credentials, tokens or the bridge key.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	identityusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth"
	localbootstrap "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/localbootstrap"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Fixed lifecycle timeouts. The UserInfo fetch is bounded; the graceful
// shutdown must let an in-flight apply response flush before the process exits.
const (
	userInfoTimeout = 5 * time.Second
	shutdownTimeout = 5 * time.Second
)

// Pool is the consumer-side seam over the Postgres pool: the sqlc DBTX surface
// plus ping/close for fail-fast startup and deterministic teardown.
type Pool interface {
	db.DBTX
	Ping(context.Context) error
	Close()
}

// Compile-time assertion that the pgx pool satisfies the seam.
var _ Pool = (*pgxpool.Pool)(nil)

// Runtime is the command's explicit dependency surface. Every seam has a
// production default in DefaultRuntime and is injectable for fake-backed tests.
type Runtime struct {
	Getenv      func(string) string
	Clock       func() time.Time
	OpenPool    func(ctx context.Context, dsn string) (Pool, error)
	NewVerifier func(getenv func(string) string) (security.Verifier, error)
	NewUserInfo func(endpoint string, timeout time.Duration) localbootstrap.UserInfoClient
	NewCreator  func(pool Pool) localbootstrap.UserCreator
	NewTerminal func() (localbootstrap.Terminal, error)
	Listen      func(network, addr string) (net.Listener, error)
	Stdout      io.Writer
	Stderr      io.Writer
}

// DefaultRuntime wires the production dependencies.
func DefaultRuntime() Runtime {
	return Runtime{
		Getenv: os.Getenv,
		Clock:  time.Now,
		OpenPool: func(ctx context.Context, dsn string) (Pool, error) {
			return pgxpool.New(ctx, dsn)
		},
		NewVerifier: func(getenv func(string) string) (security.Verifier, error) {
			return auth.NewVerifierConfigFromEnv(getenv, auth.NewJWKSVerifier)
		},
		NewUserInfo: func(endpoint string, timeout time.Duration) localbootstrap.UserInfoClient {
			return localbootstrap.NewHTTPUserInfoClient(endpoint, timeout)
		},
		NewCreator: func(pool Pool) localbootstrap.UserCreator {
			repo := identitypostgres.NewUserRepository(db.New(pool))
			store := localbootstrap.NewCompatibleUserStore(repo)
			return localbootstrap.NewUserServiceCreator(identityusecases.NewUserService(store))
		},
		NewTerminal: func() (localbootstrap.Terminal, error) {
			return localbootstrap.OpenTerminal()
		},
		Listen: func(network, addr string) (net.Listener, error) {
			return net.Listen(network, addr)
		},
		Stdout: os.Stdout,
		Stderr: os.Stderr,
	}
}

// Run validates the configuration, then performs the one-shot bootstrap:
// private-terminal gate, loopback listener, local database open/ping, and the
// single stage/approve/apply lifecycle. Validation strictly precedes every
// dependency; the command never loads dotenv files.
func Run(ctx context.Context, rt Runtime) error {
	cfg, err := localbootstrap.LoadConfig(rt.Getenv)
	if err != nil {
		return err
	}
	if !cfg.Enabled {
		fmt.Fprintln(rt.Stdout, "localidentitybootstrap: disabled (set IDENTITY_LOCAL_BOOTSTRAP_ENABLED=true to enable)")
		return nil
	}

	// Validate the local database target before any connection is opened.
	target, err := localbootstrap.ParseDatabaseTarget(cfg.DatabaseURL)
	if err != nil {
		return err
	}

	// The private terminal is a hard prerequisite: no unattended approval.
	term, err := rt.NewTerminal()
	if err != nil {
		return err
	}
	if !term.IsInteractive() {
		return errors.New("local bootstrap: an interactive private terminal is required")
	}
	closer, closable := term.(interface{ Close() error })
	var closeOnce sync.Once
	closeTerminal := func() {
		closeOnce.Do(func() {
			if closable {
				_ = closer.Close()
			}
		})
	}
	// The terminal is closed exactly once on every return path. awaitOperator
	// also closes it to unblock a blocking ReadLine before joining its reader.
	defer closeTerminal()

	verifier, err := rt.NewVerifier(rt.Getenv)
	if err != nil {
		return errors.New("local bootstrap: identity verifier configuration is invalid")
	}
	if closer, ok := verifier.(interface{ Close() }); ok {
		defer closer.Close()
	}

	coordinator := localbootstrap.NewCoordinator(rt.Clock)

	listener, err := rt.Listen("tcp", cfg.Addr)
	if err != nil {
		return errors.New("local bootstrap: could not bind the configured loopback listener")
	}
	defer func() { _ = listener.Close() }()

	pool, err := rt.OpenPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return errors.New("local bootstrap: could not open the local database connection")
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return errors.New("local bootstrap: the local database is not reachable")
	}

	creator := rt.NewCreator(pool)

	applied := make(chan struct{})
	var once sync.Once
	handler := localbootstrap.NewHandler(localbootstrap.HandlerConfig{
		Addr:        listener.Addr().String(),
		Key:         cfg.Key,
		Verifier:    verifier,
		UserInfo:    rt.NewUserInfo(cfg.UserInfoURL, userInfoTimeout),
		Coordinator: coordinator,
		Creator:     creator,
		UserType:    cfg.UserType,
		Database:    target,
		Now:         rt.Clock,
		OnApplied:   func() { once.Do(func() { close(applied) }) },
	})

	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       30 * time.Second,
		// Request/error logging is disabled: this process must never log a raw
		// request line, header or token.
		ErrorLog: log.New(io.Discard, "", 0),
	}
	serveDone := make(chan struct{})
	go func() {
		defer close(serveDone)
		_ = server.Serve(listener)
	}()

	fmt.Fprintf(rt.Stdout, "localidentitybootstrap: listening on %s (scope: users-only, user_type: recruiter)\n", listener.Addr().String())

	loopErr := awaitOperator(ctx, term, closeTerminal, closable, coordinator, cfg, applied)

	// Graceful shutdown lets the single apply response flush before exit.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
	<-serveDone
	return loopErr
}

// awaitOperator waits for one staged candidate, prompts the private terminal,
// and drives exactly one approval decision. Rejection, expiry, a closed
// terminal and context cancellation all clear the state and exit safely.
func awaitOperator(ctx context.Context, term localbootstrap.Terminal, closeTerminal func(), closable bool, coordinator *localbootstrap.Coordinator, cfg localbootstrap.Config, applied <-chan struct{}) error {
	lines := make(chan string)
	stop := make(chan struct{})
	readerDone := make(chan struct{})
	// The single owned reader goroutine. Its send is cancellation-aware so a
	// shutdown never leaves it blocked on the channel.
	go func() {
		defer close(readerDone)
		for {
			line, err := term.ReadLine()
			if err != nil {
				return
			}
			select {
			case lines <- line:
			case <-stop:
				return
			}
		}
	}()

	var stopOnce sync.Once
	stopReader := func() {
		stopOnce.Do(func() {
			// Stop a blocked send, close the terminal once to unblock a blocked
			// ReadLine, then deterministically join the reader it owns.
			close(stop)
			closeTerminal()
			if closable {
				<-readerDone
			}
		})
	}
	defer stopReader()

	candidate, err := coordinator.WaitForCandidate(ctx)
	if err != nil {
		coordinator.Reject()
		return nil
	}

	for {
		if err := term.ShowPrompt(localbootstrap.ApprovalPrompt(candidate, cfg.Issuer)); err != nil {
			coordinator.Reject()
			return errors.New("local bootstrap: the private terminal is unavailable")
		}
		timer := time.NewTimer(time.Until(candidate.ExpiresAt))
		select {
		case line, ok := <-lines:
			timer.Stop()
			if !ok {
				coordinator.Reject()
				return errors.New("local bootstrap: the private terminal closed before approval")
			}
			decision, code := localbootstrap.ParseOperatorLine(line)
			switch decision {
			case localbootstrap.DecisionReject:
				coordinator.Reject()
				return nil
			case localbootstrap.DecisionApprove:
				switch err := coordinator.Approve(code); {
				case err == nil:
					return waitForApply(ctx, coordinator, applied, candidate.ExpiresAt)
				case errors.Is(err, localbootstrap.ErrOperationExpired):
					coordinator.Reject()
					return nil
				default:
					// Wrong code: re-prompt until expiry, reject or approval.
					continue
				}
			default:
				continue
			}
		case <-timer.C:
			coordinator.Reject()
			return nil
		case <-ctx.Done():
			timer.Stop()
			coordinator.Reject()
			return nil
		}
	}
}

// waitForApply waits until the single apply attempt completes or the operation
// expires / the operator interrupts.
func waitForApply(ctx context.Context, coordinator *localbootstrap.Coordinator, applied <-chan struct{}, expiresAt time.Time) error {
	timer := time.NewTimer(time.Until(expiresAt))
	defer timer.Stop()
	select {
	case <-applied:
		return nil
	case <-timer.C:
		coordinator.Reject()
		return nil
	case <-ctx.Done():
		coordinator.Reject()
		return nil
	}
}

// Usage writes the safe operator help: environment variable names, defaults,
// limitations and the manual execution gate. It never prints values.
func Usage(w io.Writer) {
	fmt.Fprintln(w, "localidentitybootstrap — temporary TMP-IDENTITY-001 local users-only bootstrap")
	fmt.Fprintln(w, "Disabled by default. Requires APP_ENV=local and explicit opt-in. Never loads .env.")
	fmt.Fprintln(w, "Environment (names only):")
	fmt.Fprintln(w, "  APP_ENV=local")
	fmt.Fprintln(w, "  IDENTITY_LOCAL_BOOTSTRAP_ENABLED=true|false")
	fmt.Fprintln(w, "  IDENTITY_LOCAL_BOOTSTRAP_ADDR=127.0.0.1:8081")
	fmt.Fprintln(w, "  IDENTITY_LOCAL_BOOTSTRAP_KEY=<at least 32 bytes, no whitespace or control characters>")
	fmt.Fprintln(w, "  IDENTITY_LOCAL_BOOTSTRAP_USER_TYPE=recruiter")
	fmt.Fprintln(w, "  IDENTITY_LOCAL_BOOTSTRAP_COGNITO_DOMAIN=<bare https origin>")
	fmt.Fprintln(w, "  IDENTITY_JWT_MODE=jwks, IDENTITY_JWT_ISSUER, IDENTITY_JWT_CLIENT_ID, IDENTITY_JWT_TOKEN_USE=access")
	fmt.Fprintln(w, "  DATABASE_URL=<explicit loopback Postgres target>")
	fmt.Fprintln(w, "The bridge key and tokens are operator-managed secrets, never printed or logged.")
	fmt.Fprintln(w, "Real execution against a human database requires separate explicit approval.")
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "-h", "--help", "help":
			Usage(os.Stdout)
			return
		default:
			fmt.Fprintln(os.Stderr, "localidentitybootstrap: unknown argument; only -h/--help is supported")
			os.Exit(2)
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Default structured logging is disabled for this process; the only output
	// channels are the safe stdout banner and the private terminal prompt.
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := Run(ctx, DefaultRuntime()); err != nil {
		fmt.Fprintf(os.Stderr, "localidentitybootstrap: %s\n", err)
		os.Exit(1)
	}
}
