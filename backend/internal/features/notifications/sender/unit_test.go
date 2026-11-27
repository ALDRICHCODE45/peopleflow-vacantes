package sender

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// fakeClock drives the bucket: sleep advances the clock and records the wait.
type fakeClock struct {
	now   time.Time
	slept []time.Duration
}

func (c *fakeClock) Now() time.Time { return c.now }
func (c *fakeClock) Sleep(ctx context.Context, d time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.slept = append(c.slept, d)
	c.now = c.now.Add(d)
	return nil
}

// §Sender throttle: per-instance pacing at NOTIFICATIONS_EMAIL_MAX_PER_SECOND,
// burst one: the first token is immediate, the next ones wait 1/rate; idle
// time does not accumulate a burst.
func TestBucketPacesAtTheRate(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)}
	b := NewBucket(2, clock.Now, clock.Sleep)
	ctx := context.Background()
	for range 3 {
		if err := b.Wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if len(clock.slept) != 2 || clock.slept[0] != 500*time.Millisecond || clock.slept[1] != 500*time.Millisecond {
		t.Fatalf("slept %v", clock.slept)
	}
	clock.now = clock.now.Add(10 * time.Second) // idle
	clock.slept = nil
	for range 2 {
		if err := b.Wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if len(clock.slept) != 1 || clock.slept[0] != 500*time.Millisecond {
		t.Fatalf("after idle slept %v (no burst accumulates)", clock.slept)
	}
}

// Default rate 1/s; a cancelled context refuses the token.
func TestBucketDefaultsAndCancellation(t *testing.T) {
	clock := &fakeClock{now: time.Unix(0, 0)}
	b := NewBucket(0, clock.Now, clock.Sleep)
	ctx, cancel := context.WithCancel(context.Background())
	if err := b.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if err := b.Wait(ctx); err != nil || len(clock.slept) != 1 || clock.slept[0] != time.Second {
		t.Fatalf("default rate: %v %v", err, clock.slept)
	}
	cancel()
	if err := b.Wait(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled: %v", err)
	}
	// The real sleep honours cancellation too.
	real := NewBucket(1, nil, nil)
	_ = real.Wait(context.Background())
	short, stop := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer stop()
	if err := real.Wait(short); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("real sleep: %v", err)
	}
}

type countingTicker struct {
	calls  atomic.Int32
	panics atomic.Bool
	fail   atomic.Bool
	ticked chan struct{}
}

func (c *countingTicker) Tick(context.Context) (int, error) {
	c.calls.Add(1)
	defer func() { c.ticked <- struct{}{} }()
	if c.panics.Load() {
		panic("message body")
	}
	if c.fail.Load() {
		return 0, stepErr(stepClaim, &pgconn.PgError{Code: "57P01", Message: "secret detail"})
	}
	return 0, nil
}

// The loop ticks at start and every Interval (5 s), survives panics and
// errors logging only the step and SQLSTATE, and returns when ctx ends.
func TestLoopRunsAtStartAndEveryTickUntilCancelled(t *testing.T) {
	var logs bytes.Buffer
	ticker := &countingTicker{ticked: make(chan struct{})}
	ticker.panics.Store(true)
	ticks := make(chan time.Time)
	periods := make(chan time.Duration, 1)
	loop := &Loop{Ticker: ticker, Interval: Interval, Logger: slog.New(slog.NewJSONHandler(&logs, nil)),
		NewTicker: func(p time.Duration) (<-chan time.Time, func()) { periods <- p; return ticks, func() {} }}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); loop.Run(ctx) }()
	wait := func() {
		select {
		case <-ticker.ticked:
		case <-time.After(5 * time.Second):
			t.Fatal("tick did not complete")
		}
	}
	wait() // at start: panic
	ticker.panics.Store(false)
	ticker.fail.Store(true)
	ticks <- time.Now()
	wait() // error
	ticker.fail.Store(false)
	ticks <- time.Now()
	wait() // ok
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("loop did not stop")
	}
	if got, period := ticker.calls.Load(), <-periods; got != 3 || period != 5*time.Second {
		t.Fatalf("calls=%d period=%s", got, period)
	}
	out := logs.String()
	if strings.Contains(out, "message body") || strings.Contains(out, "secret detail") || strings.Count(out, "notification email sender tick failed") != 2 ||
		!strings.Contains(out, `"step":"claim"`) || !strings.Contains(out, `"sqlstate":"57P01"`) {
		t.Fatalf("logs:\n%s", out)
	}
}

// The contract's numbers (§Sender, §Limits).
func TestSenderConstants(t *testing.T) {
	if Interval != 5*time.Second || BatchSize != 20 || Lease != 2*time.Minute || MaxAttempts != 8 || RetryBase != time.Minute ||
		RetryCap != time.Hour || SendTimeout != 15*time.Second {
		t.Fatal("sender constants drifted from the contract")
	}
}

// A sender built without a throttle or logger still works (defaults).
func TestNewDefaults(t *testing.T) {
	s := New(nil, nil, nil, nil, nil)
	if s.throttle == nil || s.logger == nil || s.batch != BatchSize || s.lease != Lease || s.maxAttempts != MaxAttempts {
		t.Fatalf("defaults: %+v", s)
	}
}
