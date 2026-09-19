// BC-06B/BC-06C: the fixed-path production loader and the fixture-only
// load -> Generate -> WriteArtifacts determinism proof.
//
// Every fixture lives in its own temporary repository root, including its own
// disposable Git repository, so the real backend tree, the real receipts, and
// the real docs/ root are never read for decisions and never written.
package closurereport

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/archguard"
)

const (
	loaderFixtureChange      = "backend-go-closure"
	loaderFixtureManifestRel = "backend/quality/traceability.json"
	loaderFixtureReceiptsRel = "backend/quality/receipts"

	// loaderFixtureSkipWhitelistRel is the fixed package-owned canonical skip
	// whitelist path every complete fixture must ship.
	loaderFixtureSkipWhitelistRel = "backend/quality/skip-whitelist.json"

	// loaderFixtureSkipWhitelist is the exact canonical skip-whitelist document
	// the real repository ships, including the ordinary final newline.
	loaderFixtureSkipWhitelist = `{"schema":"peopleflow.skip-whitelist/v1","entries":[]}` + "\n"
	loaderFixtureFeatureRel    = "backend/internal/features/jobs/infrastructure/http/handler.go"
	loaderFixtureFeatureTest   = "backend/internal/features/jobs/infrastructure/http/handler_test.go"
	loaderFixtureAtomicRel     = "backend/internal/features/companies/infrastructure/postgres/activeIndustryGate_integration_test.go"
	loaderFixtureBootstrap     = "backend/internal/features/companies/infrastructure/postgres/companyBootstrapRepository.go"

	// loaderUnresolvedPhrase is the exact unresolved prose phrase the canonical
	// manifest declares for the atomic active-industry gate. The loader must carry
	// it verbatim: no normalization, no rewrite, no silent skip.
	loaderUnresolvedPhrase = "locking CTE on industries"
	loaderSecondSymbol     = "409 industry_unavailable"

	loaderFixtureSymbol   = "ListJobs"
	loaderFixtureTestName = "TestListJobs"
)

// loaderFixtureHandlerSource is clean feature source: it carries neither an
// ad-hoc `code` literal nor a direct error-JSON write, and no locked non-goal
// path segment, so both native scans stay observed-clean.
const loaderFixtureHandlerSource = `package http

// ListJobs is clean feature source: no ad-hoc code literal and no direct
// error-JSON write.
func ListJobs() {}
`

const loaderFixtureFeatureTestSource = `package http

import "testing"

func TestListJobs(t *testing.T) {}
`

// loaderFixtureGoMod makes the fixture root a self-contained Go module so the
// native repository import scan can resolve its package graph offline.
const loaderFixtureGoMod = "module fixture\n\ngo 1.21\n"

// loaderFixtureBootstrapSource is the non-test source of the canonical
// implementation-path owner of the atomic active-industry gate, so the fixture
// postgres package is loadable and the row owner path is real-shaped.
const loaderFixtureBootstrapSource = `package postgres

// CompanyBootstrapRepository is the fixture placeholder for the canonical
// implementation-path owner of the atomic active-industry gate.
type CompanyBootstrapRepository struct{}
`

// loaderFixtureAtomicTestSource declares the canonical manifest row's test
// selectors so the real-shaped fixture row resolves everything except its
// unresolved prose phrase.
const loaderFixtureAtomicTestSource = `package postgres

import "testing"

func TestActiveIndustryGate_CreateFirst(t *testing.T) {}

func TestActiveIndustryGate_DeactivateFirst(t *testing.T) {}

func TestCompanyBootstrapRepository_CreateWithOwnerRejectsUnavailableIndustry(t *testing.T) {}
`

// loaderFixtureSQL is the canonical sqlc query file fixture: one exact
// declaration per query, plus decoys a substring, non-declaration, or
// unsupported-kind match would wrongly accept (a longer name sharing the
// CreateCompany prefix, a `--name:` mention without the required space, a prose
// mention, and a declaration carrying an unsupported query kind).
const loaderFixtureSQL = `-- name: CreateCompany :one
WITH active_industry AS MATERIALIZED (
    SELECT id FROM industries WHERE id = $4 AND active = true FOR UPDATE
)
SELECT 1;

-- CreateCompany is mentioned in prose here and is never a declaration.
--name: CreateCompanyNoSpace :one
-- name: CreateCompanyArchive :one
SELECT 2;

-- name: GetCompanyByID :one
SELECT * FROM companies;

-- name: ListCompanies :many
SELECT id FROM companies;

-- An unsupported sqlc query kind is not an authoritative declaration.
-- name: CreateCompanyBatch :bogus
SELECT 3;
`

// loaderFixtureKindProbeSQL probes the supported sqlc query-kind allow-list: one
// declaration per allow-listed kind, plus unsupported, uppercase, and
// missing-kind decoys.
const loaderFixtureKindProbeSQL = `-- name: SupportedOne :one
SELECT 1;

-- name: SupportedMany :many
SELECT 2;

-- name: SupportedExec :exec
SELECT 3;

-- name: SupportedExecRows :execrows
SELECT 4;

-- name: SupportedExecResult :execresult
SELECT 5;

-- name: SupportedExecLastID :execlastid
SELECT 6;

-- name: SupportedCopyFrom :copyfrom
SELECT 7;

-- name: SupportedBatchExec :batchexec
SELECT 8;

-- name: SupportedBatchMany :batchmany
SELECT 9;

-- name: SupportedBatchOne :batchone
SELECT 10;

-- name: RejectedBogus :bogus
SELECT 11;

-- name: RejectedUpper :ONE
SELECT 12;

-- name: RejectedEmpty :
SELECT 13;
`

// loaderFixtureSplitLineSQL carries both line-crossing forms a permissive
// whitespace class would wrongly join into a declaration: a name wrapped onto
// the line after `-- name:`, and a kind wrapped onto the line after the name.
// sqlc declarations are single-line, so neither may become authoritative.
const loaderFixtureSplitLineSQL = `-- name:
CreateCompany :one

-- name: SplitKind
:one
`

// loaderRenamedSQL renames the atomic gate query: the file is readable, but the
// canonical symbol is gone.
const loaderRenamedSQL = `-- name: CreateCompanyArchive :one
SELECT 1;

-- The exact declaration prefix is required: this mention is not a declaration.
--name: CreateCompany :one
SELECT 2;
`

// loaderResolvedPhraseSource carries the canonical prose phrases verbatim so
// the atomic active-industry row is fully valid anchor evidence.
const loaderResolvedPhraseSource = `package postgres

// CreateWithOwner serializes creation on a locking CTE on industries and maps
// a vanished industry to a 409 industry_unavailable response.
func CreateWithOwner() {}
`

// loaderFixture is one temporary repository root shaped like the real
// repository, with its own Git identity.
type loaderFixture struct {
	root   string
	treeID string
}

// loaderFixtureOption mutates a built fixture root before it is observed.
type loaderFixtureOption func(t *testing.T, root string)

// resolveLoaderAtomicPhrase makes the fixture tree contain the canonical prose
// phrases verbatim, which drives criterion 9 past the row-validity branch to
// its SQL-symbol branch.
func resolveLoaderAtomicPhrase(t *testing.T, root string) {
	t.Helper()
	writeLoaderFixtureFile(t, root, "backend/internal/features/companies/infrastructure/postgres/activeIndustryGate.go", loaderResolvedPhraseSource)
}

