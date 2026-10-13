package main

import (
	"context"
	"io"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	localbootstrap "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/localbootstrap"
)

// independentTerminal is the independent verifier's fake terminal. It records
// the lifecycle so the test can assert that Run closes it exactly once and that
// no reader goroutine survives cancellation.
type independentTerminal struct {
	read    chan struct{}
	closed  atomic.Int32
	prompts atomic.Int32
	reads   atomic.Int32
}

func (t *independentTerminal) IsInteractive() bool     { return true }
func (t *independentTerminal) ShowPrompt(string) error { t.prompts.Add(1); return nil }
func (t *independentTerminal) Close() error            { t.closed.Add(1); return nil }

func (t *independentTerminal) ReadLine() (string, error) {
	if t.reads.Add(1) == 1 {
		close(t.read)
		return "reject", nil
	}
	return "", io.EOF
}

// TestIndependentRunCancelJoinsTerminalReader is the independent verifier's
// public regression for blocker B2: Run cancellation must deterministically
// join the owned terminal reader, close the terminal exactly once, and leave no
// goroutine blocked on the reader channel send.
func TestIndependentRunCancelJoinsTerminalReader(t *testing.T) {
	s := newSpy(t)
	term := &independentTerminal{read: make(chan struct{})}
	rt := s.runtime(testEnv(nil))
	rt.NewTerminal = func() (localbootstrap.Terminal, error) {
		s.newTerminalCalls.Add(1)
		return term, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, rt) }()

	addr := waitForAddr(t, s.listenCh)
	select {
	case <-term.read:
	case <-time.After(time.Second):
		t.Fatal("terminal reader never started")
	}

	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Errorf("cancel returned nonnil error")
		}
	case <-time.After(time.Second):
		t.Fatal("Run cancellation did not finish")
	}

	want := "localidentitybootstrap: listening on " + addr + " (scope: users-only, user_type: recruiter)\n"
	if s.stdout.String() != want {
		t.Errorf("unexpected public terminal output")
	}
	if term.prompts.Load() != 0 || term.closed.Load() != 1 || s.creatorCallCount() != 0 ||
		s.userInfoCalls.Load() != 1 || s.verifierCalls.Load() != 1 || s.openPoolCalls.Load() != 1 ||
		s.listenCalls.Load() != 1 || s.newTerminalCalls.Load() != 1 || s.creatorCalls.Load() != 1 ||
		atomic.LoadInt32(&s.pool.closeCalls) != 1 || atomic.LoadInt32(&s.pool.pingCalls) != 1 {
		t.Error("cancel altered dependency counts, private prompt, or pool cleanup")
	}

	runtime.Gosched()
	buf := make([]byte, 1<<20)
	n := runtime.Stack(buf, true)
	for _, stack := range strings.Split(string(buf[:n]), "\n\n") {
		if strings.Contains(stack, "awaitOperator.func1") {
			t.Errorf("terminal reader survived Run cancellation and terminal Close: %s", stack)
		}
	}
}
