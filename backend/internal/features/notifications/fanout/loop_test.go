package fanout

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// countingTicker records calls; behaviour fields are atomics so the test can
// switch them while the loop goroutine runs (race-free), and ticked reports
// each completed call so the test never races the loop.
type countingTicker struct {
	calls  atomic.Int32
	panics atomic.Bool
	err    error
	failAt atomic.Bool
	ticked chan struct{}
}

func (c *countingTicker) Tick(context.Context) (int, error) {
	c.calls.Add(1)
	if c.ticked != nil {
		defer func() { c.ticked <- struct{}{} }()
	}
	if c.panics.Load() {
		panic("event data")
	}
	if c.failAt.Load() || (c.ticked == nil && c.err != nil) {
		return 0, c.err
	}
	return 0, nil
}

// The loop ticks once at start and on every period, survives errors and
// panics without logging their content, and returns when ctx ends. Each step
// waits for the tick to complete, so the count is deterministic.
func TestLoopRunsAtStartAndEveryTickUntilCancelled(t *testing.T) {
	var logs bytes.Buffer
	ticker := &countingTicker{err: errors.New("secret cause"), ticked: make(chan struct{})}
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
	wait() // tick at start (panics)
	ticks <- time.Now()
	wait() // panics again
	ticker.panics.Store(false)
	ticker.failAt.Store(true)
	ticks <- time.Now()
	wait() // error
	ticker.failAt.Store(false)
	ticks <- time.Now()
	wait() // ok
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("loop did not stop")
	}
	if got, period := ticker.calls.Load(), <-periods; got != 4 || period != 2*time.Second {
		t.Fatalf("calls=%d period=%s", got, period)
	}
	out := logs.String()
	if strings.Contains(out, "event data") || strings.Contains(out, "secret cause") || strings.Count(out, "notification fan-out tick failed") != 3 {
		t.Fatalf("logs: %s", out)
	}
}

func TestLoopDoesNotStartWithCancelledContext(t *testing.T) {
	ticker := &countingTicker{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	NewLoop(ticker, nil).Run(ctx)
	if ticker.calls.Load() != 0 {
		t.Fatal("ticked after cancel")
	}
}