func writeLoaderFixtureFile(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeLoaderSkipWhitelist writes one skip-whitelist document into a fixture root
// at the fixed canonical path, so a failure-class case can replace the canonical
// content without touching any other fixed input.
func writeLoaderSkipWhitelist(t *testing.T, root, content string) {
	t.Helper()
	writeLoaderFixtureFile(t, root, loaderFixtureSkipWhitelistRel, content)
}

// removeLoaderFixturePath deletes one path inside a temporary fixture root.
func removeLoaderFixturePath(t *testing.T, root, rel string) {
	t.Helper()
	if err := os.RemoveAll(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
		t.Fatal(err)
	}
}

// dirAtLoaderFixturePath replaces one fixture path with a directory, so reading
// it is an I/O error rather than a missing file.
func dirAtLoaderFixturePath(t *testing.T, root, rel string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	removeLoaderFixturePath(t, root, rel)
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
}

// loaderFixtureManifest builds the fixture manifest from the package-owned
// canonical MUST set, so coverage and the effective set match exactly. The
// atomic active-industry row keeps the canonical real shape: the plural
// implementation-path owners and the exact unresolved prose phrase.
func loaderFixtureManifest() archguard.TraceManifest {
	rows := make([]archguard.TraceabilityRow, 0, len(canonicalMUSTRequirements))
	for _, req := range canonicalMUSTRequirements {
		row := archguard.TraceabilityRow{
			Requirement: req.Title,
			Capability:  req.Capability,
			Tier:        TierMUST,
			Owners:      []string{loaderFixtureFeatureRel},
			Evidence: archguard.RowEvidence{
				Path:    loaderFixtureFeatureRel,
				Symbols: []string{loaderFixtureSymbol},
				Tests:   []string{loaderFixtureTestName},
			},
		}
		if req.Capability == "companies" && req.Title == atomicIndustryGateTitle {
			row.Owners = []string{atomicIndustrySQLOwner, loaderFixtureBootstrap}
			row.Evidence = archguard.RowEvidence{
				Path:    loaderFixtureAtomicRel,
				Symbols: []string{loaderUnresolvedPhrase, loaderSecondSymbol},
				Tests: []string{
					"TestActiveIndustryGate_CreateFirst",
					"TestActiveIndustryGate_DeactivateFirst",
					"TestCompanyBootstrapRepository_CreateWithOwnerRejectsUnavailableIndustry",
				},
			}
		}
		rows = append(rows, row)
	}
	return archguard.TraceManifest{Schema: "peopleflow.traceability/v1", Change: loaderFixtureChange, Rows: rows}
}

// writeLoaderOpenspecFixture writes one canonical spec per capability so the
// composed effective MUST set is exactly the package-owned canonical set, plus
// an empty delta directory for the fixture change.
func writeLoaderOpenspecFixture(t *testing.T, root, change string) {
	t.Helper()
	byCapability := map[string][]string{}
	for _, req := range canonicalMUSTRequirements {
		byCapability[req.Capability] = append(byCapability[req.Capability], req.Title)
	}
	for capability, titles := range byCapability {
		var b strings.Builder
		for _, title := range titles {
			b.WriteString("### Requirement: " + title + "\n")
		}
		writeLoaderFixtureFile(t, root, filepath.Join("openspec", "specs", capability, "spec.md"), b.String())
	}
	if err := os.MkdirAll(filepath.Join(root, "openspec", "changes", change, "specs"), 0o755); err != nil {
		t.Fatal(err)
	}
}

// initLoaderGitRepo gives the fixture root its own disposable Git repository so
// the loader derives a real tree identity. Every command is scoped to the
// temporary fixture root; the real repository is never mutated.
func initLoaderGitRepo(t *testing.T, root string) {
	t.Helper()
	for _, args := range [][]string{
		{"init", "--initial-branch=main", root},
		{"-C", root, "config", "user.email", "fixture@example.com"},
		{"-C", root, "config", "user.name", "fixture"},
		{"-C", root, "config", "commit.gpgsign", "false"},
		{"-C", root, "add", "-A"},
		{"-C", root, "commit", "-m", "fixture baseline"},
	} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
		}
	}
}

// loaderGitTree is the independent oracle for the fixture repository's current
// tree identity.
func loaderGitTree(t *testing.T, root string) string {
	t.Helper()
	out, err := exec.Command("git", "-C", root, "rev-parse", "--verify", "HEAD^{tree}").Output()
	if err != nil {
		t.Fatalf("git rev-parse HEAD^{tree}: %v", err)
	}
	return strings.TrimSpace(string(out))
}

func loaderWorktreeStateOracle(t *testing.T, root string) string {
	t.Helper()
	const script = `cd "$(git rev-parse --show-toplevel)" && { git status --porcelain --untracked-files=all; git diff HEAD
git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do printf '%s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f"; done
} 2>/dev/null | sha256sum | cut -d' ' -f1` // gate producer's root-based pipeline, byte-parity oracle
	cmd := exec.Command("bash") // fixed constant pipeline on stdin; root bound via Dir, never interpolated
	cmd.Stdin, cmd.Dir = strings.NewReader(script), root
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("producer worktree state oracle: %v", err)
	}
	return "sha256:" + strings.TrimSpace(string(out))
}

// newLoaderFixture builds a complete temporary repository-shaped fixture. Only
// two of the nine required receipts exist on purpose, so Generate must emit its
// fixed missing-receipt blockers for the rest.
func newLoaderFixture(t *testing.T, options ...loaderFixtureOption) loaderFixture {
	t.Helper()
	root := t.TempDir()
	manifest := loaderFixtureManifest()
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	writeLoaderFixtureFile(t, root, loaderFixtureManifestRel, string(encoded))
	writeLoaderOpenspecFixture(t, root, manifest.Change)
	writeLoaderFixtureFile(t, root, atomicIndustrySQLOwner, loaderFixtureSQL)
	writeLoaderFixtureFile(t, root, loaderFixtureAtomicRel, loaderFixtureAtomicTestSource)
	writeLoaderFixtureFile(t, root, loaderFixtureBootstrap, loaderFixtureBootstrapSource)
	writeLoaderFixtureFile(t, root, loaderFixtureFeatureRel, loaderFixtureHandlerSource)
	writeLoaderFixtureFile(t, root, loaderFixtureFeatureTest, loaderFixtureFeatureTestSource)
	writeLoaderFixtureFile(t, root, "backend/go.mod", loaderFixtureGoMod)
	writeLoaderFixtureFile(t, root, loaderFixtureGitIgnoreRel, loaderFixtureGitIgnore)
	writeLoaderSkipWhitelist(t, root, loaderFixtureSkipWhitelist)
	for path, body := range cleanDocs() {
		writeLoaderFixtureFile(t, root, string(path), body)
	}
	for _, gate := range []string{"gate-arch", "gate-build"} {
		raw := sealedRawReceiptForGate(gate)
		if raw == nil {
			t.Fatalf("sealing fixture receipt %s failed", gate)
		}
		writeLoaderFixtureFile(t, root, filepath.Join(loaderFixtureReceiptsRel, gate+".json"), string(raw))
	}
	initLoaderGitRepo(t, root)

	fixture := loaderFixture{root: root, treeID: loaderGitTree(t, root)}
	for _, option := range options {
		option(t, root)
	}
	return fixture
}

// loadLoaderFixture observes one fixture root and fails on the deficient
// scaffold instead of panicking on nil prepared evidence.
func loadLoaderFixture(t *testing.T, root string) Evidence {
	t.Helper()
	ev, err := LoadEvidence(root)
	if err != nil {
		t.Fatalf("LoadEvidence(%s): %v", root, err)
	}
	if ev.Prepared == nil {
		t.Fatal("LoadEvidence returned nil PreparedEvidence: the observed native seam must be constructed")
	}
	if !ev.Prepared.loaded {
		t.Fatal("LoadEvidence left loaded=false after every real derivation completed")
	}
	return ev
}

// TestLoadEvidence_ObservedFixtureSeam proves the loader constructs the opaque
// observed seam from the fixed real-tree inputs: composed manifest and
// effective set, anchor index, both native scans, the exact sqlc declarations,
// the Git-derived tree identity, and the byte-exact receipts in deterministic
// required-gate order.
func TestLoadEvidence_ObservedFixtureSeam(t *testing.T) {
	fixture := newLoaderFixture(t)
	ev := loadLoaderFixture(t, fixture.root)

	if !ev.Prepared.nonGoalObserved || !ev.Prepared.architectureObserved {
		t.Fatalf("independent scan observation states must both be set: nonGoal=%t architecture=%t",
			ev.Prepared.nonGoalObserved, ev.Prepared.architectureObserved)
	}
	if ev.Prepared.manifest.Change != loaderFixtureChange {
		t.Fatalf("observed manifest change = %q, want %q", ev.Prepared.manifest.Change, loaderFixtureChange)
	}
	if drift := effectiveDrift(ev.Prepared.effective); len(drift) != 0 {
		t.Fatalf("effective MUST set must match the package-owned canonical set exactly; drift: %+v", drift)
	}
	if ev.TreeIdentity != fixture.treeID {
		t.Fatalf("TreeIdentity = %q, want the Git-derived fixture tree %q", ev.TreeIdentity, fixture.treeID)
	}
	if ev.TreeIdentity == treeID {
		t.Fatal("TreeIdentity must be derived from Git, never a caller-supplied constant")
	}
	for _, symbol := range []string{atomicIndustrySQLSymbol, "CreateCompanyArchive", "GetCompanyByID", "ListCompanies"} {
		if !slices.Contains(ev.Prepared.sqlSymbols, symbol) {
			t.Fatalf("sqlSymbols %q must carry the exact declaration %q", ev.Prepared.sqlSymbols, symbol)
		}
	}
	if slices.Contains(ev.Prepared.sqlSymbols, "CreateCompanyNoSpace") {
		t.Fatalf("a `--name:` mention without the exact sqlc prefix is not a declaration: %q", ev.Prepared.sqlSymbols)
	}
	if slices.Contains(ev.Prepared.sqlSymbols, "CreateCompanyBatch") {
		t.Fatalf("an unsupported sqlc query kind is not an authoritative declaration: %q", ev.Prepared.sqlSymbols)
	}

	if len(ev.RawReceipts) != 2 {
		t.Fatalf("RawReceipts = %d entries, want the 2 existing receipts (absent receipts are omitted, not synthesized)", len(ev.RawReceipts))
	}
	for index, gate := range []string{"gate-build", "gate-arch"} {
		onDisk, err := os.ReadFile(filepath.Join(fixture.root, filepath.FromSlash(loaderFixtureReceiptsRel), gate+".json"))
		if err != nil {
			t.Fatalf("reading fixture receipt %s: %v", gate, err)
		}
		if !bytes.Equal(ev.RawReceipts[index], onDisk) {
			t.Fatalf("RawReceipts[%d] must be the byte-exact %s file content:\n got: %s\nwant: %s",
				index, gate, ev.RawReceipts[index], onDisk)
		}
	}
}

