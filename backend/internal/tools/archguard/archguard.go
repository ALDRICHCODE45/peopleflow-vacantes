// Package archguard enforces the backend-runtime Architecture Guard rules
// (design A1): forbidden cross-feature infrastructure imports, the exact
// documented narrow exceptions, route topology against composition-root
// drift, error-catalog usage, and the locked non-goals.
//
// RED SCAFFOLD (Task 7.2 / WS7B): every guard below is an accept-all stub
// that reports no violation for any input. The fixture tests in
// archguard_test.go already pin the required behavior, so the focused RED
// command fails behaviorally ("accept-all guards report no violation on the
// mutated fixtures"). GREEN replaces these bodies with real walking logic;
// no test fixture is expected to change shape.
package archguard

// Violation is one guard finding.
type Violation struct {
	Rule   string // stable rule identifier
	File   string // offending file or package path
	Detail string // human-readable reason, names the offender
}

// DocumentedExceptions is the exact, closed exception set the guard must
// allow: the narrow cross-feature domain-port imports and the audit co-write
// type imports observed in the tree. Exact package paths, never wildcards.
var DocumentedExceptions = []string{
	// Audit co-write types (companies + applications write audit rows).
	"internal/features/audit_events/domain/entities",
	"internal/features/audit_events/domain/repositories",
	// Cross-feature domain ports (identity actor/roles, companies entities).
	"internal/features/identity/domain/entities",
	"internal/features/identity/domain/repositories",
	"internal/features/identity/domain/security",
	"internal/features/identity/domain/valueobjects",
	"internal/features/companies/domain/entities",
	"internal/features/companies/domain/repositories",
	"internal/features/companies/domain/valueobjects",
}

// SourceFile is one file offered to the error-catalog scan.
type SourceFile struct {
	Path    string
	Content string
}

// Route is one declared route in the composition root.
type Route struct {
	Method     string
	Path       string
	Gated      bool     // requires the authenticated subtree
	Middleware []string // middleware names required by the owning subtree
}

// Topology is the declared route topology: public mounts separate from the
// gated write subtree.
type Topology struct {
	Public []Route
	Gated  []Route
}

// CheckCrossFeatureImports reports cross-feature imports of another feature's
// infrastructure packages, naming the offender. Imports listed in
// DocumentedExceptions stay allowed.
//
// RED STUB: returns no violations for every input.
func CheckCrossFeatureImports(packages map[string][]string) []Violation {
	_ = packages
	return nil
}

// CheckRouteTopology reports route-topology drift: a gated write route moved
// onto a public mount, or a required middleware removed from the gated
// subtree.
//
// RED STUB: returns no violations for every input.
func CheckRouteTopology(want, got Topology) []Violation {
	_, _ = want, got
	return nil
}

// CheckErrorCatalogUsage rejects ad-hoc `code` string literals outside
// internal/shared/httpjson and direct feature error-JSON writes.
//
// RED STUB: returns no violations for every input.
func CheckErrorCatalogUsage(files []SourceFile) []Violation {
	_ = files
	return nil
}

// CheckNonGoals rejects newly introduced locked non-goal paths for this
// closure: Docker, Terraform, workers, outbox, and deployment-resource paths.
//
// RED STUB: returns no violations for every input.
func CheckNonGoals(paths []string) []Violation {
	_ = paths
	return nil
}
