//go:build integration

package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/google/uuid"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
	"time"
)

func buildMigrateBinary(t *testing.T) string {
	t.Helper()
	bin := t.TempDir() + "/migrate"
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("build migrate binary: %v (compiler output withheld, %d bytes)", err, len(out))
	}
	return bin
}

// TestMigrateBinaryBoundary exercises the built executable across failure, round-trip, and locking boundaries.
func TestMigrateBinaryBoundary(t *testing.T) {
	bin := buildMigrateBinary(t)
	t.Run("unreachable database is a safe classified failure", func(t *testing.T) {
		code, stdout, stderr := runMigrate(t, bin, fakeDSN, "status")
		if code != exitFailure || stdout != "" {
			t.Fatalf("exit = %d, stdout = %d bytes; want %d and empty stdout", code, len(stdout), exitFailure)
		}
		f := decodeSingleRecord(t, stderr)
		if f.Command != "status" || f.Stage != stagePing || f.Error != "database is not reachable" {
			t.Fatalf("failure record = %+v, want the static ping record", f)
		}
		assertNoLeak(t, stderr)
	})
	t.Run("live round trip on a disposable database", func(t *testing.T) {
		dsn := disposableDatabase(t)
		admin := openAdmin(t, dsn)
		defer admin.Close()
		files, err := fs.Glob(migrations.MigrationsFS, "*.sql")
		if err != nil || len(files) == 0 {
			t.Fatalf("embedded migrations unreadable: %d files (err withheld)", len(files))
		}
		requireMigrateOK(t, bin, dsn, "up")
		requireMigrateOK(t, bin, dsn, "up") // idempotent second up
		requireMigrateOK(t, bin, dsn, "status")
		before := catalogSnapshot(t, admin)
		for range files { // one built-binary down per embedded SQL file
			requireMigrateOK(t, bin, dsn, "down")
		}
		var residual int
		if err := admin.QueryRowContext(t.Context(),
			`SELECT count(*) FROM goose_db_version WHERE version_id <> 0`).Scan(&residual); err != nil {
			t.Fatal("goose version probe after full down failed (driver text withheld)")
		}
		if residual != 0 {
			t.Fatalf("after %d down runs goose still records %d applied versions, want 0", len(files), residual)
		}
		requireMigrateOK(t, bin, dsn, "up")
		after := catalogSnapshot(t, admin)
		if !slices.Equal(before, after) {
			t.Fatalf("pg_catalog snapshot drifted across the down/up cycle: %d lines before, %d after, first divergence at %d",
				len(before), len(after), firstDivergence(before, after))
		}
	})
	t.Run("advisory lock serializes concurrent invocations", func(t *testing.T) {
		dsn := disposableDatabase(t)
		holder, holderPID := holdAdvisoryLock(t, dsn)
		appName := "ws4ab-serial-" + uniqueSuffix()
		cmd, _, stderr := startMigrate(t, bin, dsnWithParam(t, dsn, "application_name", appName), "status")
		waitForLockWait(t, dsn, appName, holderPID)
		uctx, ucancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer ucancel()
		if _, err := holder.ExecContext(uctx, "SELECT pg_advisory_unlock($1)", advisoryLockKey); err != nil {
			t.Fatal("holder advisory lock release failed (driver text withheld)")
		}
		if code := waitMigrate(t, cmd); code != 0 {
			t.Fatalf("status while the lock was held exited %d with record %+v, want 0 after release",
				code, decodeSingleRecord(t, stderr.String()))
		}
	})
	t.Run("sigint while waiting for the lock exits 3 with the lock record", func(t *testing.T) {
		dsn := disposableDatabase(t)
		holder, holderPID := holdAdvisoryLock(t, dsn)
		_ = holder // held on purpose: the child must still be blocked when SIGINT lands
		appName := "ws4ab-sigint-" + uniqueSuffix()
		cmd, stdout, stderr := startMigrate(t, bin, dsnWithParam(t, dsn, "application_name", appName), "status")
		waitForLockWait(t, dsn, appName, holderPID)
		if err := cmd.Process.Signal(os.Interrupt); err != nil {
			t.Fatalf("send SIGINT to the blocked child: %v", err)
		}
		code := waitMigrate(t, cmd)
		if code != exitFailure || stdout.Len() != 0 {
			t.Fatalf("exit = %d, stdout = %d bytes; want %d and empty stdout", code, stdout.Len(), exitFailure)
		}
		f := decodeSingleRecord(t, stderr.String())
		if f.Command != "status" || f.Stage != stageLock || f.Error != "could not acquire the migration lock" {
			t.Fatalf("failure record = %+v, want the static lock record", f)
		}
		assertNoDSNLeak(t, dsn, stdout.String(), stderr.String())
	})
}