// TestLoadEvidence_RealShapedAnchorMismatchReachesC1AndC9 proves the exact
// unresolved canonical phrase survives the loader verbatim, is named by the
// native anchor check, and reaches the unresolvable-anchor blocker plus the
// dependent criterion 1 and criterion 9 blockers instead of being normalized,
// panicking, or skipped.
func TestLoadEvidence_RealShapedAnchorMismatchReachesC1AndC9(t *testing.T) {
	fixture := newLoaderFixture(t)
	ev := loadLoaderFixture(t, fixture.root)

	row := fixtureRow(t, &ev, atomicIndustryGateTitle)
	if !slices.Equal(row.Evidence.Symbols, []string{loaderUnresolvedPhrase, loaderSecondSymbol}) {
		t.Fatalf("observed row symbols were normalized or rewritten: got %q, want %q",
			row.Evidence.Symbols, []string{loaderUnresolvedPhrase, loaderSecondSymbol})
	}

	var named bool
	for _, violation := range archguard.CheckManifestAnchors(ev.Prepared.manifest.Rows, ev.Prepared.index) {
		if violation.Rule == "traceability-unresolvable-symbol" && strings.Contains(violation.Detail, loaderUnresolvedPhrase) {
			named = true
		}
	}
	if !named {
		t.Fatal("the native anchor check must name the exact unresolved phrase in its violation detail")
	}

	report := Generate(ev)
	if report.Decision != DecisionNoGo {
		t.Fatalf("decision = %q, want NO-GO", report.Decision)
	}
	if invalid := blockersOfKind(report.Blockers, KindInvalidManifest); len(invalid) != 0 {
		t.Fatalf("the fixture manifest is otherwise clean, so the only C1 cause is the unresolved anchor; got %#v", invalid)
	}
	wantKindSubjectsExactly(t, report.Blockers, KindUnresolvableAnchor,
		"companies/"+atomicIndustryGateTitle, "companies/"+atomicIndustryGateTitle)
	wantCriterionDetailOn(t, report.Blockers, criterionC1)
	wantCriterionDetailOn(t, report.Blockers, criterionC9)
}

// wantCriterionDetailOn asserts at least one criterion blocker for the given
// criterion carries the frozen unresolvable-anchor wording.
func wantCriterionDetailOn(t *testing.T, got []Blocker, criterion string) {
	t.Helper()
	for _, blocker := range blockersOfKind(got, KindCriterion) {
		if blocker.Subject == criterion && strings.Contains(blocker.Detail, "MUST row has no resolvable anchor") {
			return
		}
	}
	t.Fatalf("criterion %q has no unresolvable-anchor blocker: %#v", criterion, blockersOfKind(got, KindCriterion))
}

// TestLoadEvidence_RenamedSQLDeclarationReachesC9Blocker proves exact sqlc
// declarations are authoritative: a renamed query reaches the criterion 9
// blocker instead of being satisfied by a substring mention.
func TestLoadEvidence_RenamedSQLDeclarationReachesC9Blocker(t *testing.T) {
	fixture := newLoaderFixture(t, resolveLoaderAtomicPhrase)
	writeLoaderFixtureFile(t, fixture.root, atomicIndustrySQLOwner, loaderRenamedSQL)
	ev := loadLoaderFixture(t, fixture.root)

	if slices.Contains(ev.Prepared.sqlSymbols, atomicIndustrySQLSymbol) {
		t.Fatalf("a renamed declaration must not satisfy %q: %q", atomicIndustrySQLSymbol, ev.Prepared.sqlSymbols)
	}
	report := Generate(ev)
	if anchors := blockersOfKind(report.Blockers, KindUnresolvableAnchor); len(anchors) != 0 {
		t.Fatalf("this fixture resolves every anchor; got %#v", anchors)
	}
	c9 := []Blocker{}
	for _, blocker := range blockersOfKind(report.Blockers, KindCriterion) {
		if blocker.Subject == criterionC9 {
			c9 = append(c9, blocker)
		}
	}
	if len(c9) != 1 {
		t.Fatalf("criterion 9 blockers = %#v, want exactly the observed-SQL-symbol blocker", c9)
	}
	for _, want := range []string{atomicIndustrySQLOwner, atomicIndustrySQLSymbol} {
		if !strings.Contains(c9[0].Detail, want) {
			t.Fatalf("criterion 9 detail %q must name %q", c9[0].Detail, want)
		}
	}
	if report.Decision != DecisionNoGo {
		t.Fatalf("decision = %q, want NO-GO", report.Decision)
	}
}

// TestLoadEvidence_IndependentScanObservation proves the loader wires the two
// native scans independently through production: a hit in one domain blocks its
// own criterion and leaves the other domain an explicitly observed clean result.
func TestLoadEvidence_IndependentScanObservation(t *testing.T) {
	t.Run("non-goal hit blocks only criterion 10", func(t *testing.T) {
		fixture := newLoaderFixture(t)
		writeLoaderFixtureFile(t, fixture.root, "backend/deploy/worker-lambda.yaml", "kind: Lambda\n")
		ev := loadLoaderFixture(t, fixture.root)

		if len(ev.Prepared.nonGoal) != 1 || len(ev.Prepared.architecture) != 0 {
			t.Fatalf("scan split collapsed: nonGoal=%#v architecture=%#v", ev.Prepared.nonGoal, ev.Prepared.architecture)
		}
		report := Generate(ev)
		wantKindSubjectsExactly(t, report.Blockers, KindNonGoal, "deploy/worker-lambda.yaml")
		if architecture := blockersOfKind(report.Blockers, KindArchitecture); len(architecture) != 0 {
			t.Fatalf("architecture must stay observed-clean; got %#v", architecture)
		}
	})

	t.Run("architecture hit blocks only criterion 11", func(t *testing.T) {
		fixture := newLoaderFixture(t)
		writeLoaderFixtureFile(t, fixture.root,
			"backend/internal/features/jobs/infrastructure/http/adhoc.go",
			"package http\n\nvar payload = map[string]string{\"code\": \"not_found\"}\n")
		ev := loadLoaderFixture(t, fixture.root)

		if len(ev.Prepared.architecture) != 1 || len(ev.Prepared.nonGoal) != 0 {
			t.Fatalf("scan split collapsed: nonGoal=%#v architecture=%#v", ev.Prepared.nonGoal, ev.Prepared.architecture)
		}
		report := Generate(ev)
		wantKindSubjectsExactly(t, report.Blockers, KindArchitecture,
			"internal/features/jobs/infrastructure/http/adhoc.go")
		if nonGoal := blockersOfKind(report.Blockers, KindNonGoal); len(nonGoal) != 0 {
			t.Fatalf("non-goal scan must stay observed-clean; got %#v", nonGoal)
		}
	})
}

// TestLoadEvidence_FailsClosedOnBrokenInputs proves every failed real
// derivation is an error with no evidence, never a loaded PreparedEvidence.
func TestLoadEvidence_FailsClosedOnBrokenInputs(t *testing.T) {
	tests := []struct {
		name    string
		wantErr string
		mutate  func(t *testing.T, root string)
	}{
		{
			name:    "absent traceability manifest",
			wantErr: "traceability.json",
			mutate: func(t *testing.T, root string) {
				removeLoaderFixturePath(t, root, loaderFixtureManifestRel)
			},
		},
		{
			name:    "unreadable traceability manifest",
			wantErr: "traceability.json",
			mutate: func(t *testing.T, root string) {
				dirAtLoaderFixturePath(t, root, loaderFixtureManifestRel)
			},
		},
		{
			name:    "absent feature source tree",
			wantErr: "features",
			mutate: func(t *testing.T, root string) {
				removeLoaderFixturePath(t, root, "backend/internal/features")
			},
		},
		{
			name:    "unreadable canonical sqlc query file",
			wantErr: "companies.sql",
			mutate: func(t *testing.T, root string) {
				dirAtLoaderFixturePath(t, root, atomicIndustrySQLOwner)
			},
		},
		{
			name:    "failed Git tree identity",
			wantErr: "tree identity",
			mutate: func(t *testing.T, root string) {
				removeLoaderFixturePath(t, root, ".git")
			},
		},
		{
			name:    "unreadable gate receipt",
			wantErr: "gate-build.json",
			mutate: func(t *testing.T, root string) {
				dirAtLoaderFixturePath(t, root, filepath.Join(loaderFixtureReceiptsRel, "gate-build.json"))
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newLoaderFixture(t)
			tt.mutate(t, fixture.root)

			ev, err := LoadEvidence(fixture.root)
			if err == nil {
				t.Fatalf("LoadEvidence must fail closed on %s; got Prepared=%#v", tt.name, ev.Prepared)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error %q must name the failed input %q", err, tt.wantErr)
			}
			if ev.Prepared != nil || ev.TreeIdentity != "" || len(ev.RawReceipts) != 0 {
				t.Fatalf("failed load returned evidence: %#v", ev)
			}
		})
	}
}

