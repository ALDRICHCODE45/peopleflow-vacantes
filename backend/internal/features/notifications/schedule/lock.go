package schedule

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LockKey is the session advisory-lock key that lets one API instance run the
// scheduler at a time (D20): the ASCII of "notif_sc", a fixed key of its own
// (the documents sweep uses "docs_rec").
const LockKey int64 = 0x6e6f7469665f7363

// unlockTimeout bounds the release; it runs on a context that outlives a shutdown cancellation.
const unlockTimeout = 5 * time.Second

// AdvisoryLock implements Lock with pg_try_advisory_lock on a dedicated pooled
// connection (the documents ReconcileScheduler pattern). The run itself uses
// other pool connections; the lock only serialises runs across instances.
type AdvisoryLock struct {
	pool *pgxpool.Pool
	key  int64
}

// NewAdvisoryLock builds the lock over the pool with LockKey.
func NewAdvisoryLock(pool *pgxpool.Pool) *AdvisoryLock {
	return &AdvisoryLock{pool: pool, key: LockKey}
}

// TryRun takes the lock without waiting. When another session holds it, fn is
// not called and ran is false. The lock is released before TryRun returns,
// also when fn panics or its context is cancelled; if the release cannot be
// confirmed the connection is closed rather than pooled, so a session lock
// never leaks back into the pool.
func (l *AdvisoryLock) TryRun(ctx context.Context, fn func(context.Context) error) (ran bool, err error) {
	conn, err := l.pool.Acquire(ctx)
	if err != nil {
		return false, stepErr(stepLock, err)
	}
	var acquired bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, l.key).Scan(&acquired); err != nil {
		// The statement may have taken the lock before the answer was lost.
		closeConn(context.Background(), conn)
		return false, stepErr(stepLock, err)
	}
	if !acquired {
		conn.Release()
		return false, nil
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), unlockTimeout)
		defer cancel()
		var released bool
		if err := conn.QueryRow(unlockCtx, `SELECT pg_advisory_unlock($1)`, l.key).Scan(&released); err != nil || !released {
			closeConn(unlockCtx, conn)
			return
		}
		conn.Release()
	}()
	return true, fn(ctx)
}

// closeConn discards the connection (Postgres drops its session locks).
func closeConn(ctx context.Context, conn *pgxpool.Conn) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), unlockTimeout)
	defer cancel()
	_ = conn.Hijack().Close(ctx)
}
