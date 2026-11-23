package documents

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeClock is the injected ticker: the test decides when a «day» passes.
type fakeClock struct {
	mu       sync.Mutex
	ticks    chan time.Time
	interval time.Duration
	created  int
	stopped  int
}

func newFakeClock() *fakeClock { return &fakeClock{ticks: make(chan time.Time, 8)} }

func (c *fakeClock) newTicker(d time.Duration) (<-chan time.Time, func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.interval = d
	c.created++
	return c.ticks, func() {
		c.mu.Lock()
		c.stopped++
		c.mu.Unlock()
	}
}

func (c *fakeClock) tick() { c.ticks <- time.Now() }

func (c *fakeClock) state() (interval time.Duration, created, stopped int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.interval, c.created, c.stopped
}

// fakeReconciler records every run and reports it on ran so a test can wait for exactly n runs.
type fakeReconciler struct {
	mu        sync.Mutex
	runs      int
	err       error
	panicWith any
	block     chan struct{} // when set, Reconcile waits for it or for ctx
	ran       chan struct{}
	lock      *fakeLock
	sawLock   []bool
	ctxErrs   []error
}

func newFakeReconciler() *fakeReconciler { return &fakeReconciler{ran: make(chan struct{}, 32)} }

func (r *fakeReconciler) Reconcile(ctx context.Context) error {
	r.mu.Lock()
	r.runs++
	err, boom, block := r.err, r.panicWith, r.block
	if r.lock != nil {
		r.sawLock = append(r.sawLock, r.lock.isHeld())
	}
	r.mu.Unlock()
	r.ran <- struct{}{}
	if boom != nil {
		panic(boom)
	}
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			r.mu.Lock()
			r.ctxErrs = append(r.ctxErrs, ctx.Err())
			r.mu.Unlock()
			return ctx.Err()
		}
	}
	return err
}

func (r *fakeReconciler) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.runs
}

// fakeLock grants the lock unless held elsewhere is set, and reports every attempt.
type fakeLock struct {
	mu       sync.Mutex
	heldBy   bool // another instance holds it
	err      error
	attempts int
	held     bool
}

func (l *fakeLock) TryRun(ctx context.Context, fn func(context.Context) error) (bool, error) {
	l.mu.Lock()
	l.attempts++
	if l.err != nil {
		err := l.err
		l.mu.Unlock()
		return false, err
	}
	if l.heldBy {
		l.mu.Unlock()
		return false, nil
	}
	l.held = true
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		l.held = false
		l.mu.Unlock()
	}()
	return true, fn(ctx)
}

func (l *fakeLock) isHeld() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.held
}

func (l *fakeLock) set(heldBy bool) {
	l.mu.Lock()
	l.heldBy = heldBy
	l.mu.Unlock()
}

func (l *fakeLock) tries() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.attempts
}

type scheduleHarness struct {
	clock *fakeClock
	rec   *fakeReconciler
	lock  *fakeLock
	logs  *syncBuffer
	sched *ReconcileScheduler
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func newScheduleHarness() *scheduleHarness {
	h := &scheduleHarness{clock: newFakeClock(), rec: newFakeReconciler(), lock: &fakeLock{}, logs: &syncBuffer{}}
	h.rec.lock = h.lock
	h.sched = NewReconcileScheduler(h.rec, h.lock, slog.New(slog.NewJSONHandler(h.logs, nil)))
	h.sched.NewTicker = h.clock.newTicker
	return h
}

// start runs the scheduler and returns a stop that cancels it and waits for Run to return.
func (h *scheduleHarness) start(t *testing.T) (cancel func()) {
	t.Helper()
	ctx, stop := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.sched.Run(ctx)
	}()
	var once sync.Once
	cancel = func() {
		once.Do(func() {
			stop()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("Run did not return after cancel")
			}
		})
	}
	t.Cleanup(cancel)
	return cancel
}

func (h *scheduleHarness) waitRun(t *testing.T) {
	t.Helper()
	select {
	case <-h.rec.ran:
	case <-time.After(5 * time.Second):
		t.Fatalf("no reconcile run (runs=%d, logs=%s)", h.rec.count(), h.logs.String())
	}
}

// settle waits until the scheduler is idle again: it has asked for the next tick (a fresh ticker read) by way of a sentinel run
// on a lock attempt count, which is enough because every cycle takes the lock exactly once.
func (h *scheduleHarness) waitAttempts(t *testing.T, n int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for h.lock.tries() < n {
		if time.Now().After(deadline) {
			t.Fatalf("lock attempts %d, want %d", h.lock.tries(), n)
		}
		time.Sleep(time.Millisecond)
	}
}

func (h *scheduleHarness) waitTicker(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, created, _ := h.clock.state(); created > 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the scheduler never asked for a ticker")
		}
		time.Sleep(time.Millisecond)
	}
}

