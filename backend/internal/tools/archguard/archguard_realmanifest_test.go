package archguard

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Pinned delivered non-test sources of the companies active-industry gate row.
const (
	atomicGateSQLSource = "backend/db/queries/companies.sql"
	atomicGateGoSource  = "backend/internal/features/companies/infrastructure/postgres/companyRepository.go"
)

// TestRealManifest_CompaniesAtomicIndustryGateAnchorsAreOwnerBacked is the WS7C
// regression for the companies active-industry gate row: BuildAnchorIndex indexes
// _test.go text, so that row's old design-prose anchors resolved through a fixture
// while proving nothing shipped. It must cite exactly the two approved anchors,
// each accepted by the production rule and present in its pinned non-test source.
func TestRealManifest_CompaniesAtomicIndustryGateAnchorsAreOwnerBacked(t *testing.T) {
	const (
		capability  = "companies"
		requirement = "Atomic Active-Industry Create Gate"
	)
	layout, err := DetectLayout(".")
	if err != nil {
		t.Fatalf("detecting the repository layout from the package directory: %v", err)
	}
	manifest, err := LoadTraceManifest(filepath.Join(layout.Backend, "quality", "traceability.json"))
	if err != nil {
		t.Fatalf("loading the real traceability manifest: %v", err)
	}

	anchors := []string{"active_industry AS MATERIALIZED", "ErrIndustryUnavailable"}
	sources := map[string]string{
		anchors[0]: atomicGateSQLSource,
		anchors[1]: atomicGateGoSource,
	}
	var matches []TraceabilityRow
	for _, row := range manifest.Rows {
		if row.Capability == capability && row.Requirement == requirement {
			matches = append(matches, row)
		}
	}
	if len(matches) != 1 {
		t.Fatalf("manifest must declare exactly one (%s, %q) row, found %d", capability, requirement, len(matches))
	}
	if got := matches[0].Evidence.Symbols; !slices.Equal(got, anchors) {
		t.Fatalf("row (%s, %q) symbols = %q, want exactly %q", capability, requirement, got, anchors)
	}

	idx, err := BuildAnchorIndex(layout.Repo)
	if err != nil {
		t.Fatalf("building the repository anchor index: %v", err)
	}
	for _, anchor := range anchors {
		t.Run(anchor, func(t *testing.T) {
			if !resolvesSymbol(anchor, idx) {
				t.Errorf("anchor %q fails the production anchor rule", anchor)
			}
			source := sources[anchor]
			data, err := os.ReadFile(filepath.Join(layout.Repo, filepath.FromSlash(source)))
			if err != nil || strings.HasSuffix(source, "_test.go") || !strings.Contains(string(data), anchor) {
				t.Errorf("anchor %q must come from the pinned non-test source %s, never test-harness text (read error: %v)", anchor, source, err)
			}
		})
	}
}
