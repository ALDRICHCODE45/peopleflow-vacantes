package metrics_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	rtmetrics "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics"
)

// Compile-time proof that the no-op default satisfies all three narrow
// observability ports without any exporter dependency or wiring.
var (
	_ rtmetrics.HTTPMetrics      = rtmetrics.Noop{}
	_ rtmetrics.DBMetrics        = rtmetrics.Noop{}
	_ rtmetrics.ReadinessMetrics = rtmetrics.Noop{}
)

// TestNoopDefaultIsSilent exercises every port method on the shared no-op
// value: it must run without panic, allocation-time side effects, exporter
// wiring, or observable state. This test PASSES on the scaffold and
// independently proves compile safety of the metrics ports.
func TestNoopDefaultIsSilent(t *testing.T) {
	t.Parallel()

	rtmetrics.Default.ObserveRequest(http.MethodGet, "/companies/{id}", http.StatusOK, time.Millisecond)
	rtmetrics.Default.ObservePool(4, 6, 10)
	rtmetrics.Default.SetReady(true)
	rtmetrics.Default.SetReady(false)
}

// pingSpy records the underlying pinger's call count and returns a fixed err.
type pingSpy struct {
	calls int
	err   error
}

func (s *pingSpy) Ping(context.Context) error { s.calls++; return s.err }

// dbSpy records every DBMetrics.ObservePool observation in order.
type dbSpy struct {
	observed [][3]int32
}

func (s *dbSpy) ObservePool(acquired, idle, max int32) {
	s.observed = append(s.observed, [3]int32{acquired, idle, max})
}

// poolSnapshot is a mutable stand-in for pgxpool.Stat() counts.
type poolSnapshot struct {
	acquired, idle, max int32
}

func (s *poolSnapshot) sample() (int32, int32, int32) {
	return s.acquired, s.idle, s.max
}

// TestDBObservedPinger_ObservesCurrentPoolAfterEveryPing pins the ws6c-5a
// readiness pool-sampling slice (Task 6.3, design §8.3): EVERY ping —
// successful or failed — samples the CURRENT acquired/idle/max pool values
// exactly once and forwards them to DBMetrics.ObservePool, while the
// underlying ping result and error identity are preserved and the decorated
// pinger is invoked exactly once per Ping.
func TestDBObservedPinger_ObservesCurrentPoolAfterEveryPing(t *testing.T) {
	t.Parallel()

	t.Run("successful ping observes the current pool exactly once", func(t *testing.T) {
		t.Parallel()

		ping := &pingSpy{}
		snap := &poolSnapshot{acquired: 3, idle: 7, max: 10}
		db := &dbSpy{}
		p := rtmetrics.NewDBObservedPinger(ping, snap.sample, db)

		if err := p.Ping(t.Context()); err != nil {
			t.Fatalf("Ping() error = %v, want nil on success", err)
		}
		if ping.calls != 1 {
			t.Fatalf("underlying pinger calls = %d, want exactly 1", ping.calls)
		}
		if len(db.observed) != 1 {
			t.Fatalf("pool observations = %d, want exactly 1", len(db.observed))
		}
		if got := db.observed[0]; got != [3]int32{3, 7, 10} {
			t.Fatalf("observed pool = %v, want current snapshot [3 7 10]", got)
		}
	})

	t.Run("failed ping observes and preserves error identity", func(t *testing.T) {
		t.Parallel()

		sentinel := errors.New("db: connection refused")
		ping := &pingSpy{err: sentinel}
		snap := &poolSnapshot{acquired: 1, idle: 0, max: 10}
		db := &dbSpy{}
		p := rtmetrics.NewDBObservedPinger(ping, snap.sample, db)

		err := p.Ping(t.Context())
		if !errors.Is(err, sentinel) {
			t.Fatalf("Ping() error = %v, want the underlying error preserved (errors.Is)", err)
		}
		if ping.calls != 1 {
			t.Fatalf("underlying pinger calls = %d, want exactly 1", ping.calls)
		}
		if len(db.observed) != 1 {
			t.Fatalf("pool observations = %d, want exactly 1 (failed pings observe too)", len(db.observed))
		}
		if got := db.observed[0]; got != [3]int32{1, 0, 10} {
			t.Fatalf("observed pool = %v, want current snapshot [1 0 10]", got)
		}
	})

	t.Run("changing snapshots observe the current values each ping", func(t *testing.T) {
		t.Parallel()

		ping := &pingSpy{}
		snap := &poolSnapshot{acquired: 2, idle: 8, max: 10}
		db := &dbSpy{}
		p := rtmetrics.NewDBObservedPinger(ping, snap.sample, db)

		if err := p.Ping(t.Context()); err != nil {
			t.Fatalf("Ping() error = %v, want nil on success", err)
		}
		snap.acquired, snap.idle, snap.max = 5, 4, 12
		if err := p.Ping(t.Context()); err != nil {
			t.Fatalf("Ping() error = %v, want nil on success", err)
		}

		if ping.calls != 2 {
			t.Fatalf("underlying pinger calls = %d, want exactly 2", ping.calls)
		}
		if len(db.observed) != 2 {
			t.Fatalf("pool observations = %d, want exactly one per ping", len(db.observed))
		}
		want := [][3]int32{{2, 8, 10}, {5, 4, 12}}
		for i, w := range want {
			if got := db.observed[i]; got != w {
				t.Fatalf("observation %d = %v, want current snapshot %v", i, got, w)
			}
		}
	})
}
