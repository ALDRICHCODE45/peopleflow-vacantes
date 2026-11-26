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

type countingTicker struct {
	calls atomic.Int32
	panic bool
	err   error
}

func (c *countingTicker) Tick(context.Context) (int, error) {
	c.calls.Add(1)
	if c.panic {
		panic("event data")
	}
	return 0, c.err
}

// The loop ticks once at start and on every period, survives errors and
// panics without logging their content, and returns when ctx ends.
func TestLoopRunsAtStartAndEveryTickUntilCancelled(t *testing.T) {
	var logs bytes.Buffer
	ticker := &countingTicker{panic: true}
	ticks := make(chan time.Time)
	var period time.Duration
	loop := &Loop{Ticker: ticker, Interval: Interval, Logger: slog.New(slog.NewJSONHandler(&logs, nil)),
		NewTicker: func(p time.Duration) (<-chan time.Time, func()) { period = p; return ticks, func() {} }}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); loop.Run(ctx) }()
	ticks <- time.Now()
	ticker.panic, ticker.err = false, errors.New("secret cause")
	ticks <- time.Now()
	ticks <- time.Now()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("loop did not stop")
	}
	if got := ticker.calls.Load(); got != 4 || period != 2*time.Second {
		t.Fatalf("calls=%d period=%s", got, period)
	}
	if strings.Contains(logs.String(), "event data") || strings.Contains(logs.String(), "secret cause") || !strings.Contains(logs.String(), "notification fan-out tick failed") {
		t.Fatalf("logs: %s", logs.String())
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
