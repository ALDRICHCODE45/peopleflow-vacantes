package metricsdemo

import (
	"strings"

	"github.com/google/uuid"
)

// Namespace is the uuid v5 namespace of every demo id. Never change it: rows
// seeded under another namespace would be invisible to remove.
var Namespace = uuid.MustParse("5c0f3e2a-8d4b-4f6e-9a1c-7b2d4e6f8a90")

// ID is the demo id of a label path. The parts are joined with the unit
// separator, which no label contains, so ("a", "b") and ("a/b") differ.
func ID(parts ...string) uuid.UUID {
	return uuid.NewSHA1(Namespace, []byte(strings.Join(parts, "\x1f")))
}

// CompanyID is the «Demo Métricas» company.
func CompanyID() uuid.UUID { return ID("company") }
