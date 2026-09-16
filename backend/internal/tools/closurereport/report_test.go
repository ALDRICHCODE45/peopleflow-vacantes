// Task 7.3 (WS7C) RED: behavior-first generator tests against fixture
// evidence sets only. The algorithm runs exclusively on in-memory Evidence
// values (temporary fixtures); the real repository tree is never consumed or
// mutated. RED contract: a complete fixture must reach GO, every incomplete
// fixture must stay NO-GO while listing its blocker, all blockers must be
// listed in one run, and no waiver or size:exception counts as technical
// evidence. The stub always emits NO-GO with an empty blocker list, so the
// GO and blocker expectations fail behaviorally.
package closurereport

import (
	"bytes"
	"slices"
	"testing"
)

// treeID is the shared tree identity every complete-fixture receipt matches.
const treeID = "tree-complete-fixture-identity"

// Blocker kinds the GREEN algorithm must emit for each incomplete fixture.
const (
	kindStaleReceipt       = "stale-receipt"
	kindMissingReceipt     = "missing-receipt"
	kindIntegrationSkip    = "integration-skip"
	kindUnresolvableAnchor = "unresolvable-anchor"
	kindNonGoal            = "non-goal"
)

// completeEvidence builds a fixture that satisfies every design §10.2 gate:
// one owner plus a resolvable anchor per MUST row, all receipts on the same
// tree identity exiting zero with zero skips, zero-length skip whitelist,
// three executables with runtime-boundary tests, criteria mapped to passing
// rows, and clean non-goal scans.
func completeEvidence() Evidence {
	return Evidence{
		TreeIdentity: treeID,
		Manifest: []ManifestRow{
			{
				Requirement: "Migration Executable (cmd/migrate)",
				Capability:  "backend-runtime",
				Tier:        "MUST",
				Owner:       "backend-runtime",
				Anchor:      "backend/cmd/migrate/main_test.go",
			},
			{
				Requirement: "Single Canonical Route Registration",
				Capability:  "industries",
				Tier:        "MUST",
				Owner:       "industries",
				Anchor:      "backend/cmd/api/main_test.go",
			},
		},
		Receipts: []Receipt{
			{Gate: "gate-build", Status: "pass", Tree: treeID, ExitCode: 0},
			{Gate: "gate-vet", Status: "pass", Tree: treeID, ExitCode: 0},
			{Gate: "gate-fmt", Status: "pass", Tree: treeID, ExitCode: 0},
			{Gate: "gate-unit", Status: "pass", Tree: treeID, ExitCode: 0},
			{Gate: "gate-race", Status: "pass", Tree: treeID, ExitCode: 0},
			{Gate: "gate-integration", Status: "pass", Tree: treeID, ExitCode: 0},
			{Gate: "gate-migrations", Status: "pass", Tree: treeID, ExitCode: 0},
			{Gate: "gate-sqlc", Status: "pass", Tree: treeID, ExitCode: 0},
			{Gate: "gate-arch", Status: "pass", Tree: treeID, ExitCode: 0},
		},
		Executables: []Executable{
			{Name: "cmd/api", RuntimeBoundaryTests: true},
			{Name: "cmd/migrate", RuntimeBoundaryTests: true},
			{Name: "cmd/postconfirmation", RuntimeBoundaryTests: true},
		},
		SkipWhitelistLen: 0,
		Criteria: []Criterion{
			{
				ID:               "criterion-3-serial-live-integration-zero-unexpected-skips",
				RequiredGates:    []string{"gate-integration"},
				RequiredManifest: []string{"Single Canonical Route Registration"},
			},
			{
				ID:               "criterion-4-fresh-migrations-and-sqlc-deterministic",
				RequiredGates:    []string{"gate-migrations", "gate-sqlc"},
				RequiredManifest: []string{"Migration Executable (cmd/migrate)"},
			},
		},
	}
}

// missingGate removes the named receipt so a criterion loses its pass row.
func missingGate(gate string) func(*Evidence) {
	return func(ev *Evidence) {
		ev.Receipts = slices.DeleteFunc(ev.Receipts, func(r Receipt) bool { return r.Gate == gate })
	}
}

