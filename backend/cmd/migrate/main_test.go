package main

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const fakeDSN = "postgres://migrator:super-secret@127.0.0.1:1/none?sslmode=disable" // must never reach output

var lockConnBounded, lockExecBounded bool // deadline probes: ctx handed to db.Conn (via ResetSession) and to the pg_advisory_lock exec

// stubDrv: no live DB; goose queries fail (migration failure), lock exec succeeds, unlock fails iff failUnlock.
type stubDrv struct{ failUnlock bool }

func (d stubDrv) Open(string) (driver.Conn, error) { return &stubConn{d.failUnlock}, nil }

type stubConn struct{ failUnlock bool }

func (c *stubConn) ExecContext(ctx context.Context, q string, _ []driver.NamedValue) (driver.Result, error) {
	isLock := q == "SELECT pg_advisory_lock($1)"
	if isLock {
		_, lockExecBounded = ctx.Deadline()
	}
	if isLock || (q == "SELECT pg_advisory_unlock($1)" && !c.failUnlock) {
		return driver.RowsAffected(1), nil
	}
	return nil, errors.New("no")
}

func (stubConn) ResetSession(ctx context.Context) error { // observes the acquiring ctx database/sql passes back on pool reuse (the db.Conn ctx)
	_, lockConnBounded = ctx.Deadline()
	return nil
}
func (stubConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return nil, errors.New("no")
}
func (stubConn) Ping(context.Context) error          { return nil }
func (stubConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("no") }
func (stubConn) Close() error                        { return nil }
func (stubConn) Begin() (driver.Tx, error)           { return nil, errors.New("no") }

func init() {
	sql.Register("stub-unlock-fails", stubDrv{true})
	sql.Register("stub-unlock-works", stubDrv{false})
}

func decodeFailure(t *testing.T, stderr bytes.Buffer) failure {
	t.Helper()
	var f failure
	if err := json.Unmarshal(stderr.Bytes(), &f); err != nil {
		t.Fatalf("stderr is not exactly one structured JSON failure: %q", stderr.String())
	}
	return f
}

func assertNoLeak(t *testing.T, out string) {
	t.Helper()
	for _, banned := range []string{fakeDSN, "super-secret", "postgres://"} {
		if strings.Contains(out, banned) {
			t.Errorf("output leaks %q: %q", banned, out)
		}
	}
}

// TestRunClassifiedFailuresAreStaticSingleRecords pins parse/config failures
func TestRunClassifiedFailuresAreStaticSingleRecords(t *testing.T) {
	for _, tc := range []struct {
		name, cmd, stage, msg string
		args                  []string
		empty                 bool // force empty DATABASE_URL
	}{
		{"no args", "", stageParse, "usage: migrate {up|down|status}", nil, false},
		{"two args", "", stageParse, "usage: migrate {up|down|status}", []string{"up", "down"}, false},
		{"invalid command", "", stageParse, "usage: migrate {up|down|status}", []string{"seed"}, false},
		{"missing config", "status", stageConfig, "DATABASE_URL is required", []string{"status"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.empty {
				t.Setenv("DATABASE_URL", "")
			}
			var stderr bytes.Buffer
			if code := run(context.Background(), tc.args, &bytes.Buffer{}, &stderr); code != exitFailure {
				t.Fatalf("exit = %d, want %d", code, exitFailure)
			}
			if f := decodeFailure(t, stderr); f.Command != tc.cmd || f.Stage != tc.stage || f.Error != tc.msg {
				t.Errorf("failure = %+v, want static %s record", f, tc.stage)
			}
			for _, arg := range tc.args {
				if _, ok := parseCommand(arg); !ok && strings.Contains(stderr.String(), arg) {
					t.Errorf("invalid input %q echoed: %q", arg, stderr.String())
				}
			}
			assertNoLeak(t, stderr.String())
		})
	}
}

// TestRunUnreachableDatabaseStaticPing proves a live ping attempt exits non-zero with the static message, leak-free.
func TestRunUnreachableDatabaseStaticPing(t *testing.T) {
	t.Setenv("DATABASE_URL", fakeDSN)
	var stderr bytes.Buffer
	if code := run(context.Background(), []string{"status"}, &bytes.Buffer{}, &stderr); code != exitFailure {
		t.Fatalf("exit = %d, want %d", code, exitFailure)
	}
	f := decodeFailure(t, stderr)
	if f.Command != "status" || f.Stage != stagePing || f.Error != "database is not reachable" {
		t.Errorf("failure = %+v, want static ping failure", f)
	}
	assertNoLeak(t, stderr.String())
}

