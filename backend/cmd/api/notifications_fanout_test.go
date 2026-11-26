package main

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// D7: the fan-out's visible status is CandidateStatus with the process's
// initial stage (the canonical built-in first stage of the vacancy).
func TestCandidateVisibleStatus_UsesTheInitialStageOfTheVacancy(t *testing.T) {
	job := uuid.New()
	initial := participationRules{}.InitialStage(job)
	status := candidateVisibleStatus{}
	if got := status.Status(job, initial, false); got != "submitted" {
		t.Fatalf("initial stage: %s", got)
	}
	if got := status.Status(job, uuid.New(), false); got != "in_process" {
		t.Fatalf("later stage: %s", got)
	}
	if got := status.Status(job, initial, true); got != "closed" {
		t.Fatalf("discarded: %s", got)
	}
}

// D4: the fan-out loop runs in the background with the API process; shutdown
// (stop or the root context) stops it and stop waits for it, before the pool closes.
func TestStartNotificationFanOut_RunsInTheBackgroundAndStopWaitsForIt(t *testing.T) {
	runner := &recordingRunner{started: make(chan struct{}), stopped: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	stop := startNotificationFanOut(ctx, runner)
	select {
	case <-runner.started:
	case <-time.After(5 * time.Second):
		t.Fatal("the fan-out never started")
	}
	cancel()
	stop()
	select {
	case <-runner.stopped:
	default:
		t.Fatal("stop returned before the fan-out did")
	}
	stop()
}