// wantKinds asserts the decision is NO-GO and every expected blocker kind is
// present in the single run.
func wantKinds(t *testing.T, got Report, want ...string) {
	t.Helper()
	if got.Decision != DecisionNoGo {
		t.Fatalf("decision = %q, want NO-GO", got.Decision)
	}
	if len(got.Blockers) == 0 {
		t.Fatalf("blockers list is empty; want blockers of kinds %v (stub emits none)", want)
	}
	for _, kind := range want {
		if !slices.ContainsFunc(got.Blockers, func(b Blocker) bool { return b.Kind == kind }) {
			t.Fatalf("blocker kind %q missing from %v", kind, got.Blockers)
		}
	}
}

func TestGenerate_CompleteFixtureReachesGO(t *testing.T) {
	ev := completeEvidence()
	got := Generate(ev)
	if got.Decision != DecisionGo {
		t.Fatalf("complete fixture decision = %q, want GO (stub never flips to GO)", got.Decision)
	}
	if len(got.Blockers) != 0 {
		t.Fatalf("complete fixture unexpectedly blocked: %+v", got.Blockers)
	}
}

func TestGenerate_IncompleteFixturesStayNoGoListingBlockers(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
		want   []string
	}{
		{
			name: "stale receipt does not match tree identity",
			mutate: func(ev *Evidence) {
				ev.Receipts[0].Tree = "tree-stale"
			},
			want: []string{kindStaleReceipt},
		},
		{
			name:   "required receipt is missing",
			mutate: missingGate("gate-sqlc"),
			want:   []string{kindMissingReceipt},
		},
		{
			name: "integration receipt records one skip",
			mutate: func(ev *Evidence) {
				for i, r := range ev.Receipts {
					if r.Gate == "gate-integration" {
						ev.Receipts[i].SkipNames = []string{"TestUnexpectedSkip"}
					}
				}
			},
			want: []string{kindIntegrationSkip},
		},
		{
			name: "one manifest row has an unresolvable anchor",
			mutate: func(ev *Evidence) {
				ev.Manifest[0].Anchor = ""
			},
			want: []string{kindUnresolvableAnchor},
		},
		{
			name: "locked non-goal scan records one hit",
			mutate: func(ev *Evidence) {
				ev.NonGoalFindings = []string{"backend/Dockerfile"}
			},
			want: []string{kindNonGoal},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			wantKinds(t, Generate(ev), tt.want...)
		})
	}
}

func TestGenerate_AllBlockersListedInOneRun(t *testing.T) {
	ev := completeEvidence()
	ev.Receipts[0].Tree = "tree-stale"
	missingGate("gate-sqlc")(&ev)
	for i, r := range ev.Receipts {
		if r.Gate == "gate-integration" {
			ev.Receipts[i].SkipNames = []string{"TestOneSkip"}
		}
	}
	ev.Manifest[0].Anchor = ""
	ev.NonGoalFindings = []string{"backend/docker-compose.yml"}
	wantKinds(
		t,
		Generate(ev),
		kindStaleReceipt,
		kindMissingReceipt,
		kindIntegrationSkip,
		kindUnresolvableAnchor,
		kindNonGoal,
	)
}

func TestGenerate_WaiverAndSizeExceptionAreNotTechnicalEvidence(t *testing.T) {
	ev := completeEvidence()
	for i, r := range ev.Receipts {
		if r.Gate == "gate-integration" {
			ev.Receipts[i].SkipNames = []string{"TestWaivedAway"}
		}
	}
	ev.Waivers = []Waiver{
		{Kind: "waiver", Description: "the one integration skip is waived"},
		{Kind: "size:exception", Description: "oversized review slice accepted"},
	}
	wantKinds(t, Generate(ev), kindIntegrationSkip)
}

func TestReport_WriteJSON_EmptyBlockersIsArray(t *testing.T) {
	var buf bytes.Buffer
	if err := (Report{Decision: DecisionNoGo, Blockers: []Blocker{}}).WriteJSON(&buf); err != nil {
		t.Fatalf("write: %v", err)
	}
	if got, want := buf.String(), `{"decision":"NO-GO","blockers":[]}`+"\n"; got != want {
		t.Fatalf("WriteJSON = %q, want %q (null blockers, not [])", got, want)
	}
}
