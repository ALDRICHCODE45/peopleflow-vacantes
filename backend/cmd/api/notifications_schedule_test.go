package main

import (
	"context"
	"testing"
	"time"
)

// D20: the scheduler runs in the background with the API process; shutdown
// (stop or the root context) stops it and stop waits for it, before the pool closes.
func TestStartNotificationSchedule_RunsInTheBackgroundAndStopWaitsForIt(t *testing.T) {
	runner := &recordingRunner{started: make(chan struct{}), stopped: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	stop := startNotificationSchedule(ctx, runner)
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
	cancel()
	stop()
	select {
	case <-runner.stopped:
	default:
		t.Fatal("stop returned before the scheduler did")
	}
	stop() // idempotent
}

// The composition builds a runnable scheduler without touching the database
// (the pool is only used when a run starts).
func TestNewNotificationScheduler_Composes(t *testing.T) {
	for _, email := range []bool{false, true} {
		if newNotificationScheduler(nil, email) == nil {
			t.Fatalf("nil scheduler (email=%v)", email)
		}
	}
}