func (h *scheduleHarness) noRunWithin(t *testing.T, d time.Duration) {
	t.Helper()
	select {
	case <-h.rec.ran:
		t.Fatalf("unexpected reconcile run (runs=%d)", h.rec.count())
	case <-time.After(d):
	}
}

func TestReconcileScheduler_RunsOnceAtStartWithoutWaitingForATick(t *testing.T) {
	h := newScheduleHarness()
	h.start(t)
	h.waitRun(t)
	if h.rec.count() != 1 {
		t.Fatalf("runs = %d, want 1", h.rec.count())
	}
	h.noRunWithin(t, 30*time.Millisecond)
}

func TestReconcileScheduler_RepeatsOnEveryTick(t *testing.T) {
	h := newScheduleHarness()
	h.start(t)
	h.waitRun(t)
	for i := 2; i <= 4; i++ {
		h.clock.tick()
		h.waitRun(t)
		if h.rec.count() != i {
			t.Fatalf("after tick %d: runs = %d", i-1, h.rec.count())
		}
	}
	if interval, created, _ := h.clock.state(); interval != 24*time.Hour || created != 1 {
		t.Fatalf("ticker: interval %v created %d, want 24h once", interval, created)
	}
}

func TestReconcileScheduler_IntervalIsInjectable(t *testing.T) {
	h := newScheduleHarness()
	h.sched.Interval = 90 * time.Minute
	h.start(t)
	h.waitRun(t)
	h.clock.tick()
	h.waitRun(t)
	if interval, _, _ := h.clock.state(); interval != 90*time.Minute {
		t.Fatalf("interval = %v", interval)
	}
}

func TestReconcileScheduler_NonPositiveIntervalFallsBackToADay(t *testing.T) {
	for _, d := range []time.Duration{0, -time.Second} {
		h := newScheduleHarness()
		h.sched.Interval = d
		h.start(t)
		h.waitRun(t)
		h.clock.tick()
		h.waitRun(t)
		if interval, _, _ := h.clock.state(); interval != ReconcileInterval || ReconcileInterval != 24*time.Hour {
			t.Fatalf("interval %v for %v", interval, d)
		}
	}
}

func TestReconcileScheduler_EveryRunHoldsTheLock(t *testing.T) {
	h := newScheduleHarness()
	h.start(t)
	h.waitRun(t)
	h.clock.tick()
	h.waitRun(t)
	h.rec.mu.Lock()
	saw := append([]bool(nil), h.rec.sawLock...)
	h.rec.mu.Unlock()
	if len(saw) != 2 || !saw[0] || !saw[1] {
		t.Fatalf("Reconcile ran outside the lock: %v", saw)
	}
	if h.lock.isHeld() {
		// Give the scheduler a moment to release: held must be false once the run returned.
		time.Sleep(20 * time.Millisecond)
		if h.lock.isHeld() {
			t.Fatal("the lock was not released after the run")
		}
	}
}

func TestReconcileScheduler_SkipsWhileAnotherInstanceHoldsTheLock(t *testing.T) {
	h := newScheduleHarness()
	h.lock.set(true)
	h.start(t)
	h.waitAttempts(t, 1)
	h.noRunWithin(t, 30*time.Millisecond)
	h.clock.tick()
	h.waitAttempts(t, 2)
	h.noRunWithin(t, 30*time.Millisecond)
	if h.rec.count() != 0 {
		t.Fatalf("reconciled without the lock: %d", h.rec.count())
	}
	if !strings.Contains(h.logs.String(), "lock_held") {
		t.Fatalf("a skipped run must say why: %s", h.logs.String())
	}
	// The other instance finishes: the next day's run goes ahead.
	h.lock.set(false)
	h.clock.tick()
	h.waitRun(t)
	if h.rec.count() != 1 {
		t.Fatalf("runs = %d, want 1", h.rec.count())
	}
}

func TestReconcileScheduler_StopsOnCancel(t *testing.T) {
	h := newScheduleHarness()
	cancel := h.start(t)
	h.waitRun(t)
	h.waitTicker(t) // the ticker exists once the first run is over
	cancel()        // returns only after Run did
	if _, created, stopped := h.clock.state(); created != 1 || stopped != 1 {
		t.Fatalf("ticker created %d stopped %d: it must be released on cancel", created, stopped)
	}
	h.clock.tick() // a tick after the stop must not start a run
	h.noRunWithin(t, 30*time.Millisecond)
	if h.rec.count() != 1 {
		t.Fatalf("runs = %d after cancel", h.rec.count())
	}
}

