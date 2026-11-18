// Package metricsdemo builds and removes the dev-only «Demo Métricas» company
// that feeds the stakeholder metrics board with a realistic year of data
// (odd/tasks/stakeholder-metrics-v2-backend.md T8, docs/devseed-metrics-demo.md).
//
// Everything it writes hangs off one deterministic company id and a fixed set
// of deterministic ids (uuid v5 over Namespace), so apply is idempotent and
// remove finds exactly what apply wrote. It is never part of the migrations
// and only runs against the local development database (guard.go); the
// integration test reaches it through TestOnlyDatabase.
package metricsdemo
