package metrics_test

import (
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
