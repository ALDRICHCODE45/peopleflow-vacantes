// Lifecycle regressions for the bootstrap command: outcome reporting when the
// apply completes alongside terminal closure, and bounded server shutdown.
// Every dependency is a fake or a loopback test server.
package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	localbootstrap "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/localbootstrap"
)

// An apply that completed must be reported as success even when the private
// terminal closes at the same moment; the account was already created.
func TestAwaitOperator_CompletedApplyWinsOverConcurrentTerminalClosure(t *testing.T) {
	const code = "ABCDEFGHIJKLMNOPQRSTUVWXYA"
	for i := range 200 {
		coordinator := localbootstrap.NewCoordinator(nil)
		if err := coordinator.Stage(localbootstrap.Candidate{
			Subject:       "fixture-subject",
			Email:         "fixture@example.invalid",
			FullName:      "Fixture Operator",
			OperationCode: code,
			ExpiresAt:     time.Now().Add(time.Minute),
		}); err != nil {
			t.Fatalf("stage: %v", err)
		}
		term := newFakeTerminal()
		term.lines <- "approve " + code
		applied := make(chan struct{})
		// Once the grant is armed, the apply completes and the terminal then
		// reaches EOF while the operator loop is still waiting.
		go func() {
			for coordinator.CheckApproval(code) != nil {
				time.Sleep(time.Millisecond)
			}
			close(applied)
			_ = term.Close()
		}()

		err := awaitOperator(t.Context(), term, func() {}, true, coordinator, localbootstrap.Config{}, applied)
		if err != nil {
			t.Fatalf("iteration %d: awaitOperator error = %v, want nil after a completed apply", i, err)
		}
	}
}

// A connection that outlives the graceful window is closed instead of being
// left open while the process exits.
func TestShutdownServer_ForceClosesConnectionsAfterTimeout(t *testing.T) {
	entered := make(chan struct{})
	released := make(chan struct{})
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(released)
	}))
	server.Start()
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		if resp, err := server.Client().Do(req); err == nil {
			_ = resp.Body.Close()
		}
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("handler not reached")
	}

	shutdownServer(server.Config, 50*time.Millisecond)

	select {
	case <-released:
	case <-time.After(time.Second):
		t.Fatal("in-flight connection still open after the shutdown window")
	}
}
