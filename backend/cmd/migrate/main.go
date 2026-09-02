// Command migrate applies, reverts, and reports the embedded goose SQL migrations against the Postgres DATABASE_URL. Design §6.1 exit contract:
// 0 on success; 3 on any classified failure with exactly one safe structured JSON error on stderr — static messages only, never user input, DSN, credentials, or driver text.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"

	_ "github.com/jackc/pgx/v5/stdlib" // pgx stdlib registers the database/sql "pgx" driver as a side effect.
	"github.com/pressly/goose/v3"
)

const (
	exitFailure = 3 // documented classified-failure exit status
	// advisoryLockKey is the documented session advisory-lock key ("PF_MIGR"); a test pins the decimal.
	advisoryLockKey                               int64 = 0x50465F4D494752
	pingTimeout                                         = 10 * time.Second
	lockTimeout                                         = 15 * time.Second
	unlockTimeout                                       = 5 * time.Second
	stageParse, stageConfig, stageOpen, stagePing       = "parse", "config", "open", "ping" // stages classify every failure (design §6.1)
	stageLock, stageMigration, stageUnlock              = "lock", "migration", "unlock"
)

var databaseDriver = "pgx" // sql driver seam; tests inject a stub driver
var migrateFn = migrate    // test seam: tests inject a stub successful migration op

// failure is the single safe structured error emitted on any non-zero exit.
type failure struct {
	Command string `json:"command"`
	Stage   string `json:"stage"`
	Error   string `json:"error"`
}

func parseCommand(arg string) (string, bool) {
	switch arg {
	case "up", "down", "status":
		return arg, true
	}
	return "", false
}

// fail writes exactly one classified JSON failure and returns exitFailure; msg is a static safe literal.
func fail(w io.Writer, cmd, stage, msg string) int {
	_ = json.NewEncoder(w).Encode(failure{Command: cmd, Stage: stage, Error: msg})
	return exitFailure
}

// newUnlockContext derives the unlock context: WithoutCancel survives cancel; unlockTimeout bounds it.
func newUnlockContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), unlockTimeout)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}

// run executes one migration command and returns the process exit code. Every failure path emits at most one structured JSON failure via fail
// (migration failure followed by unlock failure classifies as the single unlock record); it never touches os.Exit so tests drive it through this seam.
func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	_ = stdout // goose writes status output through its own stdout logger
	cmd, ok := "", false
	if len(args) == 1 {
		cmd, ok = parseCommand(args[0])
	}
	if !ok {
		return fail(stderr, "", stageParse, "usage: migrate {up|down|status}") // static; never echoes args[0]
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fail(stderr, cmd, stageConfig, "DATABASE_URL is required")
	}
	db, err := sql.Open(databaseDriver, dsn)
	if err != nil {
		return fail(stderr, cmd, stageOpen, "could not open the database connection")
	}
	defer db.Close()

	pingCtx, cancelPing := context.WithTimeout(ctx, pingTimeout)
	defer cancelPing()
	if err := db.PingContext(pingCtx); err != nil {
		return fail(stderr, cmd, stagePing, "database is not reachable")
	}

	// One dedicated connection holds the session advisory lock (design D4) on a bounded, parent-preserving context covering both db.Conn and pg_advisory_lock (R3).
	lockCtx, cancelLock := context.WithTimeout(ctx, lockTimeout)
	defer cancelLock()
	conn, err := db.Conn(lockCtx)
	if err != nil {
		return fail(stderr, cmd, stageLock, "could not acquire the migration lock")
	}
	defer conn.Close()

	if _, err := conn.ExecContext(lockCtx, "SELECT pg_advisory_lock($1)", advisoryLockKey); err != nil {
		return fail(stderr, cmd, stageLock, "could not acquire the migration lock")
	}

	migErr := migrateFn(ctx, db, cmd)
	// Release the lock even after a failed migration on the independent bounded unlock context; the unlock failure dominates when both operations fail.
	unlockCtx, cancelUnlock := newUnlockContext(ctx)
	defer cancelUnlock()
	_, unlockErr := conn.ExecContext(unlockCtx, "SELECT pg_advisory_unlock($1)", advisoryLockKey)
	if migErr == nil {
		return 0 // unlock failure after success is recovered (conn teardown frees the lock): exit stays 0
	}
	if unlockErr != nil {
		return fail(stderr, cmd, stageUnlock, "could not release the migration lock")
	}
	return fail(stderr, cmd, stageMigration, "migration operation failed")
}

// migrate dispatches exactly one context-aware goose operation; its raw error is never surfaced.
func migrate(ctx context.Context, db *sql.DB, cmd string) error {
	goose.SetBaseFS(migrations.MigrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	switch cmd {
	case "up":
		return goose.UpContext(ctx, db, ".")
	case "down":
		return goose.DownContext(ctx, db, ".")
	case "status":
		return goose.StatusContext(ctx, db, ".")
	}
	return nil
}