// startMigrate starts the built binary with DATABASE_URL=dsn; Cancel sends os.Interrupt
// (never SIGKILL) and a 90s watchdog bounds a hung child so it can never hang the suite.
func startMigrate(t *testing.T, bin, dsn string, args ...string) (*exec.Cmd, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.Env = append(envWithout("DATABASE_URL"), "DATABASE_URL="+dsn)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("start migrate %v: %v", args, err)
	}
	return cmd, &stdout, &stderr
}

// runMigrate runs one command to completion and returns exit code plus raw streams;
// callers keep raw output out of failure messages and decode records instead.
func runMigrate(t *testing.T, bin, dsn string, args ...string) (int, string, string) {
	t.Helper()
	cmd, stdout, stderr := startMigrate(t, bin, dsn, args...)
	return waitMigrate(t, cmd), stdout.String(), stderr.String()
}

// waitMigrate reaps the started command and returns its exit code.
func waitMigrate(t *testing.T, cmd *exec.Cmd) int {
	t.Helper()
	if err := cmd.Wait(); err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			t.Fatalf("wait migrate: %v", err)
		}
		return exitErr.ExitCode()
	}
	return 0
}

// requireMigrateOK runs one command expecting exit 0; failure reports only the decoded record.
func requireMigrateOK(t *testing.T, bin, dsn, arg string) {
	t.Helper()
	code, stdout, stderr := runMigrate(t, bin, dsn, arg)
	assertNoDSNLeak(t, dsn, stdout, stderr)
	if code != 0 {
		t.Fatalf("%s exited %d with record %+v, want 0", arg, code, decodeSingleRecord(t, stderr))
	}
}

// decodeSingleRecord asserts stderr holds exactly one structured JSON failure record and
// returns it; raw output is never included in failure messages.
func decodeSingleRecord(t *testing.T, stderr string) failure {
	t.Helper()
	var f failure
	dec := json.NewDecoder(strings.NewReader(stderr))
	if err := dec.Decode(&f); err != nil || dec.More() {
		t.Fatalf("stderr is not exactly one structured JSON failure record (%d bytes)", len(stderr))
	}
	return f
}

// assertNoDSNLeak fails if any output carries the DSN, a URL-form credential, or a password parameter.
func assertNoDSNLeak(t *testing.T, dsn string, outs ...string) {
	t.Helper()
	for _, out := range outs {
		for _, banned := range []string{dsn, "postgres://", "postgresql://", "password="} {
			if strings.Contains(out, banned) {
				t.Fatalf("output leaks sensitive connection material (%d bytes withheld)", len(out))
			}
		}
	}
}

// disposableDatabase derives a unique disposable database from DATABASE_URL (role must hold
// CREATEDB) and drops it with FORCE on cleanup; a missing, unreachable, or under-privileged
// DATABASE_URL is a hard safe failure — closure evidence is never skipped.
func disposableDatabase(t *testing.T) string {
	t.Helper()
	base := os.Getenv("DATABASE_URL")
	if base == "" {
		t.Fatal("DATABASE_URL is required for live migration closure; set a reachable PostgreSQL URL whose role has CREATEDB (no skip is permitted)")
	}
	admin := openAdmin(t, base)
	t.Cleanup(func() { _ = admin.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := admin.PingContext(ctx); err != nil {
		t.Fatal("DATABASE_URL is not reachable; live migration closure requires a reachable PostgreSQL (no skip is permitted)")
	}
	var createdb bool
	if err := admin.QueryRowContext(ctx,
		`SELECT rolcreatedb FROM pg_roles WHERE rolname = session_user`).Scan(&createdb); err != nil || !createdb {
		t.Fatal("the DATABASE_URL role lacks CREATEDB; live migration closure needs a disposable database (no skip is permitted)")
	}
	name := "peopleflow_ws4ab_" + uniqueSuffix()
	if _, err := admin.ExecContext(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatalf("CREATE DATABASE %s failed (driver text withheld)", name)
	}
	t.Cleanup(func() {
		dctx, dcancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dcancel()
		if _, err := admin.ExecContext(dctx, `DROP DATABASE `+name+` WITH (FORCE)`); err != nil {
			t.Logf("cleanup could not drop %s (driver text withheld); drop it manually", name)
		}
	})
	u := parseDSN(t, base)
	u.Path = "/" + name
	return u.String()
}

// openAdmin opens a database/sql handle on the already-registered pgx driver.
func openAdmin(t *testing.T, dsn string) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal("open database handle failed (driver text withheld)")
	}
	return db
}

