package application

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

// fakeClock is a settable clock for TTL tests.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *fakeClock) Add(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

// countingLoad counts loads per key and returns a fresh dataset each time.
type countingLoad struct {
	mu    sync.Mutex
	loads map[snapshotKey]int
	total atomic.Int32
}

func (l *countingLoad) load(_ context.Context, company uuid.UUID, p Period) (*Dataset, error) {
	l.mu.Lock()
	if l.loads == nil {
		l.loads = map[snapshotKey]int{}
	}
	l.loads[snapshotKey{company, p.From, p.To}]++
	l.mu.Unlock()
	l.total.Add(1)
	return &Dataset{Vacancies: []*Vacancy{{ID: company}}, People: map[uuid.UUID]Person{}}, nil
}

func mustPeriod(t *testing.T, from, to string) Period {
	t.Helper()
	p, err := NewPeriod(from, to)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSnapshots_HitWithinTTLAndReloadAfter(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 11, 8, 19, 0, 0, 0, time.UTC)}
	loader := &countingLoad{}
	c := newSnapshots(loader.load, clock.Now, time.Minute, 128, 10*time.Second)
	company, p := uuid.New(), mustPeriod(t, "2026-01-01", "2026-01-31")

	first, err := c.get(context.Background(), company, p)
	if err != nil {
		t.Fatal(err)
	}
	if !first.AsOf.Equal(clock.Now()) {
		t.Fatalf("as_of %v, want the load instant %v", first.AsOf, clock.Now())
	}
	clock.Add(59 * time.Second)
	second, _ := c.get(context.Background(), company, p)
	if second != first || loader.total.Load() != 1 {
		t.Fatalf("within the TTL: loads %d, same snapshot %v", loader.total.Load(), second == first)
	}
	clock.Add(time.Second) // 60 s after the load: expired
	third, _ := c.get(context.Background(), company, p)
	if third == first || loader.total.Load() != 2 {
		t.Fatalf("after the TTL: loads %d", loader.total.Load())
	}
	if !third.AsOf.Equal(clock.Now()) {
		t.Fatalf("reloaded as_of %v", third.AsOf)
	}
}

func TestSnapshots_SingleflightCollapsesConcurrentMisses(t *testing.T) {
	clock := &fakeClock{now: time.Now()}
	release := make(chan struct{})
	var loads atomic.Int32
	c := newSnapshots(func(ctx context.Context, company uuid.UUID, p Period) (*Dataset, error) {
		loads.Add(1)
		<-release
		return &Dataset{People: map[uuid.UUID]Person{}}, nil
	}, clock.Now, time.Minute, 128, 10*time.Second)
	company, p := uuid.New(), mustPeriod(t, "2026-01-01", "2026-01-31")
	const n = 20
	var wg sync.WaitGroup
	got := make([]*Snapshot, n)
	errs := make([]error, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got[i], errs[i] = c.get(context.Background(), company, p)
		}()
	}
	waitFor(t, func() bool { return c.waiters(snapshotKey{company, p.From, p.To}) == n })
	close(release)
	wg.Wait()
	if loads.Load() != 1 {
		t.Fatalf("%d concurrent misses ran %d loads, want 1", n, loads.Load())
	}
	for i := range n {
		if errs[i] != nil || got[i] != got[0] {
			t.Fatalf("caller %d: %v, shared %v", i, errs[i], got[i] == got[0])
		}
	}
}

