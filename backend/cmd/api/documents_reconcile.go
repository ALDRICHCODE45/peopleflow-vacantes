package main

import (
	"context"
	"sync"

	documentsapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	documentspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

// documentReconcileRunner is the background sweep: Run blocks until its context is cancelled.
type documentReconcileRunner interface {
	Run(ctx context.Context)
}

// newDocumentReconcileScheduler composes the orphan sweep of the documents storage (Q8, D25): Reconcile over the pool and the
// storage, each run under the cross-instance advisory lock so one Fargate task sweeps at a time. It returns nil while the
// documents storage is not configured: there is nothing to sweep and the rest of the API is unaffected.
func newDocumentReconcileScheduler(pool *pgxpool.Pool, storage documentsapp.Storage) documentReconcileRunner {
	if storage == nil {
		return nil
	}
	return documentsapp.NewReconcileScheduler(documentspostgres.NewReconciler(pool, storage), documentspostgres.NewAdvisoryLock(pool), nil)
}

// startDocumentReconcile runs the scheduler in a goroutine that ends with ctx (the signal context of main) or when the returned
// stop is called; stop waits for the goroutine, so it must run before the pool is closed. A nil runner starts nothing.
func startDocumentReconcile(ctx context.Context, runner documentReconcileRunner) (stop func()) {
	if runner == nil {
		return func() {}
	}
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
