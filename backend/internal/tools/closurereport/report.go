// Package closurereport generates the WS7C traceability Markdown view and the
// objective AWS go/no-go report (design §10.2) from immutable closure
// evidence: traceability manifest rows, gate receipts, executables, the skip
// whitelist, non-goal scan findings, and the proposal §9 criteria map.
//
// RED (Task 7.3 / WS7C): Generate is a deliberate stub that always returns
// NO-GO with an empty blocker list regardless of the evidence. GREEN must
// implement the design §10.2 algorithm — traceability validation with one
// owner and at least one resolvable anchor per MUST, tree-identity-bound
// receipts exiting zero, zero integration skips and a zero-length skip
// whitelist, the three built executables with runtime-boundary tests, every
// proposal §9 criterion mapped to passing rows, and locked non-goal scans —
// and list every blocker in one run. Waivers and size:exception entries are
// never accepted as technical evidence.
package closurereport

import (
	"encoding/json"
	"io"
)

// Decision values written into every report.
const (
	DecisionGo   = "GO"
	DecisionNoGo = "NO-GO"
)

// Report is the generated go/no-go decision record.
type Report struct {
	Decision string    `json:"decision"`
	Blockers []Blocker `json:"blockers"`
}

// Blocker names one reason the report stays at NO-GO.
type Blocker struct {
	Kind    string `json:"kind"`
	Subject string `json:"subject"`
	Detail  string `json:"detail"`
}

// ManifestRow is one traceability-manifest row
// (backend/quality/traceability.json): one effective MUST requirement with its
// single owning capability and one resolved anchor.
type ManifestRow struct {
	Requirement string
	Capability  string
	Tier        string
	Owner       string // exactly one owning capability
	Anchor      string // resolved path/symbol/test; empty means unresolvable
}

// Receipt is the machine-readable gate receipt
// (backend/quality/receipts/*.json) the algorithm consumes.
type Receipt struct {
	Gate      string
	Status    string
	Tree      string
	ExitCode  int
	SkipNames []string
}

// Executable is one built runtime boundary and its test evidence.
type Executable struct {
	Name                 string // cmd/api, cmd/migrate, cmd/postconfirmation
	RuntimeBoundaryTests bool
}

// Criterion is one proposal §9 criterion and the gate receipts plus manifest
// requirements that must support it with passing evidence.
type Criterion struct {
	ID               string
	RequiredGates    []string
	RequiredManifest []string
}

// Waiver is a non-technical exception claim. The algorithm never accepts a
// waiver or a size:exception as technical evidence: it may not flip the
// decision, remove a blocker, or substitute for a missing receipt or anchor.
type Waiver struct {
	Kind        string // "waiver" or "size:exception"
	Description string
}

// Evidence is the immutable input set the report algorithm evaluates.
type Evidence struct {
	TreeIdentity     string
	Manifest         []ManifestRow
	Receipts         []Receipt
	Executables      []Executable
	SkipWhitelistLen int
	NonGoalFindings  []string
	Waivers          []Waiver
	Criteria         []Criterion
}

// Generate renders the go/no-go Report from evidence.
//
// RED stub: always NO-GO with an empty blocker list, whatever the evidence
// contains. GREEN replaces this body with the design §10.2 algorithm while
// keeping the signature and the write contract stable.
func Generate(_ Evidence) Report {
	return Report{Decision: DecisionNoGo, Blockers: []Blocker{}}
}

// WriteJSON writes the report as one JSON line: the canonical write path for
// the decision artifact.
func (r Report) WriteJSON(w io.Writer) error {
	return json.NewEncoder(w).Encode(r)
}
