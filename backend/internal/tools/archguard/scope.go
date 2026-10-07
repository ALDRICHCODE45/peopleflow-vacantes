// This file owns the backend capability scope.
//
// The global openspec/specs tree composes capabilities owned by more than one
// product, so every backend owner that validates a composed effective MUST set
// against the backend traceability manifest must first scope the observation to
// the capabilities the backend closure owns. This is the single source-owned
// scope contract shared by the gate-arch repository runner (runner.go,
// CheckRepository) and the WS7C closure report
// (internal/tools/closurereport), so the two consumers can never disagree about
// what "backend" means.

package archguard

// BackendCapabilities is the explicit, closed capability scope of the backend
// closure: exactly the capabilities the backend traceability manifest and the
// backend-runtime product own, in ascending name order.
//
// CheckRepository and the closure report both observe the effective MUST set
// composed from the canonical openspec/specs tree plus this change's deltas,
// and that tree also composes capabilities owned by other products (for example
// the frontend public-job-discovery capability). Scoping to this closed set
// keeps such foreign capabilities from being reported as missing backend
// manifest rows.
//
// Ownership is capability-based, never title-based: every requirement inside a
// backend capability is still compared exactly, so an added, missing, or
// repeated backend requirement stays detectable. The set is package-owned and
// closed — it is never derived from caller, manifest, or effective-set data,
// because deriving ownership from the observation would hide a genuinely
// missing capability. The closure report's package-owned canonical MUST set is
// pinned to this list by test, so the scope and the expected backend
// requirements cannot drift silently.
var BackendCapabilities = []string{
	"applications",
	"audit_events",
	"backend-runtime",
	"candidates",
	"companies",
	"company-membership",
	"identity",
	"industries",
	"jobs",
}

// backendCapabilitySet indexes BackendCapabilities for membership tests.
var backendCapabilitySet = func() map[string]bool {
	set := make(map[string]bool, len(BackendCapabilities))
	for _, capability := range BackendCapabilities {
		set[capability] = true
	}
	return set
}()

// isBackendCapability reports whether capability is one of the closed
// BackendCapabilities the backend closure owns. An unknown capability is never
// treated as backend-owned.
func isBackendCapability(capability string) bool {
	return backendCapabilitySet[capability]
}

// ScopeToBackendCapabilities keeps the observed effective requirements that
// belong to a backend capability and drops every requirement in a capability
// the backend closure does not own. Requirements inside an owned capability are
// returned unchanged and in input order, so the caller still compares them
// exactly and drift inside the backend scope remains detectable.
func ScopeToBackendCapabilities(observed []EffectiveRequirement) []EffectiveRequirement {
	scoped := make([]EffectiveRequirement, 0, len(observed))
	for _, req := range observed {
		if isBackendCapability(req.Capability) {
			scoped = append(scoped, req)
		}
	}
	return scoped
}
