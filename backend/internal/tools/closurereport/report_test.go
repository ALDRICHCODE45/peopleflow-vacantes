// Task 7.3 (WS7C) RED: behavior-first generator tests against fixture
// evidence sets only. The algorithm runs exclusively on in-memory Evidence
// values (temporary fixtures); the real repository tree is never consumed or
// mutated except by the single read-only completeness test, which only loads
// canonical specs, delta specs, and the real traceability manifest.
//
// BC-04 final contract: eligibility is decided from the package-owned canonical
// MUST set plus the opaque prepared native-evidence seam. Caller narrowing or
// widening of the gate/executable sets, the render-only legacy manifest
// projection, and the legacy receipt projection never change the decision, and
// absent or zero prepared evidence fails closed. A complete fixture still
// reaches GO while BC-05 criterion pinning is pending.
package closurereport

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/archguard"
)

// treeID is the shared valid Git tree identity every complete raw fixture uses.
const treeID = "2222222222222222222222222222222222222222"

// worktreeID is the integrity-bound worktree state every complete raw fixture
// receipt carries; Evidence.WorktreeState must equal it for a receipt to pass the
// same-tree AND same-worktree check.
const worktreeID = "sha256:3333333333333333333333333333333333333333333333333333333333333333"

// Blocker kinds the future BC-03 GREEN algorithm must emit for incomplete raw
// evidence. These tests intentionally run against the legacy-only generator.
const (
	kindStaleReceipt       = "stale-receipt"
	kindMissingReceipt     = "missing-receipt"
	kindInvalidReceipt     = "invalid-receipt"
	kindDuplicateReceipt   = "duplicate-receipt"
	kindFailedReceipt      = "failed-receipt"
	kindIntegrationSkip    = "integration-skip"
	kindSkipWhitelist      = "skip-whitelist"
	kindExecutable         = "executable"
	kindCriterion          = "criterion"
	kindUnresolvableAnchor = "unresolvable-anchor"
	kindNonGoal            = "non-goal"

	// BC-04 native-evidence kinds.
	kindInvalidManifest    = "invalid-manifest"
	kindUnpreparedEvidence = "unprepared-evidence"
	kindArchitecture       = "architecture"
)

var fixtureGates = []string{
	"gate-build", "gate-vet", "gate-fmt", "gate-unit", "gate-race",
	"gate-integration", "gate-migrations", "gate-sqlc", "gate-arch",
}

// Native fixture support. The prepared-evidence seam is package-internal, so
// these helpers build and mutate observed native evidence without touching the
// real tree. The fixture manifest is derived from the production-owned
// canonical MUST set, never from a test-local copy of the 122 titles.
const (
	fixtureEvidencePath = "backend/internal/tools/closurereport/report.go"
	fixtureEvidenceTest = "TestGenerate_CompleteValidRawFixtureStaysNoGoOnlyForCriterion12"
	fixtureAbsentPath   = "backend/internal/tools/closurereport/absent_test.go"
	fixtureSQLOwner     = "backend/db/queries/companies.sql"
	fixtureSQLSymbol    = "CreateCompany"
	// fixtureAtomicBootstrapOwner is the second implementation-path owner of the
	// real atomic active-industry row (design §10.3): owners are plural
	// implementation paths and the scalar Capability is the owning capability.
	fixtureAtomicBootstrapOwner = "backend/internal/features/companies/infrastructure/postgres/companyBootstrapRepository.go"
)

func fixtureManifestRows() []archguard.TraceabilityRow {
	rows := make([]archguard.TraceabilityRow, 0, len(canonicalMUSTRequirements))
	for _, req := range canonicalMUSTRequirements {
		owners := []string{fixtureEvidencePath}
		if req.Title == atomicIndustryGateTitle {
			owners = []string{fixtureSQLOwner, fixtureAtomicBootstrapOwner}
		}
		rows = append(rows, archguard.TraceabilityRow{
			Requirement: req.Title,
			Capability:  req.Capability,
			Tier:        TierMUST,
			Owners:      owners,
			Evidence: archguard.RowEvidence{
				Path:    fixtureEvidencePath,
				Symbols: []string{"Generate"},
				Tests:   []string{fixtureEvidenceTest},
			},
		})
	}
	return rows
}

func fixtureAnchorIndex() archguard.AnchorIndex {
	return archguard.AnchorIndex{
		Paths:   map[string]bool{fixtureEvidencePath: true},
		Symbols: map[string]bool{"Generate": true},
		Tests:   map[string]bool{fixtureEvidenceTest: true},
	}
}

func fixturePrepared() *PreparedEvidence {
	return &PreparedEvidence{
		manifest: archguard.TraceManifest{
			Schema: "peopleflow.traceability/v1",
			Change: "backend-go-closure",
			Rows:   fixtureManifestRows(),
		},
		index:                fixtureAnchorIndex(),
		effective:            slices.Clone(canonicalMUSTRequirements),
		nonGoalObserved:      true,
		architectureObserved: true,
		sqlSymbols:           []string{fixtureSQLSymbol},
		whitelistObserved:    true,
		loaded:               true,
	}
}

// fixtureRow returns the mutable native manifest row for one requirement title.
func fixtureRow(t *testing.T, ev *Evidence, title string) *archguard.TraceabilityRow {
	t.Helper()
	for i := range ev.Prepared.manifest.Rows {
		if ev.Prepared.manifest.Rows[i].Requirement == title {
			return &ev.Prepared.manifest.Rows[i]
		}
	}
	t.Fatalf("fixture native manifest row %q not found", title)
	return nil
}

// producerGateTools is the frozen WS7A producer check_command per gate
// (scripts/closure/gate), re-stated test-side so gate fixtures stay authentic
// producer evidence independent of the package-owned production contract.
var producerGateTools = map[string]string{
	"gate-build": "go build ./...", "gate-vet": "go vet ./...", "gate-fmt": "gofmt -l .",
	"gate-unit":        "go test ./... -count=1 -v",
	"gate-race":        "go test -race -v -count=1 ./internal/runtime/middleware ./internal/runtime/health ./cmd/api",
	"gate-integration": "go test -tags=integration -p 1 ./... -count=1 -json",
	"gate-migrations":  "built cmd/migrate round trip (cmd/migrate integration harness)",
	"gate-sqlc":        "go tool sqlc generate in a clean temp copy, then diff",
	"gate-arch":        "archguard repository guards (cross-feature imports, ad-hoc code-literal scan, locked non-goals, traceability structure/coverage; route topology via TestRouteTopology_ExactRegistrations)",
}

// sealedRawReceiptForGate builds the exact producer-shaped bytes for a valid
// receipt carrying the authentic gate/tool/command triple. The shared integrity
// oracle is test-only support accepted in BC-02.
func sealedRawReceiptForGate(gate string) []byte {
	tool, ok := producerGateTools[gate]
	if !ok {
		return nil
	}
	raw := strings.Replace(validProducerReceipt, `"gate":"gate-build"`, `"gate":"`+gate+`"`, 1)
	raw = strings.Replace(raw, `"tool":"go build ./..."`, `"tool":"`+tool+`"`, 1)
	raw = strings.Replace(raw, `"command":"make gate-build"`, `"command":"make `+gate+`"`, 1)
	_, digest, err := deriveReceiptIntegrityOracle([]byte(raw))
	if err != nil {
		return nil
	}
	return []byte(strings.Replace(raw, receiptIntegrityPlaceholder, digest, 1))
}

func completeRawReceipts() [][]byte {
	raw := make([][]byte, 0, len(fixtureGates))
	for _, gate := range fixtureGates {
		raw = append(raw, sealedRawReceiptForGate(gate))
	}
	return raw
}