// TestLoadEvidence_DerivesCurrentWorktreeState proves the root-based worktree state, movement, and fail-closed reads.
func TestLoadEvidence_DerivesCurrentWorktreeState(t *testing.T) {
	fixture := newLoaderFixture(t)
	ev := loadLoaderFixture(t, fixture.root)
	if want := loaderWorktreeStateOracle(t, fixture.root); ev.WorktreeState != want || ev.TreeIdentity != fixture.treeID {
		t.Fatalf("initial pair = %q/%q, want tree %q with the producer digest %q", ev.TreeIdentity, ev.WorktreeState, fixture.treeID, want)
	}
	rootUntracked := "openspec/changes/" + loaderFixtureChange + "/root-untracked-fixture.md"
	writeLoaderFixtureFile(t, fixture.root, rootUntracked, "root-level untracked evidence\n")
	moved := loadLoaderFixture(t, fixture.root)
	if want := loaderWorktreeStateOracle(t, fixture.root); moved.WorktreeState != want || moved.WorktreeState == ev.WorktreeState || moved.TreeIdentity != fixture.treeID {
		t.Fatalf("moved pair = %q/%q, want tree %q with the moved producer digest %q (distinct from %q)",
			moved.TreeIdentity, moved.WorktreeState, fixture.treeID, want, ev.WorktreeState)
	}
	writeLoaderFixtureFile(t, fixture.root, rootUntracked, "changed root-level content\n")
	if again := loadLoaderFixture(t, fixture.root); again.WorktreeState == moved.WorktreeState {
		t.Fatal("a content change at the same root-relative untracked path must move the worktree state")
	}
	if err := os.Symlink("missing-fixture-target", filepath.Join(fixture.root, "backend", "broken-link-fixture")); err != nil {
		t.Fatal(err)
	}
	if loaded, err := LoadEvidence(fixture.root); err == nil || !strings.Contains(err.Error(), "worktree") || loaded.Prepared != nil || loaded.WorktreeState != "" {
		t.Fatalf("LoadEvidence must fail closed with no evidence: %#v err=%v", loaded, err)
	}
}

// TestLoadEvidence_RejectsReceiptIdentityDrift pins the optimistic double snapshot: a tree-only and
// a worktree-only move between the two observations fail closed deterministically.
func TestLoadEvidence_RejectsReceiptIdentityDrift(t *testing.T) {
	if err := stableReceiptIdentity(receiptIdentity{treeID, worktreeID}, receiptIdentity{treeID, worktreeID}); err != nil {
		t.Fatalf("stable pair rejected: %v", err)
	}
	tests := [][3]string{
		{"3333333333333333333333333333333333333333", worktreeID, `tree "` + treeID + `" -> "3333333333333333333333333333333333333333"`},
		{treeID, "sha256:6666666666666666666666666666666666666666666666666666666666666666", `worktree_state "` + worktreeID + `" -> "sha256:6666666666666666666666666666666666666666666666666666666666666666"`},
	}
	for _, tt := range tests {
		if err := stableReceiptIdentity(receiptIdentity{treeID, worktreeID}, receiptIdentity{tt[0], tt[1]}); err == nil || !strings.Contains(err.Error(), "receipt identity drifted during observation") || !strings.Contains(err.Error(), tt[2]) {
			t.Fatalf("drift %v must be rejected and named %q: %v", tt[:2], tt[2], err)
		}
	}
}

// loadLoaderArtifacts runs the production pipeline over one fixture root and
// returns the three generated artifact bytes plus the decision. Artifacts are
// written only into a temporary directory.
func loadLoaderArtifacts(t *testing.T, root string) (map[string][]byte, Report) {
	t.Helper()
	ev := loadLoaderFixture(t, root)
	report := Generate(ev)
	dir := t.TempDir()
	if err := WriteArtifacts(dir, ev, report); err != nil {
		t.Fatalf("WriteArtifacts: %v", err)
	}
	files := map[string][]byte{}
	for _, name := range []string{TraceabilityFile, GoNoGoFile, ReportJSONFile} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("reading generated artifact %s: %v", name, err)
		}
		files[name] = data
	}
	return files, report
}

// TestLoadEvidence_FixtureArtifactPipelineIsDeterministic proves the fixture-only
// load -> Generate -> WriteArtifacts pipeline is byte-deterministic, observes the
// four fixed documents as a clean criterion 12 PASS, and never writes into the
// loaded repository.
func TestLoadEvidence_FixtureArtifactPipelineIsDeterministic(t *testing.T) {
	fixture := newLoaderFixture(t)

	first, firstReport := loadLoaderArtifacts(t, fixture.root)
	second, secondReport := loadLoaderArtifacts(t, fixture.root)

	if !reflect.DeepEqual(firstReport, secondReport) {
		t.Fatalf("report is not deterministic:\n first: %#v\nsecond: %#v", firstReport, secondReport)
	}
	if len(first) != 3 {
		t.Fatalf("generated artifacts = %d files, want 3", len(first))
	}
	for name, want := range first {
		got, ok := second[name]
		if !ok {
			t.Fatalf("second run did not write %s", name)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("artifact %s is not byte-deterministic:\n first: %q\nsecond: %q", name, want, got)
		}
	}

	if firstReport.Decision != DecisionNoGo {
		t.Fatalf("decision = %q, want NO-GO", firstReport.Decision)
	}
	// The fixture writes all four fixed documents clean, so criterion 12 is an
	// observed PASS: neither a docs-contradiction blocker nor the deterministic
	// unobserved-docs blocker may remain.
	if got := blockersOfKind(firstReport.Blockers, KindDocsContradiction); len(got) != 0 {
		t.Fatalf("observed clean documents must produce no docs-contradiction blocker: %#v", got)
	}
	if slices.ContainsFunc(blockersOfKind(firstReport.Blockers, kindCriterion), func(blocker Blocker) bool {
		return blocker.Subject == criterionC12
	}) {
		t.Fatal("observed clean documents must remove the criterion 12 blocker")
	}
	if !bytes.Contains(first[GoNoGoFile], []byte("### "+criterionC12+" — PASS")) {
		t.Fatalf("go/no-go artifact must render an observed clean criterion 12 as PASS:\n%s", first[GoNoGoFile])
	}
	if !bytes.Contains(first[TraceabilityFile], []byte("Decision: NO-GO")) {
		t.Fatalf("traceability artifact must carry the decision:\n%s", first[TraceabilityFile])
	}

	for _, name := range []string{TraceabilityFile, GoNoGoFile, ReportJSONFile} {
		if _, err := os.Stat(filepath.Join(fixture.root, "docs", name)); err == nil {
			t.Fatalf("the pipeline must never write the generated artifact %s into the loaded repository tree", name)
		}
	}
}

// TestLoadEvidence_UntrustedReceiptBytesStayRaw triangulates the raw-receipt
// contract: the loader never parses, repairs, or normalizes a receipt, so
// malformed bytes are loaded verbatim and Generate's raw validation blocks them
// instead of the loader silently dropping or accepting them.
func TestLoadEvidence_UntrustedReceiptBytesStayRaw(t *testing.T) {
	fixture := newLoaderFixture(t)
	malformed := []byte("{not a receipt at all")
	writeLoaderFixtureFile(t, fixture.root, filepath.Join(loaderFixtureReceiptsRel, "gate-vet.json"), string(malformed))
	ev := loadLoaderFixture(t, fixture.root)

	if len(ev.RawReceipts) != 3 {
		t.Fatalf("RawReceipts = %d entries, want the 3 existing receipts", len(ev.RawReceipts))
	}
	if !bytes.Equal(ev.RawReceipts[1], malformed) {
		t.Fatalf("malformed receipt bytes must be loaded verbatim at their required-gate position: got %q", ev.RawReceipts[1])
	}
	wantKindSubjectsExactly(t, Generate(ev).Blockers, KindInvalidReceipt, "raw[1]")
}

