package fanout

import (
	"context"
	"log/slog"
	"time"
)

// Interval is the fan-out period (D4).
const Interval = 2 * time.Second

// Ticker is what the loop runs each period (Processor in production).
type Ticker interface {
	Tick(ctx context.Context) (int, error)
}

// Loop runs Tick once at start and then every Interval until ctx ends. No
// advisory lock: every instance runs one and SKIP LOCKED splits the work.
type Loop struct {
	Ticker   Ticker
	Interval time.Duration
	// NewTicker is the injected clock: a channel that delivers once per period and its release.
	NewTicker func(period time.Duration) (<-chan time.Time, func())
	Logger    *slog.Logger
}

// NewLoop builds the production loop; a nil logger means slog.Default().
func NewLoop(ticker Ticker, logger *slog.Logger) *Loop {
	if logger == nil {
		logger = slog.Default()
	}
	return &Loop{Ticker: ticker, Interval: Interval, NewTicker: realTicker, Logger: logger}
}

func realTicker(period time.Duration) (<-chan time.Time, func()) {
	t := time.NewTicker(period)
	return t.C, t.Stop
}

// Run blocks until ctx is cancelled. A tick still running finishes its
// current event tx (ctx cancellation aborts it) before Run returns.
func (l *Loop) Run(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	l.runOnce(ctx)
	interval := l.Interval
	if interval <= 0 {
		interval = Interval
	}
	newTicker := l.NewTicker
	if newTicker == nil {
		newTicker = realTicker
	}
	ticks, stop := newTicker(interval)
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			if ctx.Err() != nil {
				return
			}
			l.runOnce(ctx)
		}
	}
}

// runOnce is one tick; nothing escapes it, not an error and not a panic.
func (l *Loop) runOnce(ctx context.Context) {
	logger := l.Logger
	if logger == nil {
		logger = slog.Default()
	}
	defer func() {
		if recover() != nil {
			// The panic value is not logged: it may carry event data.
			logger.Error("notification fan-out tick failed", "cause", "panic")
		}
	}()
	if _, err := l.Ticker.Tick(ctx); err != nil && ctx.Err() == nil {
		logger.Error("notification fan-out tick failed", "code_class", "internal_error")
	}
}
