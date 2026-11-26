package main

import (
	"context"
	"log/slog"
	"sync"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/fanout"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// candidateVisibleStatus is the fan-out's VisibleStatus (notifications-v1 D7):
// the candidate-visible status of the applications read model with the
// process's initial stage, composed here so notifications import no sibling
// feature.
type candidateVisibleStatus struct{}

func (candidateVisibleStatus) Status(job, stage uuid.UUID, discarded bool) string {
	return app.CandidateStatus(stage, participationRules{}.InitialStage(job), discarded)
}

// fanOutRunner is the notifications fan-out loop: Run blocks until ctx is cancelled.
type fanOutRunner interface {
	Run(ctx context.Context)
}

// newNotificationFanOut composes the fan-out (D4): every instance claims
// pending notification_events every 2 s (SKIP LOCKED, no advisory lock).
func newNotificationFanOut(pool *pgxpool.Pool) fanOutRunner {
	planner := fanout.NewPlanner(candidateVisibleStatus{})
	return fanout.NewLoop(fanout.NewProcessor(pool, planner, slog.Default()), slog.Default())
}

// startNotificationFanOut runs the loop in a goroutine that ends with ctx (the
// signal context of main) or when stop is called; stop waits for the
// goroutine, so it must run before the pool is closed.
func startNotificationFanOut(ctx context.Context, runner fanOutRunner) (stop func()) {
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