// TestLoadEvidence_SkipWhitelistObservedEmptyPassesC3 proves the loader observes
// the canonical package-owned skip whitelist from its fixed path and that the
// observed, explicitly empty whitelist is what lets the whitelist part of
// criterion 3 pass.
func TestLoadEvidence_SkipWhitelistObservedEmptyPassesC3(t *testing.T) {
	fixture := newLoaderFixture(t)
	ev := loadLoaderFixture(t, fixture.root)

	if !ev.Prepared.whitelistObserved {
		t.Fatal("LoadEvidence must observe the canonical skip whitelist from its fixed package-owned path")
	}
	if ev.Prepared.whitelistLen != 0 {
		t.Fatalf("whitelistLen = %d, want the observed empty whitelist length 0", ev.Prepared.whitelistLen)
	}
	report := Generate(ev)
	if got := blockersOfKind(report.Blockers, kindSkipWhitelist); len(got) != 0 {
		t.Fatalf("an observed empty whitelist must pass the whitelist part of criterion 3: %#v", got)
	}
	if slices.ContainsFunc(blockersOfKind(report.Blockers, kindCriterion), func(blocker Blocker) bool {
		return blocker.Subject == criterionC3 && strings.Contains(blocker.Detail, "whitelist")
	}) {
		t.Fatal("an observed empty whitelist must leave no skip-whitelist criterion 3 blocker")
	}
}

// TestLoadEvidence_SkipWhitelistAcceptsOrdinaryVariation is the alternate-case
// control for the strict parser: ordinary JSON whitespace, key-order variation,
// a spaced empty array, and a missing final newline are all still the canonical
// whitelist, so strictness never rejects a well-formed explicitly empty document.
func TestLoadEvidence_SkipWhitelistAcceptsOrdinaryVariation(t *testing.T) {
	fixture := newLoaderFixture(t)
	writeLoaderSkipWhitelist(t, fixture.root,
		`{ "entries" : [ ] , "schema" : "peopleflow.skip-whitelist/v1" }`)
	ev := loadLoaderFixture(t, fixture.root)

	if !ev.Prepared.whitelistObserved || ev.Prepared.whitelistLen != 0 {
		t.Fatalf("an explicitly empty whitelist with ordinary whitespace and key order must be observed empty: observed=%t len=%d",
			ev.Prepared.whitelistObserved, ev.Prepared.whitelistLen)
	}
}

// TestLoadEvidence_SkipWhitelistRejectsCallerCompatibilityProjection proves the
// retained Evidence.SkipWhitelistLen field is a render-only compatibility
// projection: a caller can neither grant the whitelist part of criterion 3 with
// it nor make an unobserved whitelist look observed.
func TestLoadEvidence_SkipWhitelistRejectsCallerCompatibilityProjection(t *testing.T) {
	fixture := newLoaderFixture(t)
	ev := loadLoaderFixture(t, fixture.root)
	ev.SkipWhitelistLen = 7
	if got := blockersOfKind(Generate(ev).Blockers, kindSkipWhitelist); len(got) != 0 {
		t.Fatalf("the observed canonical whitelist alone decides criterion 3; caller projection produced %#v", got)
	}

	unobserved := completeEvidence()
	unobserved.Prepared.whitelistObserved = false
	unobserved.SkipWhitelistLen = 0
	wantBlockersExactly(t, blockersOfKind(Generate(unobserved).Blockers, kindSkipWhitelist), []Blocker{
		{Kind: kindSkipWhitelist, Subject: "skip-whitelist", Detail: "observed native skip-whitelist is absent"},
	})
}

// TestLoadEvidence_SkipWhitelistFailsClosed proves every whitelist failure class
// fails the whole load with a contextual error and no prepared evidence, so a
// missing, unreadable, malformed, non-object, duplicated, unknown-keyed,
// wrong-typed, invalidly-schemaed, non-array, non-empty, or trailing-value
// whitelist can never look like an observed clean one.
func TestLoadEvidence_SkipWhitelistFailsClosed(t *testing.T) {
	const schemaField = `"schema":"peopleflow.skip-whitelist/v1"`
	tests := []struct {
		name    string
		wantErr string
		mutate  func(t *testing.T, root string)
	}{
		{
			name:    "absent whitelist file",
			wantErr: "skip-whitelist.json",
			mutate: func(t *testing.T, root string) {
				removeLoaderFixturePath(t, root, loaderFixtureSkipWhitelistRel)
			},
		},
		{
			name:    "unreadable whitelist file",
			wantErr: "skip-whitelist.json",
			mutate: func(t *testing.T, root string) {
				dirAtLoaderFixturePath(t, root, loaderFixtureSkipWhitelistRel)
			},
		},
		{
			name:    "malformed JSON",
			wantErr: "malformed JSON",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{`+schemaField+`,"entries":[}`)
			},
		},
		{
			name:    "non-object root",
			wantErr: "JSON object",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `[]`)
			},
		},
		{
			name:    "duplicate key",
			wantErr: "duplicate field",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{`+schemaField+`,`+schemaField+`,"entries":[]}`)
			},
		},
		{
			name:    "escaped-equivalent duplicate key",
			wantErr: "duplicate field",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{"schema":"peopleflow.skip-whitelist/v1","sch\u0065ma":"peopleflow.skip-whitelist/v1","entries":[]}`)
			},
		},
		{
			name:    "unknown key",
			wantErr: "unknown field",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{`+schemaField+`,"entries":[],"extra":true}`)
			},
		},
		{
			name:    "missing schema",
			wantErr: "missing required field",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{"entries":[]}`)
			},
		},
		{
			name:    "missing entries",
			wantErr: "missing required field",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{`+schemaField+`}`)
			},
		},
		{
			name:    "null schema",
			wantErr: "must not be null",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{"schema":null,"entries":[]}`)
			},
		},
		{
			name:    "null entries",
			wantErr: "must not be null",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{`+schemaField+`,"entries":null}`)
			},
		},
		{
			name:    "wrong-typed schema",
			wantErr: "wrong type",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{"schema":7,"entries":[]}`)
			},
		},
		{
			name:    "invalid schema",
			wantErr: "invalid schema",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{"schema":"peopleflow.skip-whitelist/v2","entries":[]}`)
			},
		},
		{
			name:    "non-array entries",
			wantErr: "wrong type",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{`+schemaField+`,"entries":{}}`)
			},
		},
		{
			name:    "non-empty entries",
			wantErr: "must be empty",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{`+schemaField+`,"entries":["TestUnexpectedSkip"]}`)
			},
		},
		{
			name:    "trailing JSON value",
			wantErr: "trailing JSON",
			mutate: func(t *testing.T, root string) {
				writeLoaderSkipWhitelist(t, root, `{`+schemaField+`,"entries":[]}{}`)
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newLoaderFixture(t)
			tt.mutate(t, fixture.root)

			ev, err := LoadEvidence(fixture.root)
			if err == nil {
				t.Fatalf("LoadEvidence must fail closed on %s; got Prepared=%#v", tt.name, ev.Prepared)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error %q must name the %s failure %q", err, tt.name, tt.wantErr)
			}
			if ev.Prepared != nil || ev.TreeIdentity != "" || len(ev.RawReceipts) != 0 {
				t.Fatalf("failed load returned evidence: %#v", ev)
			}
		})
	}
}

// TestLoadEvidence_SqlcQueryKindAllowList proves only actual sqlc query kinds are
// authoritative: a supported cardinality kind declares its symbol, and an
// unsupported, differently-cased, or missing kind is not a declaration at all.
func TestLoadEvidence_SqlcQueryKindAllowList(t *testing.T) {
	fixture := newLoaderFixture(t)
	writeLoaderFixtureFile(t, fixture.root, atomicIndustrySQLOwner, loaderFixtureKindProbeSQL)
	ev := loadLoaderFixture(t, fixture.root)

	for _, want := range []string{
		"SupportedOne", "SupportedMany", "SupportedExec", "SupportedExecRows",
		"SupportedExecResult", "SupportedExecLastID", "SupportedCopyFrom",
		"SupportedBatchExec", "SupportedBatchMany", "SupportedBatchOne",
	} {
		if !slices.Contains(ev.Prepared.sqlSymbols, want) {
			t.Fatalf("supported sqlc query kind for %q must be accepted: %q", want, ev.Prepared.sqlSymbols)
		}
	}
	for _, rejected := range []string{"RejectedBogus", "RejectedUpper", "RejectedEmpty"} {
		if slices.Contains(ev.Prepared.sqlSymbols, rejected) {
			t.Fatalf("unsupported sqlc query kind for %q must not be authoritative: %q", rejected, ev.Prepared.sqlSymbols)
		}
	}
}

