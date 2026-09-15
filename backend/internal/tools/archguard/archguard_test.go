package archguard

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const module = "github.com/aldrichcode45/peopleflow-vacantes/internal"

// wantViolations fails when a case expecting findings reports none (the
// intended behavioral RED of the accept-all scaffold) or reports the wrong
// count.
func wantViolations(t *testing.T, name string, got []Violation, want int) {
	t.Helper()
	if len(got) != want {
		t.Fatalf("%s: got %d violation(s), want %d (want=0 pass, want>0 fails on the accept-all scaffold: guards report no violation) — got: %+v",
			name, len(got), want, got)
	}
}

// wantRuleNamed asserts a violation carries the expected rule and names the
// offender.
func wantRuleNamed(t *testing.T, got []Violation, rule, offender string) {
	t.Helper()
	for _, v := range got {
		if v.Rule == rule && strings.Contains(v.File+v.Detail, offender) {
			return
		}
	}
	t.Fatalf("no violation for rule %q naming %q; got %+v", rule, offender, got)
}

func TestGuard_ForbiddenCrossFeatureInfrastructureImport(t *testing.T) {
	tests := []struct {
		name     string
		packages map[string][]string
		want     int
	}{
		{
			name: "feature imports another feature infrastructure fails naming offender",
			packages: map[string][]string{
				module + "/features/companies/infrastructure/http": {
					module + "/features/jobs/infrastructure/postgres",
				},
			},
			want: 1,
		},
		{
			name: "own-feature infrastructure import is allowed",
			packages: map[string][]string{
				module + "/features/jobs/infrastructure/http": {
					module + "/features/jobs/infrastructure/postgres",
				},
			},
			want: 0,
		},
		{
			name: "shared and runtime imports are allowed",
			packages: map[string][]string{
				module + "/features/jobs/infrastructure/http": {
					module + "/shared/httpjson",
					module + "/runtime/server",
				},
			},
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckCrossFeatureImports(tt.packages)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
	t.Run("offender is named", func(t *testing.T) {
		got := CheckCrossFeatureImports(map[string][]string{
			module + "/features/companies/infrastructure/http": {
				module + "/features/jobs/infrastructure/postgres",
			},
		})
		wantRuleNamed(t, got, "cross-feature-infrastructure-import",
			module+"/features/jobs/infrastructure/postgres")
	})
}

func TestGuard_DocumentedExceptionsPass(t *testing.T) {
	t.Run("documented exception set is exact", func(t *testing.T) {
		want := []string{
			"internal/features/audit_events/domain/entities",
			"internal/features/audit_events/domain/repositories",
			"internal/features/identity/domain/entities",
			"internal/features/identity/domain/repositories",
			"internal/features/identity/domain/security",
			"internal/features/identity/domain/valueobjects",
			"internal/features/companies/domain/entities",
			"internal/features/companies/domain/repositories",
			"internal/features/companies/domain/valueobjects",
		}
		if strings.Join(DocumentedExceptions, "\n") != strings.Join(want, "\n") {
			t.Fatalf("DocumentedExceptions mismatch:\n got %v\nwant %v", DocumentedExceptions, want)
		}
	})
	tests := []struct {
		name     string
		packages map[string][]string
		want     int
	}{
		{
			name: "audit co-write import stays allowed",
			packages: map[string][]string{
				module + "/features/companies/domain/repositories": {
					module + "/features/audit_events/domain/entities",
				},
			},
			want: 0,
		},
		{
			name: "identity domain-port import stays allowed",
			packages: map[string][]string{
				module + "/features/applications/application/usecases": {
					module + "/features/identity/domain/security",
				},
			},
			want: 0,
		},
		{
			name: "cross-feature import outside the exception set fails naming offender",
			packages: map[string][]string{
				module + "/features/companies/infrastructure/postgres": {
					module + "/features/candidates/domain/valueobjects",
				},
			},
			want: 1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckCrossFeatureImports(tt.packages)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
}

func TestGuard_RouteTopologyMutation(t *testing.T) {
	want := Topology{
		Public: []Route{{Method: "GET", Path: "/industries"}},
		Gated: []Route{
			{Method: "POST", Path: "/me/companies", Gated: true, Middleware: []string{"auth"}},
			{Method: "PUT", Path: "/me/candidates", Gated: true, Middleware: []string{"auth"}},
		},
	}
	tests := []struct {
		name string
		got  Topology
		want int
	}{
		{
			name: "gated route moved to the public mount fails",
			got: Topology{
				Public: []Route{
					{Method: "GET", Path: "/industries"},
					{Method: "POST", Path: "/me/companies"},
				},
				Gated: []Route{{Method: "PUT", Path: "/me/candidates", Gated: true, Middleware: []string{"auth"}}},
			},
			want: 1,
		},
		{
			name: "gated subtree middleware removed fails",
			got: Topology{
				Public: []Route{{Method: "GET", Path: "/industries"}},
				Gated: []Route{
					{Method: "POST", Path: "/me/companies", Gated: true},
					{Method: "PUT", Path: "/me/candidates", Gated: true, Middleware: []string{"auth"}},
				},
			},
			want: 1,
		},
		{
			name: "unchanged topology passes",
			got:  want,
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckRouteTopology(want, tt.got)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
}

func TestGuard_ErrorCatalogScan(t *testing.T) {
	tests := []struct {
		name  string
		files []SourceFile
		want  int
	}{
		{
			name: "ad-hoc code string literal outside httpjson fails",
			files: []SourceFile{{
				Path:    module + "/features/jobs/infrastructure/http/handler.go",
				Content: `w.WriteHeader(http.StatusNotFound)\njson.NewEncoder(w).Encode(map[string]string{"error": msg, "code": "not_found"})`,
			}},
			want: 1,
		},
		{
			name: "direct feature error-JSON write fails",
			files: []SourceFile{{
				Path:    module + "/features/companies/infrastructure/http/handler.go",
				Content: `w.Write([]byte("{\"error\": \"boom\"}"))`,
			}},
			want: 1,
		},
		{
			name: "catalog writer in a feature handler passes",
			files: []SourceFile{{
				Path:    module + "/features/jobs/infrastructure/http/handler.go",
				Content: `httpjson.WriteCatalogError(w, def, def.Message)`,
			}},
			want: 0,
		},
		{
			name: "code literals inside httpjson pass",
			files: []SourceFile{{
				Path:    module + "/shared/httpjson/errors.go",
				Content: `{"error": "conflict", "code": "conflict"}`,
			}},
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckErrorCatalogUsage(tt.files)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
}

func TestGuard_NonGoalScan(t *testing.T) {
	tests := []struct {
		name  string
		paths []string
		want  int
	}{
		{"new Dockerfile path fails", []string{"backend/Dockerfile"}, 1},
		{"new Terraform path fails", []string{"infra/main.tf"}, 1},
		{"new outbox package fails", []string{"internal/features/jobs/outbox/outbox.go"}, 1},
		{"new worker deployment resource fails", []string{"deploy/worker-lambda.yaml"}, 1},
		{"ordinary backend paths pass", []string{"internal/features/jobs/handler.go", "docs/ROADMAP.md"}, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckNonGoals(tt.paths)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
}

// traceRow builds a fully-anchored manifest row for (capability, title).
func traceRow(capability, title string) TraceabilityRow {
	return TraceabilityRow{
		Requirement: title,
		Capability:  capability,
		Tier:        "MUST",
		Owners:      []string{"backend/internal/x/service.go"},
		Evidence: RowEvidence{
			Path:    "backend/internal/x/service_test.go",
			Symbols: []string{"Service"},
			Tests:   []string{"TestService"},
		},
	}
}

// writeSpecFixture writes a capability spec.md under dir/capName/spec.md in a
// temporary fixture directory. The real openspec tree is never touched.
func writeSpecFixture(t *testing.T, dir, capName, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, capName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, capName, "spec.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestTraceability_StructuralMutations proves each structural manifest
// mutation fails the checker. The missing/extra-row cases compose the
// effective set from temporary canonical/delta fixture directories; the real
// backend/quality/traceability.json and real spec files are never touched.
func TestTraceability_StructuralMutations(t *testing.T) {
	tests := []struct {
		name     string
		check    func(t *testing.T) []Violation
		rule     string
		offender string
	}{
		{
			name: "duplicate requirement title fails",
			check: func(t *testing.T) []Violation {
				return CheckManifestStructure(TraceManifest{Rows: []TraceabilityRow{
					traceRow("jobs", "Status Domain"),
					traceRow("jobs", "Status Domain"),
				}})
			},
			rule:     ruleTraceDuplicateRequirement,
			offender: "Status Domain",
		},
		{
			name: "duplicate owner within a row fails",
			check: func(t *testing.T) []Violation {
				row := traceRow("identity", "JWT Middleware")
				row.Owners = []string{"backend/middleware.go", "backend/middleware.go"}
				return CheckManifestStructure(TraceManifest{Rows: []TraceabilityRow{row}})
			},
			rule:     ruleTraceDuplicateOwner,
			offender: "backend/middleware.go",
		},
		{
			name: "missing row fails",
			check: func(t *testing.T) []Violation {
				canonical, deltas := t.TempDir(), t.TempDir()
				writeSpecFixture(t, canonical, "jobs", "### Requirement: Alpha\n### Requirement: Beta\n")
				effective, err := ComposeEffectiveSet(canonical, deltas)
				if err != nil {
					t.Fatal(err)
				}
				return CheckManifestCoverage([]TraceabilityRow{traceRow("jobs", "Alpha")}, effective)
			},
			rule:     ruleTraceMissingRow,
			offender: "Beta",
		},
		{
			name: "extra row fails",
			check: func(t *testing.T) []Violation {
				canonical, deltas := t.TempDir(), t.TempDir()
				writeSpecFixture(t, canonical, "jobs", "### Requirement: Alpha\n")
				effective, err := ComposeEffectiveSet(canonical, deltas)
				if err != nil {
					t.Fatal(err)
				}
				rows := []TraceabilityRow{traceRow("jobs", "Alpha"), traceRow("jobs", "Ghost")}
				return CheckManifestCoverage(rows, effective)
			},
			rule:     ruleTraceExtraRow,
			offender: "Ghost",
		},
		{
			name: "zero anchors fail",
			check: func(t *testing.T) []Violation {
				row := traceRow("companies", "Public Company Create Endpoint")
				row.Evidence = RowEvidence{}
				return CheckManifestStructure(TraceManifest{Rows: []TraceabilityRow{row}})
			},
			rule:     ruleTraceZeroAnchors,
			offender: "Public Company Create Endpoint",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wantRuleNamed(t, tt.check(t), tt.rule, tt.offender)
		})
	}
}

// TestTraceability_EffectiveSetSixDeltas proves exact six-delta composition:
// canonical specs extend the set, delta ADDED requirements extend it, delta
// MODIFIED requirements replace the same canonical (capability, title)
// instead of duplicating it, and a delta-only capability (no canonical spec
// yet, e.g. industries) is tolerated.
func TestTraceability_EffectiveSetSixDeltas(t *testing.T) {
	canonical, deltas := t.TempDir(), t.TempDir()
	writeSpecFixture(t, canonical, "jobs", "### Requirement: Alpha\n### Requirement: Beta\n")
	writeSpecFixture(t, canonical, "candidates", "### Requirement: Gamma\n")
	writeSpecFixture(t, deltas, "backend-runtime", "## Requirements\n### Requirement: Runtime1\n")
	writeSpecFixture(t, deltas, "candidates",
		"## ADDED Requirements\n### Requirement: Delta1\n## MODIFIED Requirements\n### Requirement: Gamma\n")
	writeSpecFixture(t, deltas, "companies", "## ADDED Requirements\n### Requirement: Company1\n")
	writeSpecFixture(t, deltas, "identity", "## ADDED Requirements\n### Requirement: Identity1\n")
	writeSpecFixture(t, deltas, "industries", "## Requirements\n### Requirement: Industry1\n")
	writeSpecFixture(t, deltas, "jobs", "## MODIFIED Requirements\n### Requirement: Alpha\n")

	got, err := ComposeEffectiveSet(canonical, deltas)
	if err != nil {
		t.Fatal(err)
	}
	want := []EffectiveRequirement{
		{Capability: "backend-runtime", Title: "Runtime1"},
		{Capability: "candidates", Title: "Delta1"},
		{Capability: "candidates", Title: "Gamma"}, // MODIFIED replaced in place
		{Capability: "companies", Title: "Company1"},
		{Capability: "identity", Title: "Identity1"},
		{Capability: "industries", Title: "Industry1"}, // delta-only capability
		{Capability: "jobs", Title: "Alpha"},           // MODIFIED replaced, exactly once
		{Capability: "jobs", Title: "Beta"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ComposeEffectiveSet mismatch:\n got: %+v\nwant: %+v", got, want)
	}
}

// --- Task 7.2 TRIANGULATE Slice B: evidence-anchor resolution fixtures ---

// anchorServiceSource is the fixture .go file the anchor index is built from.
// It declares a symbol, a route literal, and a verbatim prose phrase, and
// mentions an undeclared identifier in a comment only (the prose/identifier
// boundary pin).
const anchorServiceSource = `package x

import "net/http"

// AnchorService documents the anchor prose phrase fixture for Slice B.
const AnchorRoute = "GET /anchor-route"

// AnchorMentionInComment is identifier-shaped but only mentioned here, never
// declared anywhere in the fixture tree.
func AnchorService(w http.ResponseWriter, r *http.Request) {}
`

// anchorTestSource is the fixture test file declaring the anchor test function.
const anchorTestSource = `package x

import "testing"

func TestAnchorService(t *testing.T) {}
`

// writeGoFixture writes a fixture .go file under dir (a temporary directory;
// the real backend tree and traceability.json are never touched).
func writeGoFixture(t *testing.T, dir, rel, content string) {
	t.Helper()
	p := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// anchorFixtureTree writes a repo-root-shaped fixture tree into a temporary
// directory and builds its anchor index.
func anchorFixtureTree(t *testing.T) AnchorIndex {
	t.Helper()
	root := t.TempDir()
	writeGoFixture(t, root, "backend/internal/x/service.go", anchorServiceSource)
	writeGoFixture(t, root, "backend/internal/x/service_test.go", anchorTestSource)
	idx, err := BuildAnchorIndex(root)
	if err != nil {
		t.Fatal(err)
	}
	return idx
}

// TestTraceability_AnchorMutations proves each unresolvable-anchor mutation
// fails the manifest checker with a named violation: an unresolvable evidence
// path, an undeclared identifier symbol, and a test selector matching zero
// test functions.
func TestTraceability_AnchorMutations(t *testing.T) {
	tests := []struct {
		name     string
		evidence RowEvidence
		rule     string
		offender string
	}{
		{
			name:     "unresolvable evidence path fails",
			evidence: RowEvidence{Path: "backend/internal/x/missing_test.go"},
			rule:     ruleTraceUnresolvablePath,
			offender: "backend/internal/x/missing_test.go",
		},
		{
			name:     "undeclared identifier symbol fails",
			evidence: RowEvidence{Symbols: []string{"NotDeclaredAnywhere"}},
			rule:     ruleTraceUnresolvableSymbol,
			offender: "NotDeclaredAnywhere",
		},
		{
			name:     "selector matching zero tests fails",
			evidence: RowEvidence{Tests: []string{"TestNeverWritten"}},
			rule:     ruleTraceSelectorNoMatches,
			offender: "TestNeverWritten",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			row := traceRow("x", "Anchor Mutations")
			row.Evidence = tt.evidence
			got := CheckManifestAnchors([]TraceabilityRow{row}, anchorFixtureTree(t))
			wantRuleNamed(t, got, tt.rule, tt.offender)
		})
	}
	t.Run("fully resolvable row passes", func(t *testing.T) {
		row := traceRow("x", "Anchor")
		row.Evidence = RowEvidence{
			Path:    "backend/internal/x/service_test.go",
			Symbols: []string{"AnchorService", "GET /anchor-route"},
			Tests:   []string{"TestAnchorService"},
		}
		if got := CheckManifestAnchors([]TraceabilityRow{row}, anchorFixtureTree(t)); len(got) != 0 {
			t.Fatalf("resolvable row reported violations: %+v", got)
		}
	})
}

// TestTraceability_AnchorBoundary pins the documented anchor-resolution
// boundary (Task 7.2 TRIANGULATE Slice B): descriptive prose resolves by
// verbatim occurrence in the tree and is never claimed to be a Go identifier;
// identifier-shaped tokens resolve only as declared symbols, even when the
// token occurs verbatim in a comment; subtest selectors resolve through their
// declared test function.
func TestTraceability_AnchorBoundary(t *testing.T) {
	idx := anchorFixtureTree(t)
	row := traceRow("x", "Anchor Boundary")

	t.Run("verbatim prose phrase resolves", func(t *testing.T) {
		r := row
		r.Evidence = RowEvidence{Symbols: []string{"anchor prose phrase fixture"}}
		if got := CheckManifestAnchors([]TraceabilityRow{r}, idx); len(got) != 0 {
			t.Fatalf("verbatim prose anchor rejected: %+v", got)
		}
	})

	t.Run("absent prose phrase fails", func(t *testing.T) {
		r := row
		r.Evidence = RowEvidence{Symbols: []string{"prose phrase that is in no file at all"}}
		wantRuleNamed(t, CheckManifestAnchors([]TraceabilityRow{r}, idx),
			ruleTraceUnresolvableSymbol, "prose phrase that is in no file at all")
	})

	t.Run("identifier-shaped comment mention is not falsely resolved", func(t *testing.T) {
		r := row
		r.Evidence = RowEvidence{Symbols: []string{"AnchorMentionInComment"}}
		wantRuleNamed(t, CheckManifestAnchors([]TraceabilityRow{r}, idx),
			ruleTraceUnresolvableSymbol, "AnchorMentionInComment")
	})

	t.Run("undeclared route fails", func(t *testing.T) {
		r := row
		r.Evidence = RowEvidence{Symbols: []string{"POST /never-declared"}}
		wantRuleNamed(t, CheckManifestAnchors([]TraceabilityRow{r}, idx),
			ruleTraceUnresolvableSymbol, "POST /never-declared")
	})

	t.Run("subtest selector resolves through its test function", func(t *testing.T) {
		r := row
		r.Evidence = RowEvidence{Tests: []string{"TestAnchorService/with_subtest"}}
		if got := CheckManifestAnchors([]TraceabilityRow{r}, idx); len(got) != 0 {
			t.Fatalf("subtest selector through declared test function rejected: %+v", got)
		}
	})

	t.Run("subtest under undeclared test function fails", func(t *testing.T) {
		r := row
		r.Evidence = RowEvidence{Tests: []string{"TestMissingAnchor/sub"}}
		wantRuleNamed(t, CheckManifestAnchors([]TraceabilityRow{r}, idx),
			ruleTraceSelectorNoMatches, "TestMissingAnchor/sub")
	})
}