func TestSnapshots_CancelledCallerDoesNotFailTheSharedLoad(t *testing.T) {
	clock := &fakeClock{now: time.Now()}
	release := make(chan struct{})
	var loadErr error
	var deadline bool
	c := newSnapshots(func(ctx context.Context, company uuid.UUID, p Period) (*Dataset, error) {
		<-release
		_, deadline = ctx.Deadline()
		loadErr = ctx.Err()
		return &Dataset{People: map[uuid.UUID]Person{}}, ctx.Err()
	}, clock.Now, time.Minute, 128, 10*time.Second)
	company, p := uuid.New(), mustPeriod(t, "2026-01-01", "2026-01-31")
	key := snapshotKey{company, p.From, p.To}

	first, cancel := context.WithCancel(context.Background())
	firstErr := make(chan error, 1)
	go func() { _, err := c.get(first, company, p); firstErr <- err }()
	waitFor(t, func() bool { return c.waiters(key) == 1 })
	second := make(chan error, 1)
	go func() { _, err := c.get(context.Background(), company, p); second <- err }()
	waitFor(t, func() bool { return c.waiters(key) == 2 })

	cancel()
	if err := <-firstErr; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled caller: %v", err)
	}
	close(release)
	if err := <-second; err != nil {
		t.Fatalf("the other caller failed with the cancelled one: %v", err)
	}
	if loadErr != nil || !deadline {
		t.Fatalf("shared load ctx: err %v, own deadline %v", loadErr, deadline)
	}
	// The completed load is cached for the next caller.
	if _, err := c.get(context.Background(), company, p); err != nil || c.waiters(key) != 0 {
		t.Fatalf("cached read: %v", err)
	}
}

func TestSnapshots_ErrorsAreNotCached(t *testing.T) {
	clock := &fakeClock{now: time.Now()}
	var calls atomic.Int32
	boom := errors.New("boom")
	c := newSnapshots(func(context.Context, uuid.UUID, Period) (*Dataset, error) {
		if calls.Add(1) == 1 {
			return nil, boom
		}
		return &Dataset{People: map[uuid.UUID]Person{}}, nil
	}, clock.Now, time.Minute, 128, 10*time.Second)
	company, p := uuid.New(), mustPeriod(t, "2026-01-01", "2026-01-31")
	if _, err := c.get(context.Background(), company, p); !errors.Is(err, boom) {
		t.Fatalf("first: %v", err)
	}
	if _, err := c.get(context.Background(), company, p); err != nil || calls.Load() != 2 {
		t.Fatalf("second: %v after %d loads", err, calls.Load())
	}
}

func TestSnapshots_LRUBound(t *testing.T) {
	clock := &fakeClock{now: time.Now()}
	loader := &countingLoad{}
	c := newSnapshots(loader.load, clock.Now, time.Minute, 2, 10*time.Second)
	company := uuid.New()
	jan, feb, mar := mustPeriod(t, "2026-01-01", "2026-01-31"), mustPeriod(t, "2026-02-01", "2026-02-28"), mustPeriod(t, "2026-03-01", "2026-03-31")
	ctx := context.Background()
	c.get(ctx, company, jan)
	c.get(ctx, company, feb)
	c.get(ctx, company, jan) // jan is now the most recently used
	c.get(ctx, company, mar) // evicts feb
	if c.len() != 2 {
		t.Fatalf("entries %d, want the bound 2", c.len())
	}
	c.get(ctx, company, jan)
	if loader.loads[snapshotKey{company, jan.From, jan.To}] != 1 {
		t.Fatal("the recently used entry was evicted")
	}
	c.get(ctx, company, feb)
	if loader.loads[snapshotKey{company, feb.From, feb.To}] != 2 {
		t.Fatal("the least recently used entry was not evicted")
	}
}

func TestSnapshots_CompanyIsolation(t *testing.T) {
	clock := &fakeClock{now: time.Now()}
	loader := &countingLoad{}
	c := newSnapshots(loader.load, clock.Now, time.Minute, 128, 10*time.Second)
	a, b, p := uuid.New(), uuid.New(), mustPeriod(t, "2026-01-01", "2026-01-31")
	sa, _ := c.get(context.Background(), a, p)
	sb, _ := c.get(context.Background(), b, p)
	if loader.total.Load() != 2 || sa.Data.Vacancies[0].ID != a || sb.Data.Vacancies[0].ID != b {
		t.Fatalf("companies share a snapshot: loads %d", loader.total.Load())
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached")
		}
		time.Sleep(time.Millisecond)
	}
}
