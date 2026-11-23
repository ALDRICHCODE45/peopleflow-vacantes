package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// fakeLockConn answers the two advisory statements from a script and records what happened to the connection.
type fakeLockConn struct {
	calls      []lockCall
	tryResult  bool
	tryErr     error
	unlockOK   bool
	unlockErr  error
	released   int
	closed     int
	unlockErr2 error // the context's error when the unlock statement ran
	unlockSeen bool
	closeOrder []string
}

type lockCall struct {
	sql  string
	args []any
}

type fakeRow struct {
	value bool
	err   error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*(dest[0].(*bool)) = r.value
	return nil
}

func (c *fakeLockConn) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	c.calls = append(c.calls, lockCall{sql: sql, args: args})
	switch {
	case strings.Contains(sql, "pg_try_advisory_lock"):
		return fakeRow{value: c.tryResult, err: c.tryErr}
	case strings.Contains(sql, "pg_advisory_unlock"):
		c.unlockSeen, c.unlockErr2 = true, ctx.Err()
		return fakeRow{value: c.unlockOK, err: c.unlockErr}
	}
	panic("unexpected statement: " + sql)
}

func (c *fakeLockConn) Release() { c.released++; c.closeOrder = append(c.closeOrder, "release") }
func (c *fakeLockConn) Close(context.Context) {
	c.closed++
	c.closeOrder = append(c.closeOrder, "close")
}
func (c *fakeLockConn) statements() (out []string) {
	for _, call := range c.calls {
		out = append(out, strings.Fields(call.sql)[1])
	}
	return out
}

type fakeLockSource struct {
	conn *fakeLockConn
	err  error
}

func (s fakeLockSource) acquire(context.Context) (lockConn, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.conn, nil
}

func newTestLock(conn *fakeLockConn) *AdvisoryLock {
	return &AdvisoryLock{source: fakeLockSource{conn: conn}, key: ReconcileLockKey}
}

func TestReconcileLockKeyIsADedicatedConstant(t *testing.T) {
	// "docs_rec": a fixed key of its own, not derived from a name, so it can never collide with the hashed per-slug locks or the CV lock.
	if ReconcileLockKey != 0x646f63735f726563 {
		t.Fatalf("key = %#x", ReconcileLockKey)
	}
}

func TestAdvisoryLock_RunsFnUnderTheSessionLockAndReleasesIt(t *testing.T) {
	conn := &fakeLockConn{tryResult: true, unlockOK: true}
	ran := false
	got, err := newTestLock(conn).TryRun(context.Background(), func(context.Context) error {
		ran = true
		if !reflect.DeepEqual(conn.statements(), []string{"pg_try_advisory_lock($1)"}) {
			t.Fatalf("before fn: %v", conn.statements())
		}
		return nil
	})
	if err != nil || !got || !ran {
		t.Fatalf("ran=%v got=%v err=%v", ran, got, err)
	}
	if !reflect.DeepEqual(conn.statements(), []string{"pg_try_advisory_lock($1)", "pg_advisory_unlock($1)"}) {
		t.Fatalf("statements: %v", conn.statements())
	}
	for _, call := range conn.calls {
		if !reflect.DeepEqual(call.args, []any{ReconcileLockKey}) {
			t.Fatalf("args: %v", call.args)
		}
	}
	if conn.released != 1 || conn.closed != 0 {
		t.Fatalf("released %d closed %d: a cleanly unlocked connection goes back to the pool", conn.released, conn.closed)
	}
}

func TestAdvisoryLock_SkipsWhenAnotherSessionHoldsIt(t *testing.T) {
	conn := &fakeLockConn{tryResult: false}
	got, err := newTestLock(conn).TryRun(context.Background(), func(context.Context) error {
		t.Fatal("fn ran without the lock")
		return nil
	})
	if err != nil || got {
		t.Fatalf("got=%v err=%v", got, err)
	}
	if !reflect.DeepEqual(conn.statements(), []string{"pg_try_advisory_lock($1)"}) || conn.released != 1 || conn.closed != 0 {
		t.Fatalf("statements %v released %d closed %d: nothing to unlock, the connection is returned", conn.statements(), conn.released, conn.closed)
	}
}