// TestLoadEvidence_SqlcDeclarationCannotSpanLines proves an exact sqlc
// declaration must occupy one source line. A name wrapped onto the next line and
// a kind wrapped onto the next line must contribute no symbol at all, so no
// line-crossing annotation can become authoritative evidence for criterion 9.
func TestLoadEvidence_SqlcDeclarationCannotSpanLines(t *testing.T) {
	t.Run("split-line forms contribute no symbol", func(t *testing.T) {
		fixture := newLoaderFixture(t)
		writeLoaderFixtureFile(t, fixture.root, atomicIndustrySQLOwner, loaderFixtureSplitLineSQL)
		ev := loadLoaderFixture(t, fixture.root)

		if len(ev.Prepared.sqlSymbols) != 0 {
			t.Fatalf("a declaration split across source lines must contribute no symbol at all: %q", ev.Prepared.sqlSymbols)
		}
		for _, rejected := range []string{atomicIndustrySQLSymbol, "SplitKind"} {
			if slices.Contains(ev.Prepared.sqlSymbols, rejected) {
				t.Fatalf("a split-line declaration must not contribute %q: %q", rejected, ev.Prepared.sqlSymbols)
			}
		}
	})

	t.Run("split-line declaration cannot satisfy criterion 9", func(t *testing.T) {
		fixture := newLoaderFixture(t, resolveLoaderAtomicPhrase)
		writeLoaderFixtureFile(t, fixture.root, atomicIndustrySQLOwner, loaderFixtureSplitLineSQL)
		ev := loadLoaderFixture(t, fixture.root)

		c9 := []Blocker{}
		for _, blocker := range blockersOfKind(Generate(ev).Blockers, KindCriterion) {
			if blocker.Subject == criterionC9 {
				c9 = append(c9, blocker)
			}
		}
		if len(c9) != 1 {
			t.Fatalf("criterion 9 blockers = %#v, want exactly the unobserved-SQL-symbol blocker", c9)
		}
		for _, want := range []string{atomicIndustrySQLOwner, atomicIndustrySQLSymbol} {
			if !strings.Contains(c9[0].Detail, want) {
				t.Fatalf("criterion 9 detail %q must name %q", c9[0].Detail, want)
			}
		}
	})
}

// TestLoadEvidence_DocsFixedPathsObservedAndFailClosed proves the loader owns the
// fixed four-document observation: the clean fixture is observed and leaves
// criterion 12 without a blocker, a stale document is observed as findings, and a
// missing or unreadable fixed document fails the whole load closed with no
// observed-clean state.
func TestLoadEvidence_DocsFixedPathsObservedAndFailClosed(t *testing.T) {
	t.Run("clean fixed documents are observed with no finding", func(t *testing.T) {
		fixture := newLoaderFixture(t)
		ev := loadLoaderFixture(t, fixture.root)

		if !ev.Prepared.docsObserved {
			t.Fatal("LoadEvidence must set the docs observation state once all four fixed documents were read and validated")
		}
		if ev.Prepared.docsFindings == nil || len(ev.Prepared.docsFindings) != 0 {
			t.Fatalf("clean documents must be observed with an intentional empty finding list: %#v", ev.Prepared.docsFindings)
		}
		report := Generate(ev)
		if got := blockersOfKind(report.Blockers, KindDocsContradiction); len(got) != 0 {
			t.Fatalf("observed clean documents must not block criterion 12: %#v", got)
		}
		if slices.ContainsFunc(blockersOfKind(report.Blockers, kindCriterion), func(blocker Blocker) bool {
			return blocker.Subject == criterionC12
		}) {
			t.Fatal("observed clean documents must remove the criterion 12 blocker")
		}
	})

	t.Run("stale fixed document is observed as findings that block criterion 12", func(t *testing.T) {
		fixture := newLoaderFixture(t)
		writeLoaderFixtureFile(t, fixture.root, string(docRoadmap),
			cleanDoc(docRoadmap)+"- Migraciones goose aplicadas (versión 8).\n")
		ev := loadLoaderFixture(t, fixture.root)

		if !ev.Prepared.docsObserved {
			t.Fatal("docs observation state must be set for a stale but readable document set")
		}
		wantRuleFire(t, ev.Prepared.docsFindings, "docs-roadmap-migration-version")
		wantKindSubjectsExactly(t, Generate(ev).Blockers, KindDocsContradiction, string(docRoadmap))
	})

	t.Run("missing fixed document fails closed with no evidence", func(t *testing.T) {
		fixture := newLoaderFixture(t)
		removeLoaderFixturePath(t, fixture.root, string(docReadme))

		ev, err := LoadEvidence(fixture.root)
		if err == nil {
			t.Fatalf("LoadEvidence must fail closed on a missing fixed document; got Prepared=%#v", ev.Prepared)
		}
		if !strings.Contains(err.Error(), string(docReadme)) {
			t.Fatalf("error %q must name the missing document %q", err, docReadme)
		}
		if ev.Prepared != nil {
			t.Fatalf("failed load returned evidence: %#v", ev)
		}
	})

	t.Run("unreadable fixed document fails closed with no evidence", func(t *testing.T) {
		fixture := newLoaderFixture(t)
		dirAtLoaderFixturePath(t, fixture.root, string(docDataModel))

		ev, err := LoadEvidence(fixture.root)
		if err == nil {
			t.Fatalf("LoadEvidence must fail closed on an unreadable fixed document; got Prepared=%#v", ev.Prepared)
		}
		if !strings.Contains(err.Error(), filepath.Base(string(docDataModel))) {
			t.Fatalf("error %q must name the unreadable document %q", err, docDataModel)
		}
		if ev.Prepared != nil {
			t.Fatalf("failed load returned evidence: %#v", ev)
		}
	})
}

// -- CE-03: receipt-derived executable evidence --

// loaderFixtureGitIgnoreRel and loaderFixtureGitIgnore keep the fixture's gate
// receipts Git-invisible. The receipt bytes the loader must bind then cannot
// perturb the tree and worktree identities they are sealed against, which is the
// same identity-neutral property the real repository's tracked-and-clean
// receipts have.
const (
	loaderFixtureGitIgnoreRel = ".gitignore"
	loaderFixtureGitIgnore    = "backend/quality/receipts/\n"
)

// loaderSealedPrerequisiteReceipt seals one producer-shaped receipt against the
// fixture's own observed tree and worktree identity, so the receipt is genuinely
// valid same-identity evidence for that fixture root and only the prerequisite
// under test decides executable eligibility.
func loaderSealedPrerequisiteReceipt(t *testing.T, root, gate string) []byte {
	t.Helper()
	raw := sealedRawReceiptForGate(gate)
	if raw == nil {
		t.Fatalf("no producer-shaped fixture receipt for gate %q", gate)
	}
	return resealRawReceipt(t, raw,
		receiptReplacement{expected: treeID, replacement: loaderGitTree(t, root)},
		receiptReplacement{expected: worktreeID, replacement: loaderWorktreeStateOracle(t, root)},
	)
}

// writeLoaderReceipt writes one receipt at its fixed canonical path.
func writeLoaderReceipt(t *testing.T, root, gate string, raw []byte) {
	t.Helper()
	writeLoaderFixtureFile(t, root, filepath.Join(loaderFixtureReceiptsRel, gate+".json"), string(raw))
}

// resealLoaderPrerequisite rewrites one fixture prerequisite receipt through the
// existing resealing support, so a mutated receipt stays structurally valid
// unless the case intends an invalid one.
func resealLoaderPrerequisite(t *testing.T, root, gate string, replacements ...receiptReplacement) []byte {
	t.Helper()
	raw := resealRawReceipt(t, loaderSealedPrerequisiteReceipt(t, root, gate), replacements...)
	writeLoaderReceipt(t, root, gate, raw)
	return raw
}

// withLoaderPrerequisiteReceipts writes the whole CE-03 executable matrix's
// prerequisite receipts (gate-build, gate-unit, gate-migrations), each sealed
// against the fixture's own identity. The Git-invisible fixture receipt
// directory keeps that identity stable across these writes.
func withLoaderPrerequisiteReceipts(t *testing.T, root string) {
	t.Helper()
	for _, gate := range []string{"gate-build", "gate-unit", "gate-migrations"} {
		writeLoaderReceipt(t, root, gate, loaderSealedPrerequisiteReceipt(t, root, gate))
	}
}

// loaderExecutableNames returns the derived executable names after requiring
// every entry to be the complete Executable{Name, RuntimeBoundaryTests: true}
// value: a partial or false entry is a derivation defect, never evidence.
func loaderExecutableNames(t *testing.T, got []Executable) []string {
	t.Helper()
	names := make([]string, 0, len(got))
	for _, ex := range got {
		if !ex.RuntimeBoundaryTests {
			t.Fatalf("executable %q was emitted without runtime-boundary test evidence: %#v", ex.Name, got)
		}
		names = append(names, ex.Name)
	}
	return names
}

