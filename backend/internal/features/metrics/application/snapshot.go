package application

import (
	"container/list"
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Snapshot defaults (stakeholder-metrics-v2 §2, DV6).
const (
	SnapshotTTL      = 60 * time.Second
	SnapshotCapacity = 128
	SnapshotTimeout  = 10 * time.Second
)

// cached is one cache entry: the value and the instant it was loaded, the
// "now" of every now-dependent rule (§2).
type cached[V any] struct {
	Data V
	AsOf time.Time
}

// Snapshot is the company's fact set for one period, unfiltered.
type Snapshot = cached[*Dataset]

// PipelineSnapshot is the company's current pipeline (§2, §4.4); it does not
// depend on the period.
type PipelineSnapshot = cached[*PipelineData]

// snapshotKey starts with the session's company id, so nothing crosses
// companies; the recruiter and requester filters run in Go over the snapshot.
type snapshotKey struct {
	company  uuid.UUID
	from, to string
}

type snapshotLoad func(ctx context.Context, company uuid.UUID, p Period) (*Dataset, error)

// snapshots caches the period snapshots, keyed (company, from, to).
type snapshots struct {
	*cache[snapshotKey, *Dataset]
	load snapshotLoad
}

func newSnapshots(load snapshotLoad, now func() time.Time, ttl time.Duration, capacity int, timeout time.Duration) *snapshots {
	return &snapshots{newCache[snapshotKey, *Dataset](now, ttl, capacity, timeout), load}
}

// get returns the fresh snapshot of (company, period), loading it once for
// every concurrent caller on a miss.
func (c *snapshots) get(ctx context.Context, company uuid.UUID, p Period) (*Snapshot, error) {
	return c.cache.get(ctx, snapshotKey{company, p.From, p.To}, func(ctx context.Context) (*Dataset, error) { return c.load(ctx, company, p) })
}

// cache is an in-process LRU with a TTL. Concurrent misses for one key share
// one load (singleflight); the load runs detached from the first caller with
// its own timeout, so a cancelled request fails no other.
type cache[K comparable, V any] struct {
	now      func() time.Time
	ttl      time.Duration
	capacity int
	timeout  time.Duration

	mu      sync.Mutex
	entries map[K]*list.Element // of *cacheEntry
	order   *list.List          // front = most recently used
	calls   map[K]*cacheCall[V]
}

type cacheEntry[K comparable, V any] struct {
	id   K
	snap *cached[V]
}

type cacheCall[V any] struct {
	done    chan struct{}
	snap    *cached[V]
	err     error
	waiters int
}

func newCache[K comparable, V any](now func() time.Time, ttl time.Duration, capacity int, timeout time.Duration) *cache[K, V] {
	return &cache[K, V]{now: now, ttl: ttl, capacity: capacity, timeout: timeout,
		entries: map[K]*list.Element{}, order: list.New(), calls: map[K]*cacheCall[V]{}}
}

// get returns the fresh entry of id, running load once for every concurrent
// caller on a miss (the first caller's load).
func (c *cache[K, V]) get(ctx context.Context, id K, load func(context.Context) (V, error)) (*cached[V], error) {
	c.mu.Lock()
	now := c.now()
	if el, ok := c.entries[id]; ok {
		e := el.Value.(*cacheEntry[K, V])
		if now.Sub(e.snap.AsOf) < c.ttl {
			c.order.MoveToFront(el)
			c.mu.Unlock()
			return e.snap, nil
		}
		c.order.Remove(el)
		delete(c.entries, id)
	}
	call, ok := c.calls[id]
	if !ok {
		call = &cacheCall[V]{done: make(chan struct{})}
		c.calls[id] = call
		go c.run(context.WithoutCancel(ctx), id, load, now, call)
	}
	call.waiters++
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		call.waiters--
		c.mu.Unlock()
	}()
	select {
	case <-call.done:
		return call.snap, call.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// run performs the shared load; errors are returned to the waiters, never
// cached.
func (c *cache[K, V]) run(ctx context.Context, id K, load func(context.Context) (V, error), asOf time.Time, call *cacheCall[V]) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	func() {
		defer func() {
			if r := recover(); r != nil {
				call.err = fmt.Errorf("metrics snapshot load panicked: %v", r)
			}
		}()
		var data V
		data, call.err = load(ctx)
		if call.err == nil {
			call.snap = &cached[V]{Data: data, AsOf: asOf}
		}
	}()
	c.mu.Lock()
	delete(c.calls, id)
	if call.err == nil {
		c.entries[id] = c.order.PushFront(&cacheEntry[K, V]{id, call.snap})
		for c.order.Len() > c.capacity {
			oldest := c.order.Back()
			c.order.Remove(oldest)
			delete(c.entries, oldest.Value.(*cacheEntry[K, V]).id)
		}
	}
	c.mu.Unlock()
	close(call.done)
}

// waiters is the number of callers waiting on the id's load (tests).
func (c *cache[K, V]) waiters(id K) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if call, ok := c.calls[id]; ok {
		return call.waiters
	}
	return 0
}

// len is the number of cached entries (tests).
func (c *cache[K, V]) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}
