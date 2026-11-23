package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReconcileLockKey is the Postgres advisory-lock key that lets one API instance run the documents sweep at a time (Q8). It is
// the ASCII of "docs_rec": a fixed key of its own, so it cannot collide with the CV storage lock or the hashed per-slug locks.
const ReconcileLockKey int64 = 0x646f63735f726563

// unlockTimeout bounds the release; it runs on a context that outlives a shutdown cancellation.
const unlockTimeout = 5 * time.Second

// lockConn is the dedicated connection a session-level advisory lock lives on.
type lockConn interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	// Release returns the connection to the pool.
	Release()
	// Close discards the connection instead (Postgres drops its session locks).
	Close(ctx context.Context)
}

type lockSource interface {
	acquire(ctx context.Context) (lockConn, error)
}

type poolSource struct{ pool *pgxpool.Pool }

func (s poolSource) acquire(ctx context.Context) (lockConn, error) {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	return pooledConn{conn}, nil
}

type pooledConn struct{ *pgxpool.Conn }

func (c pooledConn) Close(ctx context.Context) { _ = c.Hijack().Close(ctx) }

// AdvisoryLock implements documents.Lock with pg_try_advisory_lock. The lock is session-level on a connection of its own,
// so the sweep (which lists a bucket and makes one lookup per object) holds no transaction open and no row lock; it only
// parks one pooled connection while it runs.
type AdvisoryLock struct {
	source lockSource
	key    int64
}

// NewAdvisoryLock builds the lock over the pool with ReconcileLockKey.
func NewAdvisoryLock(pool *pgxpool.Pool) *AdvisoryLock {
	return &AdvisoryLock{source: poolSource{pool: pool}, key: ReconcileLockKey}
}

// TryRun takes the lock without waiting. When another session holds it, fn is not called and ran is false. The lock is released
// before TryRun returns, also when fn panics or its context is cancelled. If the release cannot be confirmed, the connection is
// closed rather than pooled: a session lock must never leak back into the pool.
func (l *AdvisoryLock) TryRun(ctx context.Context, fn func(context.Context) error) (ran bool, err error) {
	conn, err := l.source.acquire(ctx)
	if err != nil {
		return false, errors.New("documents reconcile lock unavailable")
	}
	var acquired bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, l.key).Scan(&acquired); err != nil {
		// The statement may have taken the lock before the answer was lost.
		discard(conn)
		return false, errors.New("documents reconcile lock failed")
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
			conn.Close(unlockCtx)
			return
		}
		conn.Release()
	}()
	return true, fn(ctx)
}

func discard(conn lockConn) {
	ctx, cancel := context.WithTimeout(context.Background(), unlockTimeout)
	defer cancel()
	conn.Close(ctx)
}