func TestAdvisoryLock_FnErrorIsReturnedAndTheLockStillReleased(t *testing.T) {
	boom := errors.New("sweep failed")
	conn := &fakeLockConn{tryResult: true, unlockOK: true}
	got, err := newTestLock(conn).TryRun(context.Background(), func(context.Context) error { return boom })
	if !got || !errors.Is(err, boom) {
		t.Fatalf("got=%v err=%v", got, err)
	}
	if !reflect.DeepEqual(conn.statements(), []string{"pg_try_advisory_lock($1)", "pg_advisory_unlock($1)"}) || conn.released != 1 {
		t.Fatalf("statements %v released %d", conn.statements(), conn.released)
	}
}

func TestAdvisoryLock_FnPanicStillReleasesTheLock(t *testing.T) {
	conn := &fakeLockConn{tryResult: true, unlockOK: true}
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("the panic must propagate to the scheduler's recover")
			}
		}()
		_, _ = newTestLock(conn).TryRun(context.Background(), func(context.Context) error { panic("boom") })
	}()
	if !reflect.DeepEqual(conn.statements(), []string{"pg_try_advisory_lock($1)", "pg_advisory_unlock($1)"}) || conn.released != 1 {
		t.Fatalf("statements %v released %d", conn.statements(), conn.released)
	}
}

// A session lock outlives the statement: if it cannot be proven released, the connection is closed so Postgres drops the lock.
func TestAdvisoryLock_UnlockFailureClosesTheConnectionInsteadOfPoolingIt(t *testing.T) {
	for name, conn := range map[string]*fakeLockConn{
		"unlock error":     {tryResult: true, unlockErr: errors.New("connection reset")},
		"not held (false)": {tryResult: true, unlockOK: false},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := newTestLock(conn).TryRun(context.Background(), func(context.Context) error { return nil })
			if !got || err != nil {
				t.Fatalf("got=%v err=%v: the sweep itself succeeded", got, err)
			}
			if conn.closed != 1 || conn.released != 0 {
				t.Fatalf("closed %d released %d", conn.closed, conn.released)
			}
		})
	}
}

// Shutdown cancels the sweep's context; the unlock must not inherit that cancellation or the lock would linger.
func TestAdvisoryLock_UnlockSurvivesACancelledContext(t *testing.T) {
	conn := &fakeLockConn{tryResult: true, unlockOK: true}
	ctx, cancel := context.WithCancel(context.Background())
	got, err := newTestLock(conn).TryRun(ctx, func(context.Context) error { cancel(); return ctx.Err() })
	if !got || !errors.Is(err, context.Canceled) {
		t.Fatalf("got=%v err=%v", got, err)
	}
	if !conn.unlockSeen || conn.unlockErr2 != nil {
		t.Fatal("the unlock ran on a cancelled context")
	}
	if conn.released != 1 || conn.closed != 0 {
		t.Fatalf("released %d closed %d", conn.released, conn.closed)
	}
}

func TestAdvisoryLock_TryLockFailureClosesTheConnectionAndReportsAnError(t *testing.T) {
	conn := &fakeLockConn{tryErr: errors.New("timeout")}
	got, err := newTestLock(conn).TryRun(context.Background(), func(context.Context) error {
		t.Fatal("fn ran")
		return nil
	})
	if got || err == nil {
		t.Fatalf("got=%v err=%v", got, err)
	}
	// The statement may have taken the lock before the answer was lost: drop the connection, never pool it.
	if conn.closed != 1 || conn.released != 0 {
		t.Fatalf("closed %d released %d", conn.closed, conn.released)
	}
}

func TestAdvisoryLock_AcquireFailureIsAnError(t *testing.T) {
	lock := &AdvisoryLock{source: fakeLockSource{err: errors.New("pool closed")}, key: ReconcileLockKey}
	got, err := lock.TryRun(context.Background(), func(context.Context) error {
		t.Fatal("fn ran")
		return nil
	})
	if got || err == nil {
		t.Fatalf("got=%v err=%v", got, err)
	}
}
