//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The advisory lock against a real PostgreSQL (the isolated draft_test harness of reconcile_integration_test.go): a second
// instance (another AdvisoryLock on its own connection) skips while the first sweeps, and the lock never outlives the sweep.

// lockIsFree reports whether a fresh session can take the reconcile key right now (and gives it back).
func lockIsFree(t *testing.T, pool *pgxpool.Pool) bool {
	t.Helper()
	conn, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	var got bool
	if err := conn.QueryRow(context.Background(), `SELECT pg_try_advisory_lock($1)`, ReconcileLockKey).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got {
		if _, err := conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, ReconcileLockKey); err != nil {
			t.Fatal(err)
		}
	}
	return got
}

func TestAdvisoryLockAgainstDatabase_OnlyOneInstanceRuns(t *testing.T) {
	pool := reconcileTestPool(t)
	first, second := NewAdvisoryLock(pool), NewAdvisoryLock(pool)

	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		ran, err := first.TryRun(context.Background(), func(context.Context) error {
			close(entered)
			<-release
			return nil
		})
		if err == nil && !ran {
			err = errors.New("first instance did not get the lock")
		}
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the first instance never took the lock")
	}

	// While the first sweeps, the second skips without waiting and without running.
	started := time.Now()
	ran, err := second.TryRun(context.Background(), func(context.Context) error {
		t.Error("the second instance ran while the lock was held")
		return nil
	})
	if err != nil || ran {
		t.Fatalf("second: ran=%v err=%v", ran, err)
	}
	if time.Since(started) > 5*time.Second {
		t.Fatal("pg_try_advisory_lock must not wait")
	}
	if lockIsFree(t, pool) {
		t.Fatal("the key is free while the first instance holds it")
	}

	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	// Released: the second instance now runs, and the key is free again afterwards.
	ran, err = second.TryRun(context.Background(), func(context.Context) error { return nil })
	if err != nil || !ran {
		t.Fatalf("second after release: ran=%v err=%v", ran, err)
	}
	if !lockIsFree(t, pool) {
		t.Fatal("the lock leaked after the sweep")
	}
}

func TestAdvisoryLockAgainstDatabase_ReleasedAfterErrorAndCancel(t *testing.T) {
	pool := reconcileTestPool(t)
	lock := NewAdvisoryLock(pool)

	boom := errors.New("sweep failed")
	if ran, err := lock.TryRun(context.Background(), func(context.Context) error { return boom }); !ran || !errors.Is(err, boom) {
		t.Fatalf("error run: ran=%v err=%v", ran, err)
	}
	if !lockIsFree(t, pool) {
		t.Fatal("the lock leaked after a failed sweep")
	}

	ctx, cancel := context.WithCancel(context.Background())
	ran, err := lock.TryRun(ctx, func(ctx context.Context) error { cancel(); return ctx.Err() })
	if !ran || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled run: ran=%v err=%v", ran, err)
	}
	if !lockIsFree(t, pool) {
		t.Fatal("the lock leaked after a shutdown during the sweep")
	}

	func() {
		defer func() { _ = recover() }()
		_, _ = lock.TryRun(context.Background(), func(context.Context) error { panic("boom") })
	}()
	if !lockIsFree(t, pool) {
		t.Fatal("the lock leaked after a panic")
	}
}
