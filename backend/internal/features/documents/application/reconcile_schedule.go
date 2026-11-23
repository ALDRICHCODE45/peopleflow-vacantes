package documents

import (
	"context"
	"log/slog"
	"time"
)

// ReconcileInterval is how often the in-process ticker reconciles (Q8, accepted default).
const ReconcileInterval = 24 * time.Hour

// Reconciler is what the scheduler runs: the documents orphan sweep (documents/infrastructure/postgres.Reconciler).
type Reconciler interface {
	Reconcile(ctx context.Context) error
}

// Lock is the cross-instance single-runner guard (Q8): with several API tasks only the one that gets the lock sweeps.
type Lock interface {
	// TryRun calls fn while holding the lock and reports ran=true. When another holder has it, fn is not called and ran is
	// false with a nil error. The lock is released before TryRun returns, whatever fn did.
	TryRun(ctx context.Context, fn func(context.Context) error) (ran bool, err error)
}

// ReconcileScheduler runs Reconcile once when Run starts and then on every tick, each run under the Lock. Failures are
// logged without their cause (a filesystem error carries a file name) and never end the loop or the process.
type ReconcileScheduler struct {
	Reconciler Reconciler
	Lock       Lock
	// Interval is the period between runs; a value <= 0 means ReconcileInterval.
	Interval time.Duration
	// NewTicker is the injected clock: a channel that delivers once per period and the function that releases it.
	NewTicker func(period time.Duration) (<-chan time.Time, func())
	Logger    *slog.Logger
}

// NewReconcileScheduler builds the production scheduler: a daily time.Ticker and slog.Default() when logger is nil.
func NewReconcileScheduler(reconciler Reconciler, lock Lock, logger *slog.Logger) *ReconcileScheduler {
	if logger == nil {
		logger = slog.Default()
	}
	return &ReconcileScheduler{Reconciler: reconciler, Lock: lock, Interval: ReconcileInterval, NewTicker: realTicker, Logger: logger}
}

func realTicker(period time.Duration) (<-chan time.Time, func()) {
	t := time.NewTicker(period)
	return t.C, t.Stop
}

// Run blocks: one run right away (the grace window already protects an upload of the previous instance in flight), then one
// per tick until ctx is cancelled. The ticker starts after the first run, so a long run never queues a second one behind it.
func (s *ReconcileScheduler) Run(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	s.runOnce(ctx)
	if ctx.Err() != nil {
		return
	}
	interval := s.Interval
	if interval <= 0 {
		interval = ReconcileInterval
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

// runOnce is one guarded sweep. Nothing escapes it: not an error and not a panic.
func (s *ReconcileScheduler) runOnce(ctx context.Context) {
	logger := s.Logger
	if logger == nil {
		logger = slog.Default()
	}
	started := time.Now()
	defer func() {
		if recover() != nil {
			// The panic value is not logged: it may carry a path or a name.
			logger.Error("documents reconcile failed", "code_class", "internal_error", "cause", "panic")
		}
	}()
	ran, err := s.Lock.TryRun(ctx, s.Reconciler.Reconcile)
	switch {
	case err != nil:
		if ctx.Err() != nil {
			return // shutdown, not a failure
		}
		logger.Error("documents reconcile failed", "code_class", "internal_error")
	case !ran:
		logger.Info("documents reconcile skipped", "reason", "lock_held")
	default:
		logger.Info("documents reconcile finished", "duration_ms", time.Since(started).Milliseconds())
	}
}
