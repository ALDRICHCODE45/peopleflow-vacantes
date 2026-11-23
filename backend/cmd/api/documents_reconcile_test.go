package main

import (
	"context"
	"testing"
	"time"
)

type recordingRunner struct {
	started chan struct{}
	stopped chan struct{}
}

func (r *recordingRunner) Run(ctx context.Context) {
	close(r.started)
	<-ctx.Done()
	close(r.stopped)
}

// Q8: the sweep runs in a goroutine that shutdown stops and waits for (the pool is closed right after).
func TestStartDocumentReconcile_RunsInTheBackgroundAndStopWaitsForIt(t *testing.T) {
	runner := &recordingRunner{started: make(chan struct{}), stopped: make(chan struct{})}
	stop := startDocumentReconcile(context.Background(), runner)
	select {
	case <-runner.started:
	case <-time.After(5 * time.Second):
		t.Fatal("the scheduler never started")
	}
	select {
	case <-runner.stopped:
		t.Fatal("the scheduler stopped on its own")
	default:
	}
	stop()
	select {
	case <-runner.stopped:
	default:
		t.Fatal("stop returned before the scheduler did")
	}
	stop() // idempotent: a second call neither blocks nor panics
}

// The shutdown trigger of main (the signal context) also stops it.
func TestStartDocumentReconcile_StopsWhenTheRootContextIsCancelled(t *testing.T) {
	runner := &recordingRunner{started: make(chan struct{}), stopped: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	stop := startDocumentReconcile(ctx, runner)
	<-runner.started
	cancel()
	select {
	case <-runner.stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("cancelling the root context did not stop the scheduler")
	}
	stop()
}

// Documents storage not configured: nothing is started and nothing is touched.
func TestStartDocumentReconcile_DisabledWhenThereIsNoScheduler(t *testing.T) {
	stop := startDocumentReconcile(context.Background(), nil)
	stop()
	if scheduler := newDocumentReconcileScheduler(nil, nil); scheduler != nil {
		t.Fatalf("a scheduler was built without a storage: %v", scheduler)
	}
}