// TestLoadEvidence_DerivesExecutableEvidenceFromPrerequisiteReceipts proves the
// loader derives the built-executable evidence from the fixed raw receipts it
// already read: a complete fixture whose gate-build/gate-unit/gate-migrations
// receipts are valid, passing, zero-skip, and same-identity yields exactly the
// three pinned Executable values and removes Generate's executable blockers.
func TestLoadEvidence_DerivesExecutableEvidenceFromPrerequisiteReceipts(t *testing.T) {
	fixture := newLoaderFixture(t, withLoaderPrerequisiteReceipts)
	ev := loadLoaderFixture(t, fixture.root)

	if len(ev.RawReceipts) != 4 {
		t.Fatalf("RawReceipts = %d entries, want the 4 existing receipts (build, unit, migrations, arch)", len(ev.RawReceipts))
	}
	wantAllRawReceiptsValid(t, ev.RawReceipts)

	want := []Executable{
		{Name: "cmd/api", RuntimeBoundaryTests: true},
		{Name: "cmd/migrate", RuntimeBoundaryTests: true},
		{Name: "cmd/postconfirmation", RuntimeBoundaryTests: true},
	}
	if !reflect.DeepEqual(ev.Executables, want) {
		t.Fatalf("derived executables = %#v, want exactly the three pinned values in required order %#v", ev.Executables, want)
	}

	report := Generate(ev)
	if blockers := blockersOfKind(report.Blockers, kindExecutable); len(blockers) != 0 {
		t.Fatalf("complete same-identity prerequisites must remove every executable blocker: %#v", blockers)
	}
	if criteria := blockersOfKind(report.Blockers, kindCriterion); slices.ContainsFunc(criteria, func(blocker Blocker) bool {
		return blocker.Subject == criterionC5
	}) {
		t.Fatalf("complete same-identity prerequisites must remove the criterion 5 blockers: %#v", criteria)
	}
}