// catalogSnapshot returns a normalized pg_catalog snapshot of the public schema — every
// relation with its ordered columns, every constraint, and every index — suitable for
// equality comparison across identical schema states.
func catalogSnapshot(t *testing.T, db *sql.DB) []string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	queries := []string{
		`SELECT c.relname || '|' || c.relkind::text || '|' || COALESCE((
			SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
			FROM pg_catalog.pg_attribute a
			WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '')
			FROM pg_catalog.pg_class c
			JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public'
			ORDER BY 1`,
		`SELECT conname || '|' || contype::text || '|' || conrelid::regclass::text
			FROM pg_catalog.pg_constraint
			WHERE connamespace = 'public'::regnamespace
			ORDER BY 1`,
		`SELECT i.indexrelid::regclass::text || '|' || c.relname || '|' || i.indisunique::text
			FROM pg_catalog.pg_index i
			JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
			JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public'
			ORDER BY 1`,
	}
	var lines []string
	for _, query := range queries {
		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			t.Fatal("pg_catalog snapshot query failed (driver text withheld)")
		}
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				rows.Close()
				t.Fatal("pg_catalog snapshot read failed (driver text withheld)")
			}
			lines = append(lines, line)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			t.Fatal("pg_catalog snapshot read failed (driver text withheld)")
		}
		rows.Close()
	}
	if len(lines) == 0 {
		t.Fatal("pg_catalog snapshot is empty; the public schema should hold the migrated objects")
	}
	return lines
}

// firstDivergence returns the first index where the two sorted snapshots differ.
func firstDivergence(a, b []string) int {
	for i := range min(len(a), len(b)) {
		if a[i] != b[i] {
			return i
		}
	}
	return min(len(a), len(b))
}

// holdAdvisoryLock opens a dedicated connection, takes the migration advisory lock, and
// returns the connection plus the holder's backend PID; cleanup unlocks and closes.
func holdAdvisoryLock(t *testing.T, dsn string) (*sql.Conn, int32) {
	t.Helper()
	db := openAdmin(t, dsn)
	db.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal("holder connection failed (driver text withheld)")
	}
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", advisoryLockKey); err != nil {
		t.Fatal("holder advisory lock acquisition failed (driver text withheld)")
	}
	var pid int32
	if err := conn.QueryRowContext(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatal("holder backend pid probe failed (driver text withheld)")
	}
	t.Cleanup(func() {
		rctx, rcancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer rcancel()
		_, _ = conn.ExecContext(rctx, "SELECT pg_advisory_unlock($1)", advisoryLockKey)
		_ = conn.Close()
		_ = db.Close()
	})
	return conn, pid
}

// waitForLockWait polls pg_stat_activity under a bounded window until the child (identified
// by its unique application_name) is provably waiting on the advisory lock held by holderPID
// (wait_event_type='Lock', holder among pg_blocking_pids). The 50ms pause is poll pacing only;
// the correctness proof is the observed pg_stat_activity state.
func waitForLockWait(t *testing.T, dsn, appName string, holderPID int32) {
	t.Helper()
	db := openAdmin(t, dsn)
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	const probe = `SELECT EXISTS (
		SELECT 1 FROM pg_catalog.pg_stat_activity
		WHERE application_name = $1 AND wait_event_type = 'Lock'
		  AND $2 = ANY(pg_blocking_pids(pid)))`
	for {
		var blocked bool
		if err := db.QueryRowContext(ctx, probe, appName, holderPID).Scan(&blocked); err != nil {
			t.Fatal("pg_stat_activity lock-wait probe failed (driver text withheld)")
		}
		if blocked {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("child %q never observed waiting on the advisory lock within the bounded poll window", appName)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// dsnWithParam sets one runtime parameter on a URL-form DSN.
func dsnWithParam(t *testing.T, dsn, key, value string) string {
	t.Helper()
	u := parseDSN(t, dsn)
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	return u.String()
}

func parseDSN(t *testing.T, dsn string) *url.URL {
	t.Helper()
	u, err := url.Parse(dsn)
	if err != nil || u.Scheme == "" {
		t.Fatal("DATABASE_URL must be URL form for the binary-boundary harness (detail withheld)")
	}
	return u
}

func envWithout(key string) []string {
	return slices.DeleteFunc(slices.Clone(os.Environ()), func(kv string) bool { return strings.HasPrefix(kv, key+"=") })
}

func uniqueSuffix() string { return strings.ReplaceAll(uuid.NewString(), "-", "")[:8] }