// TestAdvisoryLockKeyMatchesDocumentedHex pins the decimal value of documented hex "PF_MIGR".
func TestAdvisoryLockKeyMatchesDocumentedHex(t *testing.T) {
	if advisoryLockKey != 22595373269337938 {
		t.Fatalf("advisoryLockKey = %d, want 22595373269337938 (hex 50465F4D494752)", advisoryLockKey)
	}
}

// TestNewUnlockContextIndependentAndBounded proves parent-cancel survival + bounded deadline.
func TestNewUnlockContextIndependentAndBounded(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	uctx, ucancel := newUnlockContext(parent)
	defer ucancel()
	if err := uctx.Err(); err != nil {
		t.Fatalf("unlock context cancelled with parent: %v", err)
	}
	deadline, ok := uctx.Deadline()
	if !ok {
		t.Fatal("unlock context has no deadline")
	}
	if remaining := time.Until(deadline); remaining <= 0 || remaining > unlockTimeout {
		t.Errorf("deadline remaining %s, want within (0, %s]", remaining, unlockTimeout)
	}
}

func TestRunUnlockFailureAfterSuccessIsRecovered(t *testing.T) { // success + failing unlock → exit 0, no record (R4-001)
	t.Setenv("DATABASE_URL", fakeDSN)
	databaseDriver = "stub-unlock-fails"
	migrateFn = func(context.Context, *sql.DB, string) error { return nil }
	t.Cleanup(func() { databaseDriver, migrateFn = "pgx", migrate })
	var stderr bytes.Buffer
	if code := run(context.Background(), []string{"down"}, &bytes.Buffer{}, &stderr); code != 0 || stderr.Len() != 0 {
		t.Fatalf("exit = %d, stderr = %q; want exit 0 and no failure record", code, stderr.String())
	}
}

// TestRunLockAcquisitionIsBounded proves both obtaining the dedicated *sql.Conn and the blocking pg_advisory_lock exec run on a deadline-bounded context (R3).
func TestRunLockAcquisitionIsBounded(t *testing.T) {
	t.Setenv("DATABASE_URL", fakeDSN)
	databaseDriver, migrateFn = "stub-unlock-works", func(context.Context, *sql.DB, string) error { return nil }
	t.Cleanup(func() { databaseDriver, migrateFn = "pgx", migrate })
	lockConnBounded, lockExecBounded = false, false
	var stderr bytes.Buffer
	if code := run(context.Background(), []string{"up"}, &bytes.Buffer{}, &stderr); code != 0 || !lockConnBounded || !lockExecBounded {
		t.Fatalf("exit = %d, lock-stage deadline probes (conn, exec) = (%t, %t), stderr = %q; want success with both contexts deadline-bounded", code, lockConnBounded, lockExecBounded, stderr.String())
	}
}

// TestRunMigrationUnlockAggregatesToExactlyOneRecord drives the real migration+unlock paths through stub drivers (goose work always fails).
func TestRunMigrationUnlockAggregatesToExactlyOneRecord(t *testing.T) {
	for _, tc := range []struct {
		drv, stage, msg string
	}{
		{"stub-unlock-fails", stageUnlock, "could not release the migration lock"},
		{"stub-unlock-works", stageMigration, "migration operation failed"},
	} {
		t.Run(tc.drv, func(t *testing.T) {
			t.Setenv("DATABASE_URL", fakeDSN)
			databaseDriver = tc.drv
			t.Cleanup(func() { databaseDriver = "pgx" })
			var stderr bytes.Buffer
			if code := run(context.Background(), []string{"up"}, &bytes.Buffer{}, &stderr); code != exitFailure {
				t.Fatalf("exit = %d, want %d", code, exitFailure)
			}
			f := decodeFailure(t, stderr)
			if f.Command != "up" || f.Stage != tc.stage || f.Error != tc.msg {
				t.Errorf("failure = %+v, want single static %s record", f, tc.stage)
			}
			assertNoLeak(t, stderr.String())
		})
	}
}