// completeEvidence builds a fixture with sealed producer-shaped raw receipts
// and a legacy projection retained only because unchanged render tests read it.
// It deliberately takes no *testing.T because render_test.go calls it.
func completeEvidence() Evidence {
	return Evidence{
		TreeIdentity:  treeID,
		WorktreeState: worktreeID,
		Prepared:      fixturePrepared(),
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
		RawReceipts: completeRawReceipts(),
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

func resealRawReceipt(t *testing.T, raw []byte, replacements ...receiptReplacement) []byte {
	t.Helper()
	_, oldDigest, err := deriveReceiptIntegrityOracle(raw)
	if err != nil {
		t.Fatalf("derive existing raw receipt integrity: %v", err)
	}
	for _, replacement := range replacements {
		raw = []byte(replaceReceiptLiteral(t, string(raw), replacement.expected, replacement.replacement))
	}
	_, newDigest, err := deriveReceiptIntegrityOracle(raw)
	if err != nil {
		t.Fatalf("derive mutated raw receipt integrity: %v", err)
	}
	return []byte(replaceReceiptLiteral(t, string(raw), oldDigest, newDigest))
}

func replaceRawReceipt(t *testing.T, ev *Evidence, gate string, replacements ...receiptReplacement) {
	t.Helper()
	for i, raw := range ev.RawReceipts {
		if strings.Contains(string(raw), `"gate":"`+gate+`"`) {
			ev.RawReceipts[i] = resealRawReceipt(t, raw, replacements...)
			return
		}
	}
	t.Fatalf("raw receipt for gate %q not found", gate)
}

// missingGate removes the raw receipt so the legacy render projection remains
// complete while the future decision path must report a missing receipt.
func missingGate(gate string) func(*Evidence) {
	return func(ev *Evidence) {
		ev.RawReceipts = slices.DeleteFunc(ev.RawReceipts, func(raw []byte) bool {
			return strings.Contains(string(raw), `"gate":"`+gate+`"`)
		})
	}
}

func wantAllRawReceiptsValid(t *testing.T, rawReceipts [][]byte) {
	t.Helper()
	for _, raw := range rawReceipts {
		if _, err := ValidateReceipt(raw); err != nil {
			t.Fatalf("raw receipt is not sealed and valid: %v", err)
		}
	}
}

func wantSealedRawReceipts(t *testing.T, ev Evidence) {
	t.Helper()
	if len(ev.RawReceipts) != len(fixtureGates) {
		t.Fatalf("raw receipt count = %d, want %d", len(ev.RawReceipts), len(fixtureGates))
	}
	wantAllRawReceiptsValid(t, ev.RawReceipts)
}

func blockersOfKind(got []Blocker, kind string) []Blocker {
	return slices.Collect(func(yield func(Blocker) bool) {
		for _, blocker := range got {
			if blocker.Kind == kind && !yield(blocker) {
				return
			}
		}
	})
}

func wantKindSubjectsExactly(t *testing.T, got []Blocker, kind string, want ...string) {
	t.Helper()
	blockers := blockersOfKind(got, kind)
	if len(blockers) != len(want) {
		t.Fatalf("%s blocker count = %d, want %d: %#v", kind, len(blockers), len(want), blockers)
	}
	remaining := make(map[string]int, len(want))
	for _, subject := range want {
		remaining[subject]++
	}
	for _, blocker := range blockers {
		remaining[blocker.Subject]--
	}
	for subject, count := range remaining {
		if count != 0 {
			t.Fatalf("%s blocker subject %q count delta = %d: %#v", kind, subject, count, blockers)
		}
	}
}

func compareBlockers(left, right Blocker) int {
	for _, pair := range [][2]string{{left.Kind, right.Kind}, {left.Subject, right.Subject}, {left.Detail, right.Detail}} {
		if pair[0] < pair[1] {
			return -1
		}
		if pair[0] > pair[1] {
			return 1
		}
	}
	return 0
}

func wantBlockersGloballySorted(t *testing.T, got []Blocker) {
	t.Helper()
	want := slices.Clone(got)
	slices.SortFunc(want, compareBlockers)
	wantBlockersExactly(t, got, want)
}

func wantBlockersExactly(t *testing.T, got []Blocker, want []Blocker) {
	t.Helper()
	if !slices.EqualFunc(got, want, func(got, want Blocker) bool {
		return got == want
	}) {
		t.Fatalf("blockers = %#v, want exact ordered %#v", got, want)
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

// criterion12Blocker is the single deterministic blocker the fixed criterion 12
// always contributes until Task 8.1 supplies machine-readable docs evidence.
func criterion12Blocker() Blocker {
	return Blocker{Kind: kindCriterion, Subject: criterionC12, Detail: criterion12Detail}
}

// wantCriterionSubjectsExactly asserts the exact set of criterion subjects that
// failed, independent of how many gate or row details a criterion reports.
func wantCriterionSubjectsExactly(t *testing.T, got []Blocker, want ...string) {
	t.Helper()
	subjects := []string{}
	for _, blocker := range blockersOfKind(got, kindCriterion) {
		if !slices.Contains(subjects, blocker.Subject) {
			subjects = append(subjects, blocker.Subject)
		}
	}
	slices.Sort(subjects)
	sorted := slices.Clone(want)
	slices.Sort(sorted)
	if !slices.Equal(subjects, sorted) {
		t.Fatalf("failed criterion subjects = %v, want exactly %v", subjects, sorted)
	}
}

// wantCriterionDetail asserts exactly one criterion blocker with this subject
// and detail.
func wantCriterionDetail(t *testing.T, got []Blocker, subject, detail string) {
	t.Helper()
	matches := slices.DeleteFunc(slices.Clone(blockersOfKind(got, kindCriterion)), func(blocker Blocker) bool {
		return blocker.Subject != subject || blocker.Detail != detail
	})
	if len(matches) != 1 {
		t.Fatalf("criterion %q detail %q count = %d, want exactly 1: %#v", subject, detail, len(matches), blockersOfKind(got, kindCriterion))
	}
}

// deleteFixtureRow removes one observed native manifest row.
func deleteFixtureRow(ev *Evidence, title string) {
	ev.Prepared.manifest.Rows = slices.DeleteFunc(ev.Prepared.manifest.Rows, func(row archguard.TraceabilityRow) bool {
		return row.Requirement == title
	})
}

// duplicateFixtureRow appends an exact duplicate of one observed manifest row, so
// its (capability, requirement) key is no longer carried exactly once.
func duplicateFixtureRow(t *testing.T, ev *Evidence, title string) {
	t.Helper()
	ev.Prepared.manifest.Rows = append(ev.Prepared.manifest.Rows, *fixtureRow(t, ev, title))
}

func TestGenerate_CompleteValidRawFixtureStaysNoGoOnlyForCriterion12(t *testing.T) {
	ev := completeEvidence()
	wantSealedRawReceipts(t, ev)
	got := Generate(ev)
	if got.Decision != DecisionNoGo {
		t.Fatalf("complete fixture decision = %q, want deterministic NO-GO", got.Decision)
	}
	wantBlockersExactly(t, got.Blockers, []Blocker{criterion12Blocker()})
}

func TestGenerate_CompleteValidRawReceiptsIgnoreLegacyProjection(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
	}{
		{
			name: "nil legacy receipt projection",
			mutate: func(ev *Evidence) {
				ev.Receipts = nil
			},
		},
		{
			name: "hostile stale failed duplicate contradictory and criterion-gate legacy projection",
			mutate: func(ev *Evidence) {
				ev.Receipts[0].Tree = "3333333333333333333333333333333333333333"
				ev.Receipts[1].Status = "fail"
				ev.Receipts[1].ExitCode = 1
				ev.Receipts[5].Tree = "3333333333333333333333333333333333333333"
				ev.Receipts[6].Status = "fail"
				ev.Receipts[6].ExitCode = 1
				ev.Receipts[7].Tree = "3333333333333333333333333333333333333333"
				ev.Receipts = append(ev.Receipts,
					Receipt{Gate: "gate-fmt", Status: StatusPass, Tree: treeID, ExitCode: 0},
					Receipt{Gate: "gate-arch", Status: "fail", Tree: treeID, ExitCode: 1},
				)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			wantSealedRawReceipts(t, ev)
			tt.mutate(&ev)
			got := Generate(ev)
			if got.Decision != DecisionNoGo {
				t.Fatalf("complete valid raw evidence decision = %q, want deterministic NO-GO; legacy receipts must not contribute", got.Decision)
			}
			wantBlockersExactly(t, got.Blockers, []Blocker{criterion12Blocker()})
		})
	}
}

// TestGenerate_StaleWorktreeReceiptIsRejected pins the second identity dimension:
// a receipt bound to the current Git tree but to a different worktree state is a
// stale receipt, and neither the legacy receipt projection nor a waiver bypasses
// it.
func TestGenerate_StaleWorktreeReceiptIsRejected(t *testing.T) {
	tests := []struct {
		name   string
		legacy func(*Evidence)
	}{
		{
			name: "legacy projection claims the current worktree state",
			legacy: func(ev *Evidence) {
				ev.Receipts[0].WorktreeState = worktreeID
			},
		},
		{
			name: "waiver claims worktree drift is acceptable",
			legacy: func(ev *Evidence) {
				ev.Waivers = []Waiver{{Kind: "waiver", Description: "worktree_state drift waived"}}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			replaceRawReceipt(t, &ev, "gate-build", receiptReplacement{
				expected:    `"worktree_state":"` + worktreeID + `"`,
				replacement: `"worktree_state":"sha256:5555555555555555555555555555555555555555555555555555555555555555"`,
			})
			tt.legacy(&ev)
			wantSealedRawReceipts(t, ev)

			got := Generate(ev)
			wantKinds(t, got, kindStaleReceipt)
			wantKindSubjectsExactly(t, got.Blockers, kindStaleReceipt, "gate-build")
		})
	}
}

func TestGenerate_IncompleteFixturesStayNoGoListingBlockers(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
		want   []string
	}{
		{
			name: "stale raw receipt does not match tree identity",
			mutate: func(ev *Evidence) {
				replaceRawReceipt(t, ev, "gate-build", receiptReplacement{
					expected:    `"tree":"` + treeID + `"`,
					replacement: `"tree":"3333333333333333333333333333333333333333"`,
				})
			},
			want: []string{kindStaleReceipt},
		},
		{
			name:   "required criterion raw receipt is missing",
			mutate: missingGate("gate-sqlc"),
			want:   []string{kindMissingReceipt, kindCriterion},
		},
		{
			name: "integration raw receipt records one skip",
			mutate: func(ev *Evidence) {
				replaceRawReceipt(t, ev, "gate-integration",
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"skip_names":[]`, `"skip_names":["TestUnexpectedSkip"]`},
					receiptReplacement{`"failure":""`, `"failure":"integration failure"`},
				)
			},
			want: []string{kindFailedReceipt, kindIntegrationSkip, kindCriterion},
		},
		{
			name: "one manifest row has an unresolvable anchor",
			mutate: func(ev *Evidence) {
				fixtureRow(t, ev, "JWT Middleware").Evidence.Path = "backend/internal/tools/closurereport/absent_test.go"
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
	replaceRawReceipt(t, &ev, "gate-build", receiptReplacement{
		expected:    `"tree":"` + treeID + `"`,
		replacement: `"tree":"3333333333333333333333333333333333333333"`,
	})
	missingGate("gate-sqlc")(&ev)
	replaceRawReceipt(t, &ev, "gate-integration",
		receiptReplacement{`"status":"pass"`, `"status":"fail"`},
		receiptReplacement{`"exit_code":0`, `"exit_code":1`},
		receiptReplacement{`"skip_names":[]`, `"skip_names":["TestOneSkip"]`},
		receiptReplacement{`"failure":""`, `"failure":"integration failure"`},
	)
	ev.NonGoalFindings = []string{"backend/docker-compose.yml"}
	fixtureRow(t, &ev, "JWT Middleware").Evidence.Path = "backend/internal/tools/closurereport/absent_test.go"
	wantKinds(
		t,
		Generate(ev),
		kindStaleReceipt,
		kindMissingReceipt,
		kindFailedReceipt,
		kindIntegrationSkip,
		kindCriterion,
		kindUnresolvableAnchor,
		kindNonGoal,
	)
}

func TestGenerate_WaiverAndSizeExceptionAreNotTechnicalEvidence(t *testing.T) {
	ev := completeEvidence()
	replaceRawReceipt(t, &ev, "gate-integration",
		receiptReplacement{`"status":"pass"`, `"status":"fail"`},
		receiptReplacement{`"exit_code":0`, `"exit_code":1`},
		receiptReplacement{`"skip_names":[]`, `"skip_names":["TestWaivedAway"]`},
		receiptReplacement{`"failure":""`, `"failure":"integration failure"`},
	)
	ev.Waivers = []Waiver{
		{Kind: "waiver", Description: "the one integration skip is waived"},
		{Kind: "size:exception", Description: "oversized review slice accepted"},
	}
	wantKinds(t, Generate(ev), kindIntegrationSkip)
}

func TestGenerate_ValidRawFailureBlocksReceiptCriterionAndSkip(t *testing.T) {
	ev := completeEvidence()
	replaceRawReceipt(t, &ev, "gate-integration",
		receiptReplacement{`"status":"pass"`, `"status":"fail"`},
		receiptReplacement{`"exit_code":0`, `"exit_code":1`},
		receiptReplacement{`"skip_names":[]`, `"skip_names":["TestUnexpectedSkip"]`},
		receiptReplacement{`"failure":""`, `"failure":"integration failure"`},
	)
	wantSealedRawReceipts(t, ev)
	wantKinds(t, Generate(ev), kindFailedReceipt, kindIntegrationSkip, kindCriterion)
}

func TestGenerate_ExistingPreservationBlockersStayNoGo(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
		want   string
	}{
		{
			name: "missing runtime boundary executable",
			mutate: func(ev *Evidence) {
				ev.Executables = slices.DeleteFunc(ev.Executables, func(ex Executable) bool {
					return ex.Name == "cmd/migrate"
				})
			},
			want: kindExecutable,
		},
		{
			name: "nonzero observed native skip whitelist",
			mutate: func(ev *Evidence) {
				ev.Prepared.whitelistLen = 1
			},
			want: kindSkipWhitelist,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			wantKinds(t, Generate(ev), tt.want)
		})
	}
}

// TestGenerate_SkipWhitelistRequiresObservedNativeEvidence proves the skip
// whitelist is opaque native observed evidence: an unobserved whitelist fails
// criterion 3 with one deterministic blocker, and the legacy caller length
// projection can neither create nor remove that blocker.
func TestGenerate_SkipWhitelistRequiresObservedNativeEvidence(t *testing.T) {
	unobserved := func(t *testing.T, legacyLen int) Report {
		t.Helper()
		ev := completeEvidence()
		ev.Prepared.whitelistObserved = false
		ev.SkipWhitelistLen = legacyLen
		return Generate(ev)
	}

	t.Run("unobserved whitelist is not a clean whitelist", func(t *testing.T) {
		report := unobserved(t, 0)
		wantBlockersExactly(t, blockersOfKind(report.Blockers, kindSkipWhitelist), []Blocker{
			{Kind: kindSkipWhitelist, Subject: "skip-whitelist", Detail: "observed native skip-whitelist is absent"},
		})
		wantCriterionDetail(t, report.Blockers, criterionC3, "observed native skip-whitelist is absent")
	})

	t.Run("legacy caller length cannot alter the unobserved verdict", func(t *testing.T) {
		zero := unobserved(t, 0)
		hostile := unobserved(t, 9)
		wantBlockersExactly(t, hostile.Blockers, zero.Blockers)
	})

	t.Run("observed zero passes criterion 3 despite a hostile legacy length", func(t *testing.T) {
		ev := completeEvidence()
		ev.SkipWhitelistLen = 9
		report := Generate(ev)
		if got := blockersOfKind(report.Blockers, kindSkipWhitelist); len(got) != 0 {
			t.Fatalf("legacy SkipWhitelistLen must not grant or alter eligibility; got %#v", got)
		}
		wantCriterionSubjectsExactly(t, report.Blockers, criterionC12)
	})
}

// TestGenerate_SkipWhitelistObservedNativeValueBlocksC3 proves an observed native
// whitelist length decides criterion 3: zero passes and a positive length blocks
// with the deterministic length detail.
func TestGenerate_SkipWhitelistObservedNativeValueBlocksC3(t *testing.T) {
	t.Run("observed zero passes", func(t *testing.T) {
		report := Generate(completeEvidence())
		if got := blockersOfKind(report.Blockers, kindSkipWhitelist); len(got) != 0 {
			t.Fatalf("observed zero whitelist must pass: %#v", got)
		}
		wantCriterionSubjectsExactly(t, report.Blockers, criterionC12)
	})

	t.Run("observed positive native length blocks criterion 3", func(t *testing.T) {
		ev := completeEvidence()
		ev.Prepared.whitelistLen = 3
		report := Generate(ev)
		wantBlockersExactly(t, blockersOfKind(report.Blockers, kindSkipWhitelist), []Blocker{
			{Kind: kindSkipWhitelist, Subject: "skip-whitelist", Detail: "length 3, want 0"},
		})
		wantCriterionSubjectsExactly(t, report.Blockers, criterionC3, criterionC12)
		wantCriterionDetail(t, report.Blockers, criterionC3, "skip whitelist length 3, want 0")
	})
}

func TestGenerate_DeterministicBlockerOrder(t *testing.T) {
	ev := completeEvidence()
	fixtureRow(t, &ev, "Migration Executable (`cmd/migrate`)").Evidence = archguard.RowEvidence{}
	ev.Executables = slices.DeleteFunc(ev.Executables, func(ex Executable) bool {
		return ex.Name == "cmd/migrate"
	})
	ev.Prepared.whitelistLen = 2
	ev.NonGoalFindings = []string{"backend/z", "backend/a"}

	got := Generate(ev)
	if got.Decision != DecisionNoGo {
		t.Fatalf("decision = %q, want NO-GO", got.Decision)
	}
	wantBlockersGloballySorted(t, got.Blockers)

	// Criterion blockers are pinned by their own BC-05 tests; this test pins the
	// deterministic order of the concrete native/gate/executable/skip/non-goal
	// blockers, which BC-03 and BC-04 share.
	concrete := slices.DeleteFunc(slices.Clone(got.Blockers), func(b Blocker) bool {
		return b.Kind == kindCriterion
	})
	wantBlockersExactly(t, concrete, []Blocker{
		{
			Kind:    kindExecutable,
			Subject: "cmd/migrate",
			Detail:  "built executable with runtime-boundary tests absent",
		},
		{Kind: kindNonGoal, Subject: "backend/a", Detail: "locked non-goal scan hit"},
		{Kind: kindNonGoal, Subject: "backend/z", Detail: "locked non-goal scan hit"},
		{Kind: kindSkipWhitelist, Subject: "skip-whitelist", Detail: "length 2, want 0"},
		{
			Kind:    kindUnresolvableAnchor,
			Subject: "backend-runtime/Migration Executable (`cmd/migrate`)",
			Detail:  "MUST row has no resolvable anchor",
		},
	})
}

func TestGenerate_RejectsMalformedAndSemanticallyInvalidRawReceipts(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
	}{
		{
			name: "malformed raw receipt",
			mutate: func(ev *Evidence) {
				ev.RawReceipts[0] = []byte(`{"gate":`)
			},
		},
		{
			name: "semantically invalid but correctly resealed raw receipt",
			mutate: func(ev *Evidence) {
				replaceRawReceipt(t, ev, "gate-build", receiptReplacement{
					expected:    `"status":"pass"`,
					replacement: `"status":"unknown"`,
				})
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			wantKinds(t, Generate(ev), kindInvalidReceipt)
		})
	}
}

func TestGenerate_RejectsDuplicateAndContradictoryRawReceipts(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
	}{
		{
			name: "identical valid raw receipts for one gate",
			mutate: func(ev *Evidence) {
				ev.RawReceipts = append(ev.RawReceipts, slices.Clone(ev.RawReceipts[0]))
			},
		},
		{
			name: "contradictory valid raw receipts for one gate",
			mutate: func(ev *Evidence) {
				contradictory := resealRawReceipt(t, ev.RawReceipts[0],
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"failure":""`, `"failure":"gate failed"`},
				)
				ev.RawReceipts = append(ev.RawReceipts, contradictory)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			wantKinds(t, Generate(ev), kindDuplicateReceipt)
		})
	}
}

func TestGenerate_RejectsMissingAndManualOnlyRawEvidence(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
	}{
		{
			name:   "missing required criterion raw gate with complete legacy projection",
			mutate: missingGate("gate-sqlc"),
		},
		{
			name: "complete hand-built legacy receipts without raw receipts",
			mutate: func(ev *Evidence) {
				ev.RawReceipts = nil
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			want := []string{kindMissingReceipt}
			if tt.name == "missing required criterion raw gate with complete legacy projection" {
				want = append(want, kindCriterion)
			}
			wantKinds(t, Generate(ev), want...)
		})
	}
}

func TestGenerate_ManualOnlyLegacyReceiptsEnumerateAllRawBlockers(t *testing.T) {
	ev := completeEvidence()
	ev.RawReceipts = nil

	got := Generate(ev)
	wantKinds(t, got, kindMissingReceipt, kindCriterion)
	wantKindSubjectsExactly(t, got.Blockers, kindMissingReceipt, fixtureGates...)
	wantBlockersExactly(t, blockersOfKind(got.Blockers, kindCriterion), []Blocker{
		{
			Kind:    kindCriterion,
			Subject: criterionC11,
			Detail:  `criterion gate "gate-arch" is not a passing zero-skip same-identity receipt`,
		},
		criterion12Blocker(),
		{
			Kind:    kindCriterion,
			Subject: criterionC2,
			Detail:  `criterion gate "gate-build" is not a passing zero-skip same-identity receipt`,
		},
		{
			Kind:    kindCriterion,
			Subject: criterionC2,
			Detail:  `criterion gate "gate-fmt" is not a passing zero-skip same-identity receipt`,
		},
		{
			Kind:    kindCriterion,
			Subject: criterionC2,
			Detail:  `criterion gate "gate-race" is not a passing zero-skip same-identity receipt`,
		},
		{
			Kind:    kindCriterion,
			Subject: criterionC2,
			Detail:  `criterion gate "gate-unit" is not a passing zero-skip same-identity receipt`,
		},
		{
			Kind:    kindCriterion,
			Subject: criterionC2,
			Detail:  `criterion gate "gate-vet" is not a passing zero-skip same-identity receipt`,
		},
		{
			Kind:    kindCriterion,
			Subject: criterionC3,
			Detail:  `criterion gate "gate-integration" is not a passing zero-skip same-identity receipt`,
		},
		{
			Kind:    kindCriterion,
			Subject: criterionC4,
			Detail:  `criterion gate "gate-migrations" is not a passing zero-skip same-identity receipt`,
		},
		{
			Kind:    kindCriterion,
			Subject: criterionC4,
			Detail:  `criterion gate "gate-sqlc" is not a passing zero-skip same-identity receipt`,
		},
	})
}

func TestGenerate_RawBlockerSubjectsAndCardinality(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
		kind   string
		want   []string
	}{
		{
			name: "duplicate gate build",
			mutate: func(ev *Evidence) {
				ev.RawReceipts = append(ev.RawReceipts, slices.Clone(ev.RawReceipts[0]))
				wantAllRawReceiptsValid(t, ev.RawReceipts)
			},
			kind: kindDuplicateReceipt,
			want: []string{"gate-build"},
		},
		{
			name: "stale gate build",
			mutate: func(ev *Evidence) {
				replaceRawReceipt(t, ev, "gate-build", receiptReplacement{
					expected:    `"tree":"` + treeID + `"`,
					replacement: `"tree":"3333333333333333333333333333333333333333"`,
				})
				wantAllRawReceiptsValid(t, ev.RawReceipts)
			},
			kind: kindStaleReceipt,
			want: []string{"gate-build"},
		},
		{
			name: "failed gate integration",
			mutate: func(ev *Evidence) {
				replaceRawReceipt(t, ev, "gate-integration",
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"failure":""`, `"failure":"integration failure"`},
				)
				wantAllRawReceiptsValid(t, ev.RawReceipts)
			},
			kind: kindFailedReceipt,
			want: []string{"gate-integration"},
		},
		{
			name: "missing criterion gate sqlc",
			mutate: func(ev *Evidence) {
				missingGate("gate-sqlc")(ev)
				wantAllRawReceiptsValid(t, ev.RawReceipts)
			},
			kind: kindMissingReceipt,
			want: []string{"gate-sqlc"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			got := Generate(ev)
			wantKinds(t, got, tt.kind)
			wantKindSubjectsExactly(t, got.Blockers, tt.kind, tt.want...)
		})
	}
}

func TestGenerate_InvalidRawBlockersHaveDeterministicCardinality(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Evidence)
	}{
		{
			name: "malformed raw receipt",
			mutate: func(ev *Evidence) {
				ev.RawReceipts[0] = []byte(`{"gate":`)
			},
		},
		{
			name: "semantically invalid resealed raw receipt",
			mutate: func(ev *Evidence) {
				replaceRawReceipt(t, ev, "gate-build", receiptReplacement{
					expected:    `"status":"pass"`,
					replacement: `"status":"unknown"`,
				})
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			got := Generate(ev)
			wantKinds(t, got, kindInvalidReceipt)
			if blockers := blockersOfKind(got.Blockers, kindInvalidReceipt); len(blockers) != 1 {
				t.Fatalf("invalid-receipt blocker count = %d, want 1: %#v", len(blockers), blockers)
			}
			wantBlockersGloballySorted(t, got.Blockers)
		})
	}
}

func TestGenerate_LateRawInvalidReceiptIsEnumerated(t *testing.T) {
	ev := completeEvidence()
	ev.RawReceipts = append(ev.RawReceipts, []byte(`{"gate":`))

	got := Generate(ev)
	wantKinds(t, got, kindInvalidReceipt)
	wantKindSubjectsExactly(t, got.Blockers, kindInvalidReceipt, "raw[9]")
}

func TestGenerate_MultipleLateRawInvalidReceiptsAreEnumerated(t *testing.T) {
	ev := completeEvidence()
	ev.RawReceipts = append(ev.RawReceipts,
		[]byte(`{"gate":`),
		resealRawReceipt(t, ev.RawReceipts[0], receiptReplacement{
			expected:    `"status":"pass"`,
			replacement: `"status":"unknown"`,
		}),
	)

	got := Generate(ev)
	wantKinds(t, got, kindInvalidReceipt)
	wantKindSubjectsExactly(t, got.Blockers, kindInvalidReceipt, "raw[9]", "raw[10]")
}

func TestGenerate_MultipleDuplicateRawGatesAreEnumerated(t *testing.T) {
	ev := completeEvidence()
	ev.RawReceipts = append(ev.RawReceipts,
		slices.Clone(ev.RawReceipts[0]),
		slices.Clone(ev.RawReceipts[1]),
	)
	wantAllRawReceiptsValid(t, ev.RawReceipts)

	got := Generate(ev)
	wantKinds(t, got, kindDuplicateReceipt)
	wantKindSubjectsExactly(t, got.Blockers, kindDuplicateReceipt, "gate-build", "gate-vet")
}

func TestGenerate_AmbiguousCriterionRawGateIsExcludedFromDecisions(t *testing.T) {
	ev := completeEvidence()
	ev.RawReceipts = append(ev.RawReceipts, slices.Clone(ev.RawReceipts[7]))
	wantAllRawReceiptsValid(t, ev.RawReceipts)

	got := Generate(ev)
	if got.Decision != DecisionNoGo {
		t.Fatalf("decision = %q, want NO-GO for ambiguous gate-sqlc evidence", got.Decision)
	}
	if len(got.Blockers) != 4 {
		t.Fatalf("blocker count = %d, want exactly 4: %#v", len(got.Blockers), got.Blockers)
	}
	wantKindSubjectsExactly(t, got.Blockers, kindDuplicateReceipt, "gate-sqlc")
	wantKindSubjectsExactly(t, got.Blockers, kindMissingReceipt, "gate-sqlc")
	wantCriterionSubjectsExactly(t, got.Blockers, criterionC4, criterionC12)
	wantCriterionDetail(t, got.Blockers, criterionC4, `criterion gate "gate-sqlc" is not a passing zero-skip same-identity receipt`)
	wantBlockersGloballySorted(t, got.Blockers)
}

func TestGenerate_SemanticallyInvalidRawGateIsExcludedFromDecisions(t *testing.T) {
	ev := completeEvidence()
	if !strings.Contains(string(ev.RawReceipts[7]), `"gate":"gate-sqlc"`) {
		t.Fatalf("raw[7] is not gate-sqlc: %s", ev.RawReceipts[7])
	}
	ev.RawReceipts[7] = resealRawReceipt(t, ev.RawReceipts[7], receiptReplacement{
		expected:    `"worktree_state":"sha256:3333333333333333333333333333333333333333333333333333333333333333"`,
		replacement: `"worktree_state":"sha256:not-a-valid-worktree-hash"`,
	})
	if _, err := ValidateReceipt(ev.RawReceipts[7]); err == nil || err.Error() != "worktree_state must be sha256 plus 64 lowercase hexadecimal characters" {
		t.Fatalf("gate-sqlc validation error = %v, want semantic worktree_state error", err)
	}

	got := Generate(ev)
	if got.Decision != DecisionNoGo {
		t.Fatalf("decision = %q, want NO-GO for semantically invalid gate-sqlc evidence", got.Decision)
	}
	if len(got.Blockers) != 4 {
		t.Fatalf("blocker count = %d, want exactly 4: %#v", len(got.Blockers), got.Blockers)
	}
	wantKindSubjectsExactly(t, got.Blockers, kindInvalidReceipt, "raw[7]")
	wantKindSubjectsExactly(t, got.Blockers, kindMissingReceipt, "gate-sqlc")
	wantCriterionSubjectsExactly(t, got.Blockers, criterionC4, criterionC12)
	wantCriterionDetail(t, got.Blockers, criterionC4, `criterion gate "gate-sqlc" is not a passing zero-skip same-identity receipt`)
	wantBlockersGloballySorted(t, got.Blockers)
}

func TestGenerate_MixedRawAndExistingBlockersAreGloballySorted(t *testing.T) {
	ev := completeEvidence()
	ev.RawReceipts[0] = []byte(`{"gate":`)
	ev.RawReceipts = append(ev.RawReceipts, slices.Clone(ev.RawReceipts[1]))
	replaceRawReceipt(t, &ev, "gate-fmt", receiptReplacement{
		expected:    `"tree":"` + treeID + `"`,
		replacement: `"tree":"3333333333333333333333333333333333333333"`,
	})
	replaceRawReceipt(t, &ev, "gate-integration",
		receiptReplacement{`"status":"pass"`, `"status":"fail"`},
		receiptReplacement{`"exit_code":0`, `"exit_code":1`},
		receiptReplacement{`"failure":""`, `"failure":"integration failure"`},
	)
	missingGate("gate-sqlc")(&ev)
	for _, raw := range ev.RawReceipts[1:] {
		if _, err := ValidateReceipt(raw); err != nil {
			t.Fatalf("mixed fixture valid raw receipt: %v", err)
		}
	}
	fixtureRow(t, &ev, "Migration Executable (`cmd/migrate`)").Evidence.Path = "backend/internal/tools/closurereport/absent_test.go"
	ev.Executables = slices.DeleteFunc(ev.Executables, func(ex Executable) bool { return ex.Name == "cmd/migrate" })
	ev.Prepared.whitelistLen = 1
	ev.NonGoalFindings = []string{"backend/non-goal"}
	got := Generate(ev)
	wantKinds(t, got,
		kindInvalidReceipt,
		kindDuplicateReceipt,
		kindMissingReceipt,
		kindStaleReceipt,
		kindFailedReceipt,
		kindCriterion,
		kindNonGoal,
		kindUnresolvableAnchor,
		kindExecutable,
		kindSkipWhitelist,
	)
	wantKindSubjectsExactly(t, got.Blockers, kindDuplicateReceipt, "gate-vet")
	wantKindSubjectsExactly(t, got.Blockers, kindStaleReceipt, "gate-fmt")
	wantKindSubjectsExactly(t, got.Blockers, kindFailedReceipt, "gate-integration")
	if blockers := blockersOfKind(got.Blockers, kindMissingReceipt); !slices.ContainsFunc(blockers, func(b Blocker) bool {
		return b.Subject == "gate-sqlc"
	}) {
		t.Fatalf("missing-receipt blocker for gate-sqlc absent from %#v", blockers)
	}
	wantBlockersGloballySorted(t, got.Blockers)
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

// TestGenerate_PackageOwnedCanonicalSetMatchesRealSpecsAndManifest is the
// read-only completeness test: it loads the real canonical specs, the real
// change deltas, and the real traceability manifest, and compares them with the
// production-owned expected set exactly. The 122 titles are never duplicated
// here, and nothing under the real tree is mutated.
func TestGenerate_PackageOwnedCanonicalSetMatchesRealSpecsAndManifest(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	manifestPath := filepath.Join(root, "backend", "quality", "traceability.json")
	if _, err := os.Stat(manifestPath); err != nil {
		t.Fatalf("workspace root %q cannot be resolved from the test working directory: %v", root, err)
	}
	composed, err := archguard.ComposeEffectiveSet(
		filepath.Join(root, "openspec", "specs"),
		filepath.Join(root, "openspec", "changes", "backend-go-closure", "specs"),
	)
	if err != nil {
		t.Fatalf("compose the real effective MUST set: %v", err)
	}
	manifest, err := archguard.LoadTraceManifest(manifestPath)
	if err != nil {
		t.Fatalf("load the real traceability manifest: %v", err)
	}

	want := map[archguard.EffectiveRequirement]bool{}
	gotCounts := map[string]int{}
	for _, req := range canonicalMUSTRequirements {
		want[req] = true
		gotCounts[req.Capability]++
	}
	if len(canonicalMUSTRequirements) != 122 || len(want) != 122 {
		t.Fatalf("production expected set = %d rows / %d unique, want exactly 122 unique rows", len(canonicalMUSTRequirements), len(want))
	}
	wantCounts := map[string]int{
		"backend-runtime": 9, "industries": 3, "candidates": 8, "companies": 13,
		"identity": 12, "jobs": 32, "company-membership": 9, "applications": 30,
		"audit_events": 6,
	}
	if len(gotCounts) != len(wantCounts) {
		t.Fatalf("production expected capabilities = %v, want %v", gotCounts, wantCounts)
	}
	for capability, count := range wantCounts {
		if gotCounts[capability] != count {
			t.Fatalf("production expected distribution for %q = %d, want %d (all: %v)", capability, gotCounts[capability], count, gotCounts)
		}
	}

	composedSet := map[archguard.EffectiveRequirement]bool{}
	for _, req := range composed {
		composedSet[req] = true
	}
	if len(composedSet) != len(want) {
		t.Fatalf("real canonical+delta composition has %d unique requirements, want %d", len(composedSet), len(want))
	}
	for req := range want {
		if !composedSet[req] {
			t.Fatalf("real canonical+delta specs are missing production expected requirement (%s, %q)", req.Capability, req.Title)
		}
	}

	manifestSet := map[archguard.EffectiveRequirement]bool{}
	for _, row := range manifest.Rows {
		manifestSet[archguard.EffectiveRequirement{Capability: row.Capability, Title: row.Requirement}] = true
	}
	if len(manifest.Rows) != len(want) {
		t.Fatalf("real traceability manifest has %d rows, want %d", len(manifest.Rows), len(want))
	}
	for req := range want {
		if !manifestSet[req] {
			t.Fatalf("real traceability manifest is missing production expected requirement (%s, %q)", req.Capability, req.Title)
		}
	}
}

// TestGenerate_UnpreparedOrZeroPreparedEvidenceFailsClosed proves the opaque
// native-evidence seam fails closed: absent, zero, or structurally empty
// observed evidence can never be treated as clean.
func TestGenerate_UnpreparedOrZeroPreparedEvidenceFailsClosed(t *testing.T) {
	tests := []struct {
		name   string
		want   string
		mutate func(*Evidence)
	}{
		{
			name:   "nil prepared evidence",
			want:   kindUnpreparedEvidence,
			mutate: func(ev *Evidence) { ev.Prepared = nil },
		},
		{
			name:   "zero prepared evidence value",
			want:   kindUnpreparedEvidence,
			mutate: func(ev *Evidence) { ev.Prepared = &PreparedEvidence{} },
		},
		{
			name:   "prepared seam without observed manifest rows",
			want:   kindInvalidManifest,
			mutate: func(ev *Evidence) { ev.Prepared.manifest.Rows = nil },
		},
		{
			name:   "prepared seam without the observed effective MUST set",
			want:   kindInvalidManifest,
			mutate: func(ev *Evidence) { ev.Prepared.effective = nil },
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			wantKinds(t, Generate(ev), tt.want)
		})
	}
}

// TestGenerate_NativeCanonicalDefectsAreRejected proves C1 is decided by the
// native archguard guards over the observed manifest, not by caller rows.
func TestGenerate_NativeCanonicalDefectsAreRejected(t *testing.T) {
	tests := []struct {
		name   string
		want   string
		mutate func(*testing.T, *Evidence)
	}{
		{
			name: "duplicate canonical requirement row",
			want: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Prepared.manifest.Rows = append(ev.Prepared.manifest.Rows, ev.Prepared.manifest.Rows[0])
			},
		},
		{
			name: "duplicate owner inside one row",
			want: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "Architecture Guard").Owners = []string{fixtureEvidencePath, fixtureEvidencePath}
			},
		},
		{
			name: "row with zero evidence anchors",
			want: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "Architecture Guard").Evidence = archguard.RowEvidence{}
			},
		},
		{
			name: "canonical requirement row missing from the observed manifest",
			want: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Prepared.manifest.Rows = slices.DeleteFunc(ev.Prepared.manifest.Rows, func(row archguard.TraceabilityRow) bool {
					return row.Requirement == "JWT Middleware"
				})
			},
		},
		{
			name: "observed manifest row outside the production expected set",
			want: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Prepared.manifest.Rows = append(ev.Prepared.manifest.Rows, archguard.TraceabilityRow{
					Requirement: "Smuggled Requirement",
					Capability:  "backend-runtime",
					Tier:        TierMUST,
					Owners:      []string{fixtureEvidencePath},
					Evidence: archguard.RowEvidence{
						Path:    fixtureEvidencePath,
						Symbols: []string{"Generate"},
						Tests:   []string{fixtureEvidenceTest},
					},
				})
			},
		},
		{
			name: "unresolvable evidence path anchor",
			want: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "JWT Middleware").Evidence.Path = "backend/internal/tools/closurereport/absent_test.go"
			},
		},
		{
			name: "unresolvable identifier symbol anchor",
			want: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "JWT Middleware").Evidence.Symbols = []string{"NoSuchDeclaredSymbol"}
			},
		},
		{
			name: "test selector matching zero declared tests",
			want: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "JWT Middleware").Evidence.Tests = []string{"TestNoSuchSelector"}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(t, &ev)
			wantKinds(t, Generate(ev), tt.want)
			if got := Generate(ev).Decision; got != DecisionNoGo {
				t.Fatalf("decision = %q, want NO-GO for a native canonical defect", got)
			}
		})
	}
}

// TestGenerate_CallerNarrowedGateAndExecutableSetsAreIgnored proves the nine
// required gates and three required executables are package-owned: a caller
// cannot drop a required subject, and cannot widen eligibility with invented
// ones.
func TestGenerate_CallerNarrowedGateAndExecutableSetsAreIgnored(t *testing.T) {
	narrowed := completeEvidence()
	missingGate("gate-sqlc")(&narrowed)
	narrowed.Executables = slices.DeleteFunc(narrowed.Executables, func(ex Executable) bool {
		return ex.Name == "cmd/migrate"
	})
	narrowed.RequiredGates = []string{"gate-build"}
	narrowed.RequiredExecutables = []string{"cmd/api"}

	got := Generate(narrowed)
	wantKinds(t, got, kindMissingReceipt, kindExecutable)
	wantKindSubjectsExactly(t, got.Blockers, kindMissingReceipt, "gate-sqlc")
	wantKindSubjectsExactly(t, got.Blockers, kindExecutable, "cmd/migrate")

	widened := completeEvidence()
	widened.RequiredGates = []string{"gate-build", "gate-invented"}
	widened.RequiredExecutables = []string{"cmd/api", "cmd/invented"}

	widenedGot := Generate(widened)
	if widenedGot.Decision != DecisionNoGo {
		t.Fatalf("caller-widened sets decision = %q, want deterministic NO-GO", widenedGot.Decision)
	}
	wantBlockersExactly(t, widenedGot.Blockers, []Blocker{criterion12Blocker()})
}

// TestGenerate_LegacyManifestProjectionCannotChangeTheDecision proves the
// render-only legacy manifest projection never contributes eligibility
// blockers: nil or hostile legacy rows leave the decision byte-identical.
func TestGenerate_LegacyManifestProjectionCannotChangeTheDecision(t *testing.T) {
	want := Generate(completeEvidence())
	tests := []struct {
		name   string
		mutate func(*Evidence)
	}{
		{
			name:   "nil legacy manifest projection",
			mutate: func(ev *Evidence) { ev.Manifest = nil },
		},
		{
			name: "hostile legacy manifest projection",
			mutate: func(ev *Evidence) {
				ev.Manifest = []ManifestRow{
					{Requirement: "Migration Executable (cmd/migrate)", Capability: "backend-runtime", Tier: TierMUST},
					{Requirement: "Invented Row", Capability: "backend-runtime", Tier: TierMUST, Owner: "x", Anchor: "y"},
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(&ev)
			wantBlockersExactly(t, Generate(ev).Blockers, want.Blockers)
		})
	}
}

// TestGenerate_FixedCriterionAttribution proves every failure class maps to the
// fixed proposal §9 criteria, that criterion 12 is always present with its
// deterministic detail, and that no waiver, boolean, or caller projection can
// bypass it. The unprepared case also proves criteria 3, 10 and 11 fail closed
// when the observed skip whitelist, non-goal scan, and architecture scan are
// absent.
func TestGenerate_FixedCriterionAttribution(t *testing.T) {
	tests := []struct {
		name   string
		want   []string
		kind   string
		mutate func(*testing.T, *Evidence)
	}{
		{name: "clean fixture is blocked only by criterion 12", want: []string{criterionC12}},
		{name: "missing build gate maps to criterion 2", want: []string{criterionC2, criterionC12}, kind: kindMissingReceipt,
			mutate: func(t *testing.T, ev *Evidence) { missingGate("gate-build")(ev) }},
		{name: "invalid build receipt maps to criterion 2", want: []string{criterionC2, criterionC12}, kind: kindInvalidReceipt,
			mutate: func(t *testing.T, ev *Evidence) { ev.RawReceipts[0] = []byte(`{"gate":`) }},
		{name: "failed integration gate maps to criterion 3", want: []string{criterionC3, criterionC12}, kind: kindFailedReceipt,
			mutate: func(t *testing.T, ev *Evidence) {
				replaceRawReceipt(t, ev, "gate-integration",
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"failure":""`, `"failure":"integration failure"`},
				)
			}},
		{name: "observed non-zero native skip whitelist maps to criterion 3", want: []string{criterionC3, criterionC12}, kind: kindSkipWhitelist,
			mutate: func(t *testing.T, ev *Evidence) { ev.Prepared.whitelistLen = 1 }},
		{name: "observed negative native skip whitelist length maps to criterion 3", want: []string{criterionC3, criterionC12}, kind: kindSkipWhitelist,
			mutate: func(t *testing.T, ev *Evidence) { ev.Prepared.whitelistLen = -1 }},
		{name: "missing sqlc gate maps to criterion 4", want: []string{criterionC4, criterionC12}, kind: kindMissingReceipt,
			mutate: func(t *testing.T, ev *Evidence) { missingGate("gate-sqlc")(ev) }},
		{name: "missing postconfirmation executable maps to criterion 5", want: []string{criterionC5, criterionC12}, kind: kindExecutable,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Executables = slices.DeleteFunc(ev.Executables, func(ex Executable) bool { return ex.Name == "cmd/postconfirmation" })
			}},
		{name: "duplicate runtime boundary executable evidence maps to criterion 5", want: []string{criterionC5, criterionC12}, kind: kindExecutable,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Executables = append(ev.Executables, Executable{Name: "cmd/api", RuntimeBoundaryTests: true})
			}},
		{name: "contradictory runtime boundary executable evidence maps to criterion 5", want: []string{criterionC5, criterionC12}, kind: kindExecutable,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Executables = append(ev.Executables, Executable{Name: "cmd/api", RuntimeBoundaryTests: false})
			}},
		{name: "missing identity row maps to criteria 1 and 6", want: []string{criterionC1, criterionC6, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { deleteFixtureRow(ev, "JWT Middleware") }},
		{name: "missing backend-runtime row maps to criteria 1 and 7", want: []string{criterionC1, criterionC7, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { deleteFixtureRow(ev, "Architecture Guard") }},
		{name: "missing candidates row maps to criteria 1 and 8", want: []string{criterionC1, criterionC8, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { deleteFixtureRow(ev, "Profile Lifecycle") }},
		{name: "missing catalog row maps to criteria 1, 7 and 8", want: []string{criterionC1, criterionC7, criterionC8, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { deleteFixtureRow(ev, errorCodeCatalogTitle) }},
		{name: "atomic row owned by unrelated SQL maps to criterion 9", want: []string{criterionC9, criterionC12},
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, atomicIndustryGateTitle).Owners = []string{"backend/db/queries/jobs.sql"}
			}},
		{name: "unobserved atomic SQL symbol maps to criterion 9", want: []string{criterionC9, criterionC12},
			mutate: func(t *testing.T, ev *Evidence) { ev.Prepared.sqlSymbols = nil }},
		{name: "observed non-goal violation maps to criterion 10", want: []string{criterionC10, criterionC12}, kind: kindNonGoal,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Prepared.nonGoal = []archguard.Violation{{Rule: "locked-non-goal-path", File: "backend/Dockerfile", Detail: "locked non-goal path"}}
			}},
		{name: "legacy non-goal finding maps to criterion 10", want: []string{criterionC10, criterionC12}, kind: kindNonGoal,
			mutate: func(t *testing.T, ev *Evidence) { ev.NonGoalFindings = []string{"backend/Dockerfile"} }},
		{name: "observed architecture violation maps to criterion 11", want: []string{criterionC11, criterionC12}, kind: kindArchitecture,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Prepared.architecture = []archguard.Violation{{Rule: "cross-feature-infrastructure-import", File: "internal/features/jobs/infrastructure/postgres", Detail: "cross-feature infrastructure import"}}
			}},
		{name: "missing architecture gate receipt maps to criterion 11", want: []string{criterionC11, criterionC12}, kind: kindMissingReceipt,
			mutate: func(t *testing.T, ev *Evidence) { missingGate("gate-arch")(ev) }},
		{name: "unprepared observed seam fails criteria 1 and 3 to 12 closed", kind: kindUnpreparedEvidence,
			want:   []string{criterionC1, criterionC3, criterionC6, criterionC7, criterionC8, criterionC9, criterionC10, criterionC11, criterionC12},
			mutate: func(t *testing.T, ev *Evidence) { ev.Prepared = nil }},
		{name: "waivers and size exceptions cannot bypass criterion 12", want: []string{criterionC12},
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Waivers = []Waiver{{Kind: "waiver", Description: "criterion 12 waived"}, {Kind: "size:exception", Description: "docs deferred"}}
			}},
		{name: "hostile legacy projections cannot bypass criterion 12", want: []string{criterionC12},
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Criteria = []Criterion{{ID: criterionC12, RequiredGates: []string{"gate-invented"}}, {ID: "criterion-99-invented"}}
				ev.Manifest = nil
				ev.Receipts = nil
				ev.RequiredGates = nil
				ev.RequiredExecutables = nil
			}},
		{name: "explicitly observed empty non-goal and architecture scans pass", want: []string{criterionC12}},
		{name: "unobserved non-goal scan fails only criterion 10", want: []string{criterionC10, criterionC12},
			mutate: func(t *testing.T, ev *Evidence) { ev.Prepared.nonGoalObserved = false }},
		{name: "unobserved architecture scan fails only criterion 11", want: []string{criterionC11, criterionC12},
			mutate: func(t *testing.T, ev *Evidence) { ev.Prepared.architectureObserved = false }},
		{name: "unobserved non-goal scan with violations fails criterion 10", want: []string{criterionC10, criterionC12}, kind: kindNonGoal,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Prepared.nonGoalObserved = false
				ev.Prepared.nonGoal = []archguard.Violation{{Rule: "locked-non-goal-path", File: "backend/Dockerfile", Detail: "locked non-goal path"}}
			}},
		{name: "present-but-invalid identity row fails criteria 1 and 6", want: []string{criterionC1, criterionC6, criterionC12}, kind: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "JWT Middleware").Evidence.Path = fixtureAbsentPath
			}},
		{name: "present-but-invalid backend-runtime row fails criteria 1 and 7", want: []string{criterionC1, criterionC7, criterionC12}, kind: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "Architecture Guard").Evidence.Path = fixtureAbsentPath
			}},
		{name: "present-but-invalid candidates row fails criteria 1 and 8", want: []string{criterionC1, criterionC8, criterionC12}, kind: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "Profile Lifecycle").Evidence.Path = fixtureAbsentPath
			}},
		{name: "present-but-invalid catalog row fails criteria 1, 7 and 8", want: []string{criterionC1, criterionC7, criterionC8, criterionC12}, kind: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, errorCodeCatalogTitle).Evidence.Path = fixtureAbsentPath
			}},
		{name: "present-but-invalid atomic row fails criteria 1, 8 and 9", want: []string{criterionC1, criterionC8, criterionC9, criterionC12}, kind: kindUnresolvableAnchor,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, atomicIndustryGateTitle).Evidence.Path = fixtureAbsentPath
			}},
		{name: "two distinct atomic owners including the exact SQL owner pass", want: []string{criterionC12},
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, atomicIndustryGateTitle).Owners = []string{fixtureAtomicBootstrapOwner, fixtureSQLOwner}
			}},
		{name: "missing SQL owner among atomic owners fails criterion 9", want: []string{criterionC9, criterionC12},
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, atomicIndustryGateTitle).Owners = []string{fixtureAtomicBootstrapOwner, "backend/db/queries/jobs.sql"}
			}},
		{name: "duplicate observed effective requirement fails criterion 1", want: []string{criterionC1, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Prepared.effective = append(slices.Clone(ev.Prepared.effective), ev.Prepared.effective[0])
			}},
		{name: "duplicate owner path on an identity row fails criteria 1 and 6", want: []string{criterionC1, criterionC6, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "JWT Middleware").Owners = []string{fixtureEvidencePath, fixtureEvidencePath}
			}},
		{name: "duplicate backend-runtime row fails criteria 1 and 7", want: []string{criterionC1, criterionC7, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { duplicateFixtureRow(t, ev, "Architecture Guard") }},
		{name: "duplicate companies row fails criteria 1 and 8", want: []string{criterionC1, criterionC8, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { duplicateFixtureRow(t, ev, "Public Company Read Endpoint") }},
		{name: "duplicate candidates row fails criteria 1 and 8", want: []string{criterionC1, criterionC8, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { duplicateFixtureRow(t, ev, "Profile Lifecycle") }},
		{name: "duplicate industries row fails criteria 1 and 8", want: []string{criterionC1, criterionC8, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { duplicateFixtureRow(t, ev, "Single Canonical Route Registration") }},
		{name: "duplicate catalog row fails criteria 1, 7 and 8", want: []string{criterionC1, criterionC7, criterionC8, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { duplicateFixtureRow(t, ev, errorCodeCatalogTitle) }},
		{name: "duplicate atomic row fails criteria 1, 8 and 9", want: []string{criterionC1, criterionC8, criterionC9, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { duplicateFixtureRow(t, ev, atomicIndustryGateTitle) }},
		{name: "identity row no longer tier MUST fails criteria 1 and 6", want: []string{criterionC1, criterionC6, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { fixtureRow(t, ev, "JWT Middleware").Tier = "SHOULD" }},
		{name: "backend-runtime row no longer tier MUST fails criteria 1 and 7", want: []string{criterionC1, criterionC7, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { fixtureRow(t, ev, "Architecture Guard").Tier = "SHOULD" }},
		{name: "candidates row no longer tier MUST fails criteria 1 and 8", want: []string{criterionC1, criterionC8, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { fixtureRow(t, ev, "Profile Lifecycle").Tier = "SHOULD" }},
		{name: "catalog row no longer tier MUST fails criteria 1, 7 and 8", want: []string{criterionC1, criterionC7, criterionC8, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { fixtureRow(t, ev, errorCodeCatalogTitle).Tier = "SHOULD" }},
		{name: "atomic row no longer tier MUST fails criteria 1, 8 and 9", want: []string{criterionC1, criterionC8, criterionC9, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { fixtureRow(t, ev, atomicIndustryGateTitle).Tier = "SHOULD" }},
		{name: "jobs canonical row no longer tier MUST still fails criterion 1", want: []string{criterionC1, criterionC12}, kind: kindInvalidManifest,
			mutate: func(t *testing.T, ev *Evidence) { fixtureRow(t, ev, "Full-Text Search").Tier = "SHOULD" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			if tt.mutate != nil {
				tt.mutate(t, &ev)
			}
			got := Generate(ev)
			if got.Decision != DecisionNoGo {
				t.Fatalf("decision = %q, want NO-GO", got.Decision)
			}
			wantCriterionSubjectsExactly(t, got.Blockers, tt.want...)
			wantCriterionDetail(t, got.Blockers, criterionC12, criterion12Detail)
			if tt.kind != "" {
				wantKinds(t, got, tt.kind)
			}
		})
	}
}

// TestGenerate_CriterionRowSetsAreExactlyTheContract pins the fixed row sets:
// criterion 6 all 12 identity rows, criterion 7 all 9 backend-runtime rows, and
// criterion 8 exactly 25 rows (13 companies + 8 candidates + 3 industries plus
// the stable error-code catalog row, which maps to criteria 7 and 8).
func TestGenerate_CriterionRowSetsAreExactlyTheContract(t *testing.T) {
	rows := criterionRowRequirements()
	for criterion, want := range map[string]int{criterionC6: 12, criterionC7: 9, criterionC8: 25} {
		if got := len(rows[criterion]); got != want {
			t.Fatalf("criterion %q row set = %d rows, want exactly %d", criterion, got, want)
		}
	}
	counts := map[string]int{}
	for _, req := range rows[criterionC8] {
		counts[req.Capability]++
	}
	wantCounts := map[string]int{"companies": 13, "candidates": 8, "industries": 3, "backend-runtime": 1}
	if len(counts) != len(wantCounts) {
		t.Fatalf("criterion 8 capability distribution = %v, want %v", counts, wantCounts)
	}
	for capability, count := range wantCounts {
		if counts[capability] != count {
			t.Fatalf("criterion 8 capability %q = %d rows, want %d", capability, counts[capability], count)
		}
	}
	catalog := archguard.EffectiveRequirement{Capability: "backend-runtime", Title: errorCodeCatalogTitle}
	if !slices.Contains(rows[criterionC7], catalog) || !slices.Contains(rows[criterionC8], catalog) {
		t.Fatalf("the stable error-code catalog row must map to criteria 7 and 8")
	}
}

// TestGenerate_DocsObservationDrivesCriterion12 pins the criterion 12 contract
// (proposal §9.12 / Task 8.1): the fixed explanatory-docs observation decides the
// criterion. Unobserved documents keep the deterministic blocker, observed
// findings become one structured docs-contradiction blocker each plus their own
// criterion 12 attribution (never duplicated), and observed clean documents
// remove criterion 12 entirely.
func TestGenerate_DocsObservationDrivesCriterion12(t *testing.T) {
	t.Run("unobserved documents keep the deterministic criterion 12 blocker", func(t *testing.T) {
		report := Generate(completeEvidence())
		wantBlockersExactly(t, report.Blockers, []Blocker{criterion12Blocker()})
	})

	t.Run("observed clean documents remove criterion 12 and allow GO", func(t *testing.T) {
		ev := completeEvidence()
		ev.Prepared.docsObserved = true
		report := Generate(ev)
		if report.Decision != DecisionGo {
			t.Fatalf("decision = %q, want GO (blockers: %#v)", report.Decision, report.Blockers)
		}
		if len(report.Blockers) != 0 {
			t.Fatalf("observed clean docs fixture blockers = %#v, want none", report.Blockers)
		}
	})

	t.Run("observed findings become one blocker each plus criterion 12 attribution", func(t *testing.T) {
		ev := completeEvidence()
		ev.Prepared.docsObserved = true
		ev.Prepared.docsFindings = []DocFinding{
			{Rule: "docs-roadmap-healthz-db", Path: "docs/ROADMAP.md", Line: 17, Detail: `stale literal "(pinguea DB)" remains`},
			{Rule: "docs-readme-table-count", Path: "README.md", Line: 21, Detail: `stale literal "Postgres (9 tablas)" remains`},
		}
		report := Generate(ev)
		if report.Decision != DecisionNoGo {
			t.Fatalf("decision = %q, want NO-GO", report.Decision)
		}
		wantBlockersExactly(t, report.Blockers, []Blocker{
			{Kind: kindCriterion, Subject: criterionC12,
				Detail: `line 17 rule docs-roadmap-healthz-db: stale literal "(pinguea DB)" remains`},
			{Kind: kindCriterion, Subject: criterionC12,
				Detail: `line 21 rule docs-readme-table-count: stale literal "Postgres (9 tablas)" remains`},
			{Kind: KindDocsContradiction, Subject: "README.md",
				Detail: `line 21 rule docs-readme-table-count: stale literal "Postgres (9 tablas)" remains`},
			{Kind: KindDocsContradiction, Subject: "docs/ROADMAP.md",
				Detail: `line 17 rule docs-roadmap-healthz-db: stale literal "(pinguea DB)" remains`},
		})
		wantBlockersGloballySorted(t, report.Blockers)
	})

	t.Run("a repeated finding is attributed once", func(t *testing.T) {
		ev := completeEvidence()
		ev.Prepared.docsObserved = true
		finding := DocFinding{Rule: "docs-readme-table-count", Path: "README.md", Line: 21,
			Detail: `stale literal "Postgres (9 tablas)" remains`}
		ev.Prepared.docsFindings = []DocFinding{finding, finding}
		report := Generate(ev)
		wantBlockersExactly(t, report.Blockers, []Blocker{
			{Kind: kindCriterion, Subject: criterionC12,
				Detail: `line 21 rule docs-readme-table-count: stale literal "Postgres (9 tablas)" remains`},
			{Kind: KindDocsContradiction, Subject: "README.md",
				Detail: `line 21 rule docs-readme-table-count: stale literal "Postgres (9 tablas)" remains`},
		})
	})
}

// TestGenerate_DocsFindingsDedupeOnExactFindingIdentity triangulates the
// criterion 12 dedupe boundary: only an exact duplicate finding collapses. Two
// findings that render the same detail while anchoring to different documents
// are distinct observations, so each keeps its own docs-contradiction blocker
// while the shared cause stays one criterion 12 attribution.
func TestGenerate_DocsFindingsDedupeOnExactFindingIdentity(t *testing.T) {
	ev := completeEvidence()
	ev.Prepared.docsObserved = true
	detail := `forbidden literal "CREATE TABLE invitations"`
	ev.Prepared.docsFindings = []DocFinding{
		{Rule: "docs-invitations-ddl", Path: "README.md", Line: 30, Detail: detail},
		{Rule: "docs-invitations-ddl", Path: "docs/ROADMAP.md", Line: 30, Detail: detail},
	}

	report := Generate(ev)
	wantBlockersExactly(t, report.Blockers, []Blocker{
		{Kind: kindCriterion, Subject: criterionC12,
			Detail: `line 30 rule docs-invitations-ddl: ` + detail},
		{Kind: KindDocsContradiction, Subject: "README.md",
			Detail: `line 30 rule docs-invitations-ddl: ` + detail},
		{Kind: KindDocsContradiction, Subject: "docs/ROADMAP.md",
			Detail: `line 30 rule docs-invitations-ddl: ` + detail},
	})
	wantBlockersGloballySorted(t, report.Blockers)
}
