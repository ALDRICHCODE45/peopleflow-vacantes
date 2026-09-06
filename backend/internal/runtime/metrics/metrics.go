// Package metrics defines the narrow, consumer-side observability ports for
// HTTP requests, the DB connection pool, and readiness state, plus the
// zero-dependency no-op default used when no exporter is configured. No
// metrics endpoint or exporter exists in this change (design §8.3).
package metrics

import "time"

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
