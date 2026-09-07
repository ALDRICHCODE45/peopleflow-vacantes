// Package metrics defines the narrow, consumer-side observability ports for
// HTTP requests, the DB connection pool, and readiness state, plus the
// zero-dependency no-op default used when no exporter is configured. No
// metrics endpoint or exporter exists in this change (design §8.3).
package metrics

import (
	"context"
	"time"
)

// HTTPMetrics observes HTTP requests. route MUST be the bounded matched route
// pattern (e.g. "/companies/{id}"), never a raw URL.
type HTTPMetrics interface {
	ObserveRequest(method, route string, status int, d time.Duration)
}

// DBMetrics observes connection pool state sampled from pgxpool.Stat().
type DBMetrics interface {
	ObservePool(acquired, idle, max int32)
}

// ReadinessMetrics observes the server readiness gauge.
type ReadinessMetrics interface {
	SetReady(ready bool)
}

// Noop implements every port with no side effects, no allocation, and no
// exporter dependency. It is the default implementation when no exporter is
// configured; callers depend only on the interfaces above.
type Noop struct{}

// Default is the shared no-op value satisfying all three ports.
var Default Noop

// ObserveRequest does nothing.
func (Noop) ObserveRequest(string, string, int, time.Duration) {}

// ObservePool does nothing.
func (Noop) ObservePool(int32, int32, int32) {}

// SetReady does nothing.
func (Noop) SetReady(bool) {}

// Pinger is the minimal ping capability decorated by DBObservedPinger. It is
// structurally identical to the consumer-owned health.Pinger port; this
// package does not import the health package (health depends on metrics, so
// the seam stays one-directional).
type Pinger interface {
	Ping(ctx context.Context) error
}

// PoolSampler samples the current pgx connection-pool counts. The composition
// root supplies it as a closure over pgxpool.Stat(), keeping this package
// free of any database-driver dependency.
type PoolSampler func() (acquired, idle, max int32)

// DBObservedPinger decorates a Pinger so every readiness ping — successful or
// failed — samples the current pool state exactly once and forwards it to
// DBMetrics.ObservePool. The underlying ping result and error identity are
// preserved untouched; no exporter, endpoint, or goroutine is involved.
type DBObservedPinger struct {
	inner  Pinger
	sample PoolSampler
	db     DBMetrics
}

// NewDBObservedPinger binds the decorator. A nil db resolves to the shared
// no-op Default; a nil sampler observes nothing (defensive; the production
// wiring always supplies a real sampler over pgxpool.Stat()).
func NewDBObservedPinger(inner Pinger, sample PoolSampler, db DBMetrics) *DBObservedPinger {
	if db == nil {
		db = Default
	}
	return &DBObservedPinger{inner: inner, sample: sample, db: db}
}

// Ping delegates to the decorated pinger, then samples and forwards the
// current pool state exactly once — after successful AND failed pings — and
// returns the underlying error untouched.
func (p *DBObservedPinger) Ping(ctx context.Context) error {
	err := p.inner.Ping(ctx)
	if p.sample != nil {
		acquired, idle, max := p.sample()
		p.db.ObservePool(acquired, idle, max)
	}
	return err
}