// TestLoadEvidence_ExecutableEvidenceFailsClosedOnPrerequisiteReceipts proves
// every ineligible prerequisite leaves exactly its affected executables absent
// while the unaffected executables stay derived: missing, failing, stale,
// duplicate, invalid, and producer-contract-mismatched receipts are all
// rejected, so Generate keeps reporting its existing blockers.
func TestLoadEvidence_ExecutableEvidenceFailsClosedOnPrerequisiteReceipts(t *testing.T) {
	treeDrift := strings.Repeat("d", 40)
	worktreeDrift := "sha256:" + strings.Repeat("e", 64)
	tests := []struct {
		name                  string
		mutate                func(t *testing.T, root string)
		wantAbsent            []string
		wantPresent           []string
		wantDuplicateGate     string
		wantInvalidRawSubject string
	}{
		{
			name: "missing gate-unit receipt",
			mutate: func(t *testing.T, root string) {
				removeLoaderFixturePath(t, root, filepath.Join(loaderFixtureReceiptsRel, "gate-unit.json"))
			},
			wantAbsent:  []string{"cmd/api", "cmd/postconfirmation"},
			wantPresent: []string{"cmd/migrate"},
		},
		{
			name: "missing gate-migrations receipt",
			mutate: func(t *testing.T, root string) {
				removeLoaderFixturePath(t, root, filepath.Join(loaderFixtureReceiptsRel, "gate-migrations.json"))
			},
			wantAbsent:  []string{"cmd/migrate"},
			wantPresent: []string{"cmd/api", "cmd/postconfirmation"},
		},
		{
			name: "failing gate-build receipt",
			mutate: func(t *testing.T, root string) {
				raw := resealLoaderPrerequisite(t, root, "gate-build",
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"failure":""`, `"failure":"seeded prerequisite failure"`},
				)
				if validated, err := ValidateReceipt(raw); err != nil || validated.Status != "fail" {
					t.Fatalf("the seeded failing receipt must stay valid evidence: %+v err=%v", validated, err)
				}
			},
			wantAbsent: []string{"cmd/api", "cmd/migrate", "cmd/postconfirmation"},
		},
		{
			name: "stale gate-build tree identity",
			mutate: func(t *testing.T, root string) {
				raw := resealLoaderPrerequisite(t, root, "gate-build",
					receiptReplacement{expected: loaderGitTree(t, root), replacement: treeDrift})
				if validated, err := ValidateReceipt(raw); err != nil || validated.Tree != treeDrift {
					t.Fatalf("the stale receipt must stay valid with a drifted tree: %+v err=%v", validated, err)
				}
			},
			wantAbsent: []string{"cmd/api", "cmd/migrate", "cmd/postconfirmation"},
		},
		{
			name: "stale gate-unit worktree identity",
			mutate: func(t *testing.T, root string) {
				raw := resealLoaderPrerequisite(t, root, "gate-unit",
					receiptReplacement{expected: loaderWorktreeStateOracle(t, root), replacement: worktreeDrift})
				if validated, err := ValidateReceipt(raw); err != nil || validated.ArtifactHashes.WorktreeState != worktreeDrift {
					t.Fatalf("the stale receipt must stay valid with a drifted worktree_state: %+v err=%v", validated, err)
				}
			},
			wantAbsent:  []string{"cmd/api", "cmd/postconfirmation"},
			wantPresent: []string{"cmd/migrate"},
		},
		{
			name: "duplicate gate-build evidence",
			mutate: func(t *testing.T, root string) {
				build := loaderSealedPrerequisiteReceipt(t, root, "gate-build")
				if _, err := ValidateReceipt(build); err != nil {
					t.Fatalf("the duplicated receipt must itself be valid evidence: %v", err)
				}
				writeLoaderReceipt(t, root, "gate-arch", build)
			},
			wantAbsent:        []string{"cmd/api", "cmd/migrate", "cmd/postconfirmation"},
			wantDuplicateGate: "gate-build",
		},
		{
			name: "invalid gate-build receipt",
			mutate: func(t *testing.T, root string) {
				writeLoaderReceipt(t, root, "gate-build", []byte("{not a receipt at all"))
			},
			wantAbsent:            []string{"cmd/api", "cmd/migrate", "cmd/postconfirmation"},
			wantInvalidRawSubject: "raw[0]",
		},
		{
			name: "producer-contract-mismatched gate-migrations receipt",
			mutate: func(t *testing.T, root string) {
				raw := resealLoaderPrerequisite(t, root, "gate-migrations",
					receiptReplacement{expected: producerGateTools["gate-migrations"], replacement: "go test -tags=integration -count=1 ./cmd/migrate"})
				if _, err := ValidateReceipt(raw); err == nil {
					t.Fatal("a decodable receipt with the wrong tool must fail the producer contract")
				}
			},
			wantAbsent:  []string{"cmd/migrate"},
			wantPresent: []string{"cmd/api", "cmd/postconfirmation"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newLoaderFixture(t, withLoaderPrerequisiteReceipts)
			tt.mutate(t, fixture.root)

			ev := loadLoaderFixture(t, fixture.root)
			got := loaderExecutableNames(t, ev.Executables)
			for _, name := range tt.wantAbsent {
				if slices.Contains(got, name) {
					t.Fatalf("executable %q must stay absent; derived %v", name, got)
				}
			}
			for _, name := range tt.wantPresent {
				if !slices.Contains(got, name) {
					t.Fatalf("executable %q must remain eligible; derived only %v", name, got)
				}
			}

			report := Generate(ev)
			executableBlockers := blockersOfKind(report.Blockers, kindExecutable)
			for _, name := range tt.wantAbsent {
				if !slices.ContainsFunc(executableBlockers, func(blocker Blocker) bool { return blocker.Subject == name }) {
					t.Fatalf("Generate must keep its executable blocker for %q: %#v", name, executableBlockers)
				}
			}
			for _, name := range tt.wantPresent {
				if slices.ContainsFunc(executableBlockers, func(blocker Blocker) bool { return blocker.Subject == name }) {
					t.Fatalf("Generate must drop the executable blocker for %q: %#v", name, executableBlockers)
				}
			}
			if tt.wantDuplicateGate != "" {
				wantKindSubjectsExactly(t, report.Blockers, kindDuplicateReceipt, tt.wantDuplicateGate)
			}
			if tt.wantInvalidRawSubject != "" {
				wantKindSubjectsExactly(t, report.Blockers, kindInvalidReceipt, tt.wantInvalidRawSubject)
				if raw := string(ev.RawReceipts[0]); raw != "{not a receipt at all" {
					t.Fatalf("an invalid receipt must stay in RawReceipts verbatim: %q", raw)
				}
			}
		})
	}
}

// TestLoadEvidence_ExecutableEvidenceBindsReceiptsToTheirFixedPath proves the
// fixed canonical receipt filename is part of the evidence contract: a valid
// same-gate receipt stored under another fixed receipt path can neither
// substitute for an invalid canonical prerequisite nor mask it, so the affected
// executables stay absent and both raw byte streams remain exposed to Generate's
// existing invalid-receipt blockers.
func TestLoadEvidence_ExecutableEvidenceBindsReceiptsToTheirFixedPath(t *testing.T) {
	invalid := []byte("{not a receipt at all")
	tests := []struct {
		name                  string
		gate                  string
		wantAbsent            []string
		wantPresent           []string
		canonicalIndex        int
		substituteIndex       int
		wantInvalidRawSubject string
	}{
		{
			name:                  "invalid canonical gate-unit receipt with a valid gate-unit-shaped receipt in another fixed path",
			gate:                  "gate-unit",
			wantAbsent:            []string{"cmd/api", "cmd/postconfirmation"},
			wantPresent:           []string{"cmd/migrate"},
			canonicalIndex:        1,
			substituteIndex:       3,
			wantInvalidRawSubject: "raw[1]",
		},
		{
			name:                  "invalid canonical gate-build receipt with a valid gate-build-shaped receipt in another fixed path",
			gate:                  "gate-build",
			wantAbsent:            []string{"cmd/api", "cmd/migrate", "cmd/postconfirmation"},
			canonicalIndex:        0,
			substituteIndex:       3,
			wantInvalidRawSubject: "raw[0]",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newLoaderFixture(t, withLoaderPrerequisiteReceipts)
			substitute := loaderSealedPrerequisiteReceipt(t, fixture.root, tt.gate)
			if validated, err := ValidateReceipt(substitute); err != nil || validated.Gate != tt.gate {
				t.Fatalf("the substituted receipt must itself be valid same-gate evidence: %+v err=%v", validated, err)
			}
			writeLoaderReceipt(t, fixture.root, "gate-arch", substitute)
			writeLoaderReceipt(t, fixture.root, tt.gate, invalid)

			ev := loadLoaderFixture(t, fixture.root)
			got := loaderExecutableNames(t, ev.Executables)
			for _, name := range tt.wantAbsent {
				if slices.Contains(got, name) {
					t.Fatalf("executable %q must stay absent when its only valid same-gate receipt sits at another fixed path; derived %v", name, got)
				}
			}
			for _, name := range tt.wantPresent {
				if !slices.Contains(got, name) {
					t.Fatalf("executable %q must remain eligible; derived only %v", name, got)
				}
			}
			if raw := ev.RawReceipts[tt.canonicalIndex]; !bytes.Equal(raw, invalid) {
				t.Fatalf("RawReceipts[%d] must keep the invalid canonical bytes verbatim: %q", tt.canonicalIndex, raw)
			}
			if raw := ev.RawReceipts[tt.substituteIndex]; !bytes.Equal(raw, substitute) {
				t.Fatalf("RawReceipts[%d] must keep the substituted bytes verbatim: %q", tt.substituteIndex, raw)
			}

			report := Generate(ev)
			wantKindSubjectsExactly(t, report.Blockers, kindInvalidReceipt, tt.wantInvalidRawSubject)
			executableBlockers := blockersOfKind(report.Blockers, kindExecutable)
			for _, name := range tt.wantAbsent {
				if !slices.ContainsFunc(executableBlockers, func(blocker Blocker) bool { return blocker.Subject == name }) {
					t.Fatalf("Generate must keep its executable blocker for %q: %#v", name, executableBlockers)
				}
			}
			for _, name := range tt.wantPresent {
				if slices.ContainsFunc(executableBlockers, func(blocker Blocker) bool { return blocker.Subject == name }) {
					t.Fatalf("Generate must drop the executable blocker for %q: %#v", name, executableBlockers)
				}
			}
		})
	}
}

// TestLoadEvidence_ExecutableEvidenceTaintsMisplacedGateClaims proves that a
// receipt whose embedded gate claim differs from the fixed path it was read from
// taints both gates for executable derivation: the fixed expected gate and the
// embedded claimed gate. A decodable but semantically invalid same-gate claim
// under another fixed path therefore cannot leave the single valid canonical
// prerequisite eligible, and a canonical cross-gate substitution cannot leave any
// affected executable eligible. Every raw stays verbatim in Evidence.RawReceipts
// so Generate keeps reporting its existing path-indexed blockers.
func TestLoadEvidence_ExecutableEvidenceTaintsMisplacedGateClaims(t *testing.T) {
	t.Run("decodable but semantically invalid same-gate claim under another fixed path", func(t *testing.T) {
		fixture := newLoaderFixture(t, withLoaderPrerequisiteReceipts)
		canonical := loaderSealedPrerequisiteReceipt(t, fixture.root, "gate-unit")
		misplaced := resealRawReceipt(t, loaderSealedPrerequisiteReceipt(t, fixture.root, "gate-unit"),
			receiptReplacement{expected: `"skip_names":[]`, replacement: `"skip_names":["TestUnexpectedSkip"]`})
		decoded, err := DecodeReceipt(misplaced)
		if err != nil || decoded.Gate != "gate-unit" {
			t.Fatalf("the misplaced fixture receipt must stay decodable and claim gate-unit: %+v err=%v", decoded, err)
		}
		if _, err := ValidateReceipt(misplaced); err == nil {
			t.Fatal("the misplaced fixture receipt must be semantically invalid evidence")
		}
		writeLoaderReceipt(t, fixture.root, "gate-arch", misplaced)

		ev := loadLoaderFixture(t, fixture.root)
		got := loaderExecutableNames(t, ev.Executables)
		for _, name := range []string{"cmd/api", "cmd/postconfirmation"} {
			if slices.Contains(got, name) {
				t.Fatalf("executable %q must stay absent while a misplaced same-gate claim exists; derived %v", name, got)
			}
		}
		if !slices.Contains(got, "cmd/migrate") {
			t.Fatalf("an untainted executable must remain eligible; derived only %v", got)
		}
		if raw := ev.RawReceipts[1]; !bytes.Equal(raw, canonical) {
			t.Fatalf("RawReceipts[1] must keep the valid canonical bytes verbatim: %q", raw)
		}
		if raw := ev.RawReceipts[3]; !bytes.Equal(raw, misplaced) {
			t.Fatalf("RawReceipts[3] must keep the misplaced invalid bytes verbatim: %q", raw)
		}

		report := Generate(ev)
		wantKindSubjectsExactly(t, report.Blockers, kindInvalidReceipt, "raw[3]")
		executableBlockers := blockersOfKind(report.Blockers, kindExecutable)
		for _, name := range []string{"cmd/api", "cmd/postconfirmation"} {
			if !slices.ContainsFunc(executableBlockers, func(blocker Blocker) bool { return blocker.Subject == name }) {
				t.Fatalf("Generate must keep its executable blocker for %q: %#v", name, executableBlockers)
			}
		}
		if slices.ContainsFunc(executableBlockers, func(blocker Blocker) bool { return blocker.Subject == "cmd/migrate" }) {
			t.Fatalf("Generate must drop the executable blocker for cmd/migrate: %#v", executableBlockers)
		}
	})

	t.Run("canonical cross-gate substitution taints both gates", func(t *testing.T) {
		fixture := newLoaderFixture(t, withLoaderPrerequisiteReceipts)
		migrationsAtUnit := loaderSealedPrerequisiteReceipt(t, fixture.root, "gate-migrations")
		unitAtArch := loaderSealedPrerequisiteReceipt(t, fixture.root, "gate-unit")
		for gate, raw := range map[string][]byte{"gate-migrations": migrationsAtUnit, "gate-unit": unitAtArch} {
			if validated, err := ValidateReceipt(raw); err != nil || validated.Gate != gate {
				t.Fatalf("the displaced %s receipt must itself be valid evidence: %+v err=%v", gate, validated, err)
			}
		}
		writeLoaderReceipt(t, fixture.root, "gate-unit", migrationsAtUnit)
		writeLoaderReceipt(t, fixture.root, "gate-arch", unitAtArch)

		ev := loadLoaderFixture(t, fixture.root)
		if got := loaderExecutableNames(t, ev.Executables); len(got) != 0 {
			t.Fatalf("a canonical cross-gate substitution must leave every affected executable absent; derived %v", got)
		}
		if raw := ev.RawReceipts[1]; !bytes.Equal(raw, migrationsAtUnit) {
			t.Fatalf("RawReceipts[1] must keep the displaced gate-migrations bytes verbatim: %q", raw)
		}
		if raw := ev.RawReceipts[3]; !bytes.Equal(raw, unitAtArch) {
			t.Fatalf("RawReceipts[3] must keep the displaced gate-unit bytes verbatim: %q", raw)
		}

		report := Generate(ev)
		wantKindSubjectsExactly(t, report.Blockers, kindInvalidReceipt)
		wantKindSubjectsExactly(t, report.Blockers, kindDuplicateReceipt, "gate-migrations")
		executableBlockers := blockersOfKind(report.Blockers, kindExecutable)
		for _, name := range []string{"cmd/api", "cmd/migrate", "cmd/postconfirmation"} {
			if !slices.ContainsFunc(executableBlockers, func(blocker Blocker) bool { return blocker.Subject == name }) {
				t.Fatalf("Generate must keep its executable blocker for %q: %#v", name, executableBlockers)
			}
		}
	})
}
