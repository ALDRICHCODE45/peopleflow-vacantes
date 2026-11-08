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

// Snapshot is the company's fact set for one period, unfiltered. AsOf is the
// instant it was loaded: the "now" of every now-dependent rule (§2).
type Snapshot struct {
	Data *Dataset
	AsOf time.Time
}

// snapshotKey starts with the session's company id, so nothing crosses
// companies; the recruiter and requester filters run in Go over the snapshot.
type snapshotKey struct {
	company  uuid.UUID
	from, to string
}

type snapshotLoad func(ctx context.Context, company uuid.UUID, p Period) (*Dataset, error)

// snapshots is an in-process LRU of snapshots with a TTL. Concurrent misses
// for one key share one load (singleflight); the load runs detached from the
// first caller with its own timeout, so a cancelled request fails no other.
type snapshots struct {
	load     snapshotLoad
	now      func() time.Time
	ttl      time.Duration
	capacity int
	timeout  time.Duration

	mu      sync.Mutex
	entries map[snapshotKey]*list.Element // of *snapshotEntry
	order   *list.List                    // front = most recently used
	calls   map[snapshotKey]*snapshotCall
}

type snapshotEntry struct {
	key  snapshotKey
	snap *Snapshot
}

type snapshotCall struct {
	done    chan struct{}
	snap    *Snapshot
	err     error
	waiters int
}

func newSnapshots(load snapshotLoad, now func() time.Time, ttl time.Duration, capacity int, timeout time.Duration) *snapshots {
	return &snapshots{load: load, now: now, ttl: ttl, capacity: capacity, timeout: timeout,
		entries: map[snapshotKey]*list.Element{}, order: list.New(), calls: map[snapshotKey]*snapshotCall{}}
}

// get returns the fresh snapshot of (company, period), loading it once for
// every concurrent caller on a miss.
func (c *snapshots) get(ctx context.Context, company uuid.UUID, p Period) (*Snapshot, error) {
	key := snapshotKey{company, p.From, p.To}
	c.mu.Lock()
	now := c.now()
	if el, ok := c.entries[key]; ok {
		e := el.Value.(*snapshotEntry)
		if now.Sub(e.snap.AsOf) < c.ttl {
			c.order.MoveToFront(el)
			c.mu.Unlock()
			return e.snap, nil
		}
		c.order.Remove(el)
		delete(c.entries, key)
	}
	call, ok := c.calls[key]
	if !ok {
		call = &snapshotCall{done: make(chan struct{})}
		c.calls[key] = call
		go c.run(context.WithoutCancel(ctx), key, p, now, call)
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
func (c *snapshots) run(ctx context.Context, key snapshotKey, p Period, asOf time.Time, call *snapshotCall) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	func() {
		defer func() {
			if r := recover(); r != nil {
				call.err = fmt.Errorf("metrics snapshot load panicked: %v", r)
			}
		}()
		var data *Dataset
		data, call.err = c.load(ctx, key.company, p)
		if call.err == nil {
			call.snap = &Snapshot{Data: data, AsOf: asOf}
		}
	}()
	c.mu.Lock()
	delete(c.calls, key)
	if call.err == nil {
		c.entries[key] = c.order.PushFront(&snapshotEntry{key, call.snap})
		for c.order.Len() > c.capacity {
			oldest := c.order.Back()
			c.order.Remove(oldest)
			delete(c.entries, oldest.Value.(*snapshotEntry).key)
		}
	}
	c.mu.Unlock()
	close(call.done)
}

// waiters is the number of callers waiting on the key's load (tests).
func (c *snapshots) waiters(key snapshotKey) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if call, ok := c.calls[key]; ok {
		return call.waiters
	}
	return 0
}

// len is the number of cached snapshots (tests).
func (c *snapshots) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}
