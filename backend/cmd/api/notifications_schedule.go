package main

import (
	"context"
	"log/slog"
	"sync"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/schedule"
	"github.com/jackc/pgx/v5/pgxpool"
)

// scheduleRunner is the notifications scheduler: Run blocks until ctx is cancelled.
type scheduleRunner interface {
	Run(ctx context.Context)
}

// newNotificationScheduler composes the deadline scheduler (D20): once at
// start and every 15 min, one instance at a time (advisory lock notif_sc).
func newNotificationScheduler(pool *pgxpool.Pool) scheduleRunner {
	return schedule.NewScheduler(schedule.NewRunner(pool, nil), schedule.NewAdvisoryLock(pool), slog.Default())
}

// startNotificationSchedule runs the scheduler in a goroutine that ends with
// ctx (the signal context of main) or when stop is called; stop waits for the
// goroutine, so it must run before the pool is closed.
func startNotificationSchedule(ctx context.Context, runner scheduleRunner) (stop func()) {
	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runner.Run(runCtx)
	}()
	var once sync.Once
	return func() {
		once.Do(cancel)
		<-done
	}
}
