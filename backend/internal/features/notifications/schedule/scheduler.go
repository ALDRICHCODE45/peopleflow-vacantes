package schedule

import (
	"context"
	"log/slog"
	"time"
)

// Interval is the scheduler period (D20).
const Interval = 15 * time.Minute

// RunnerOnce is what each scheduled run executes (Runner in production).
type RunnerOnce interface {
	RunOnce(ctx context.Context) (Result, error)
}

// Lock is the cross-instance single-runner guard (AdvisoryLock in production).
type Lock interface {
	// TryRun calls fn while holding the lock and reports ran=true; when another
	// holder has it, fn is not called and ran is false with a nil error.
	TryRun(ctx context.Context, fn func(context.Context) error) (ran bool, err error)
}

// Scheduler runs once when Run starts and then on every tick, each run under
// the Lock. Failures are logged value-free and never end the loop.
type Scheduler struct {
	Runner   RunnerOnce
	Lock     Lock
	Interval time.Duration
	// NewTicker is the injected clock: a channel that delivers once per period and its release.
	NewTicker func(period time.Duration) (<-chan time.Time, func())
	Logger    *slog.Logger
}

// NewScheduler builds the production scheduler; a nil logger means slog.Default().
func NewScheduler(runner RunnerOnce, lock Lock, logger *slog.Logger) *Scheduler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Scheduler{Runner: runner, Lock: lock, Interval: Interval, NewTicker: realTicker, Logger: logger}
}

func realTicker(period time.Duration) (<-chan time.Time, func()) {
	t := time.NewTicker(period)
	return t.C, t.Stop
}

// Run blocks until ctx is cancelled. The ticker starts after the first run.
func (s *Scheduler) Run(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	s.runOnce(ctx)
	if ctx.Err() != nil {
		return
	}
	interval := s.Interval
	if interval <= 0 {
		interval = Interval
	}
	newTicker := s.NewTicker
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
			s.runOnce(ctx)
		}
	}
}

// runOnce is one guarded run; nothing escapes it, not an error and not a panic.
// Logs carry counts, step and SQLSTATE only.
func (s *Scheduler) runOnce(ctx context.Context) {
	logger := s.Logger
	if logger == nil {
		logger = slog.Default()
	}
	started := time.Now()
	defer func() {
		if recover() != nil {
			// The panic value is not logged: it may carry row data.
			logger.Error("notification schedule failed", "code_class", "internal_error", "cause", "panic")
		}
	}()
	var res Result
	ran, err := s.Lock.TryRun(ctx, func(ctx context.Context) error {
		r, err := s.Runner.RunOnce(ctx)
		res = r
		return err
	})
	switch {
	case err != nil:
		if ctx.Err() != nil {
			return // shutdown, not a failure
		}
		step, sqlstate := classify(err)
		logger.Error("notification schedule failed", "code_class", "internal_error", "step", step, "sqlstate", sqlstate)
	case !ran:
		logger.Info("notification schedule skipped", "reason", "lock_held")
	default:
		logger.Info("notification schedule finished", "delivery_created", res.DeliveryCreated, "assignment_created", res.AssignmentCreated,
			"resolved", res.Resolved, "duration_ms", time.Since(started).Milliseconds())
	}
}