func TestReconcileScheduler_CancelStopsARunInFlight(t *testing.T) {
	h := newScheduleHarness()
	h.rec.block = make(chan struct{}) // never released: only the context can end it
	cancel := h.start(t)
	h.waitRun(t)
	cancel()
	h.rec.mu.Lock()
	errs := append([]error(nil), h.rec.ctxErrs...)
	h.rec.mu.Unlock()
	if len(errs) != 1 || !errors.Is(errs[0], context.Canceled) {
		t.Fatalf("the run did not see the cancellation: %v", errs)
	}
	// A shutdown is not a failure.
	if strings.Contains(h.logs.String(), "failed") {
		t.Fatalf("shutdown logged as a failure: %s", h.logs.String())
	}
}

func TestReconcileScheduler_CancelledBeforeStartRunsNothing(t *testing.T) {
	h := newScheduleHarness()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() { h.sched.Run(ctx); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return")
	}
	if h.rec.count() != 0 {
		t.Fatalf("runs = %d", h.rec.count())
	}
}

// A failure is logged without the error text (a filesystem error carries the file name) and never ends the loop.
func TestReconcileScheduler_FailureIsLoggedWithoutDetailAndTheLoopContinues(t *testing.T) {
	h := newScheduleHarness()
	h.rec.err = errors.New(`open /srv/documents/ab12cd34-contrato-confidencial.pdf: permission denied`)
	h.start(t)
	h.waitRun(t)
	h.clock.tick()
	h.waitRun(t)
	logs := h.logs.String()
	for _, leaked := range []string{"/srv", "contrato", "confidencial", ".pdf", "permission"} {
		if strings.Contains(logs, leaked) {
			t.Fatalf("log leaked %q: %s", leaked, logs)
		}
	}
	if !strings.Contains(logs, `"level":"ERROR"`) || !strings.Contains(logs, "code_class") || !strings.Contains(logs, "documents reconcile failed") {
		t.Fatalf("failure not logged as an error: %s", logs)
	}
	// It recovers: the next run succeeds and is reported.
	h.rec.mu.Lock()
	h.rec.err = nil
	h.rec.mu.Unlock()
	h.clock.tick()
	h.waitRun(t)
	h.waitAttempts(t, 3)
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(h.logs.String(), "documents reconcile finished") {
		if time.Now().After(deadline) {
			t.Fatalf("no success log: %s", h.logs.String())
		}
		time.Sleep(time.Millisecond)
	}
}

func TestReconcileScheduler_LockErrorIsLoggedWithoutDetailAndSkipsTheRun(t *testing.T) {
	h := newScheduleHarness()
	h.lock.err = errors.New(`dial tcp 10.0.3.7:5432: connect: connection refused (user app_rw)`)
	h.start(t)
	h.waitAttempts(t, 1)
	h.clock.tick()
	h.waitAttempts(t, 2)
	if h.rec.count() != 0 {
		t.Fatalf("reconciled without the lock: %d", h.rec.count())
	}
	logs := h.logs.String()
	for _, leaked := range []string{"10.0.3.7", "app_rw", "refused"} {
		if strings.Contains(logs, leaked) {
			t.Fatalf("log leaked %q: %s", leaked, logs)
		}
	}
	if !strings.Contains(logs, "documents reconcile failed") {
		t.Fatalf("lock failure not logged: %s", logs)
	}
}

// «Never crash»: a panic in the reconciler is recovered, logged without its value and the next tick still runs.
func TestReconcileScheduler_PanicDoesNotCrashAndTheLoopContinues(t *testing.T) {
	h := newScheduleHarness()
	h.rec.panicWith = "boom: /srv/documents/secret-name.pdf"
	h.start(t)
	h.waitRun(t)
	h.clock.tick()
	h.waitRun(t)
	if h.rec.count() != 2 {
		t.Fatalf("runs = %d", h.rec.count())
	}
	logs := h.logs.String()
	if strings.Contains(logs, "secret-name") || strings.Contains(logs, "/srv") {
		t.Fatalf("panic value leaked: %s", logs)
	}
	if !strings.Contains(logs, "documents reconcile failed") {
		t.Fatalf("panic not logged: %s", logs)
	}
	if h.lock.isHeld() {
		time.Sleep(20 * time.Millisecond)
		if h.lock.isHeld() {
			t.Fatal("the lock was kept after a panic")
		}
	}
}

func TestNewReconcileScheduler_DefaultsAreProduction(t *testing.T) {
	s := NewReconcileScheduler(newFakeReconciler(), &fakeLock{}, nil)
	if s.Interval != ReconcileInterval || s.NewTicker == nil || s.Logger == nil {
		t.Fatalf("defaults: %+v", s)
	}
	// The default ticker is a real, stoppable one.
	ticks, stop := s.NewTicker(time.Hour)
	if ticks == nil {
		t.Fatal("no channel")
	}
	stop()
}
