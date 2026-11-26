package schedule

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type fakeRunner struct {
	calls  atomic.Int32
	panics atomic.Bool
	fail   atomic.Bool
	done   chan struct{}
}

func (r *fakeRunner) RunOnce(context.Context) (Result, error) {
	r.calls.Add(1)
	if r.done != nil {
		defer func() { r.done <- struct{}{} }()
	}
	if r.panics.Load() {
		panic("recipient data")
	}
	if r.fail.Load() {
		return Result{}, stepErr(stepInsert, &pgconn.PgError{Code: "23505", Message: "secret value"})
	}
	return Result{DeliveryCreated: 2, AssignmentCreated: 1, Resolved: 3}, nil
}

// fakeLock runs fn unless held is set (another instance has the lock).
type fakeLock struct {
	held atomic.Bool
	runs atomic.Int32
}

func (l *fakeLock) TryRun(ctx context.Context, fn func(context.Context) error) (bool, error) {
	if l.held.Load() {
		return false, nil
	}
	l.runs.Add(1)
	return true, fn(ctx)
}

// D20: one run at start and one per 15-min tick, each under the lock; a held
// lock skips the run; panics and errors never end the loop and are logged
// value-free (step + SQLSTATE + counts only).
func TestSchedulerRunsAtStartAndEveryTickUnderTheLock(t *testing.T) {
	var logs syncBuffer
	runner := &fakeRunner{done: make(chan struct{})}
	runner.panics.Store(true)
	lock := &fakeLock{}
	ticks := make(chan time.Time)
	periods := make(chan time.Duration, 1)
	s := &Scheduler{Runner: runner, Lock: lock, Interval: Interval, Logger: slog.New(slog.NewJSONHandler(&logs, nil)),
		NewTicker: func(p time.Duration) (<-chan time.Time, func()) { periods <- p; return ticks, func() {} }}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); s.Run(ctx) }()
	wait := func() {
		select {
		case <-runner.done:
		case <-time.After(5 * time.Second):
			t.Fatal("run did not complete")
		}
	}
	wait() // start: panics
	runner.panics.Store(false)
	runner.fail.Store(true)
	ticks <- time.Now()
	wait() // error
	runner.fail.Store(false)
	ticks <- time.Now()
	wait() // ok
	lock.held.Store(true)
	ticks <- time.Now() // skipped: the runner is not called, so wait for the log line
	deadline := time.After(5 * time.Second)
	for !strings.Contains(logs.String(), "lock_held") {
		select {
		case <-deadline:
			t.Fatal("skip not logged")
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("scheduler did not stop")
	}
	if got, period := runner.calls.Load(), <-periods; got != 3 || period != 15*time.Minute {
		t.Fatalf("calls=%d period=%s", got, period)
	}
	out := logs.String()
	for _, banned := range []string{"recipient data", "secret value"} {
		if strings.Contains(out, banned) {
			t.Fatalf("value leaked in logs: %s", out)
		}
	}
	for _, want := range []string{`"cause":"panic"`, `"step":"insert"`, `"sqlstate":"23505"`, `"delivery_created":2`, `"assignment_created":1`, `"resolved":3`, `"reason":"lock_held"`} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %s in logs: %s", want, out)
		}
	}
}

// syncBuffer lets the test poll the logs while the scheduler goroutine writes.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestSchedulerDoesNotStartWithCancelledContext(t *testing.T) {
	runner := &fakeRunner{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	NewScheduler(runner, &fakeLock{}, nil).Run(ctx)
	if runner.calls.Load() != 0 {
		t.Fatal("ran after cancel")
	}
}

func TestClassifyIsValueFree(t *testing.T) {
	err := stepErr(stepResolve, &pgconn.PgError{Code: "40P01", Message: "detail"})
	if s, code := classify(err); s != "resolve" || code != "40P01" {
		t.Fatalf("classify = %s %s", s, code)
	}
	if s, code := classify(errors.New("x")); s != "unknown" || code != "" {
		t.Fatalf("classify plain = %s %s", s, code)
	}
}
