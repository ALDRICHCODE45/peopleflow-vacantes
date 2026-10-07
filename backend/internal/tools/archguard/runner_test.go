package archguard

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// requirementSpec renders the spec.md body for a set of requirement titles.
func requirementSpec(titles ...string) string {
	var b strings.Builder
	for _, title := range titles {
		b.WriteString("### Requirement: " + title + "\n")
	}
	return b.String()
}

// runnerFixture writes a minimal, self-contained repository shaped like the
// real one into a temporary root and returns the layout CheckRepository
// observes. It carries one backend capability (jobs) whose manifest rows are
// fully anchored, and, when foreignSpec is non-empty, one capability owned by
// another product (public-job-discovery). Only the temporary root is walked and
// only its fixture manifest is read: the real repository tree and the real
// traceability.json are never touched.
func runnerFixture(t *testing.T, jobsSpec, foreignSpec []string, rows []TraceabilityRow) RepositoryLayout {
	t.Helper()
	root := t.TempDir()
	backend := filepath.Join(root, "backend")
	writeGoFixture(t, backend, "go.mod", "module fixture\n\ngo 1.26\n")
	writeGoFixture(t, backend, "internal/features/jobs/infrastructure/http/handler.go",
		"package http\n\n// ListJobs is clean feature source: no ad-hoc code literal.\nfunc ListJobs() {}\n")
	writeGoFixture(t, backend, "internal/x/service.go",
		"package x\n\n// Service is the fixture evidence symbol.\nfunc Service() {}\n")
	writeGoFixture(t, backend, "internal/x/service_test.go",
		"package x\n\nimport \"testing\"\n\nfunc TestService(t *testing.T) {}\n")

	manifest, err := json.Marshal(TraceManifest{Schema: "traceability/v1", Change: "fixture-change", Rows: rows})
	if err != nil {
		t.Fatal(err)
	}
	writeGoFixture(t, backend, "quality/traceability.json", string(manifest))

	specs := filepath.Join(root, "openspec", "specs")
	writeSpecFixture(t, specs, "jobs", requirementSpec(jobsSpec...))
	if len(foreignSpec) > 0 {
		writeSpecFixture(t, specs, "public-job-discovery", requirementSpec(foreignSpec...))
	}
	// ComposeEffectiveSet reads the deltas directory, so it must exist; an empty
	// delta set is a valid observation.
	if err := os.MkdirAll(filepath.Join(root, "openspec", "changes", "fixture-change", "specs"), 0o755); err != nil {
		t.Fatal(err)
	}
	return RepositoryLayout{Backend: backend, Repo: root}
}

// TestCheckRepository_ScopesCoverageToBackendCapabilities is the root-class
// regression for gate-arch reporting another product's capabilities as missing
// backend manifest rows: the composed effective MUST set comes from the global
// openspec/specs tree, so the backend owner must scope the observation to the
// capabilities the backend closure owns before evaluating coverage. The scope
// must stay capability-based, so an added, missing, or repeated requirement
// inside an owned capability remains detectable.
func TestCheckRepository_ScopesCoverageToBackendCapabilities(t *testing.T) {
	t.Run("foreign frontend capability is ignored by the backend owner", func(t *testing.T) {
		layout := runnerFixture(t,
			[]string{"Alpha"},
			[]string{"Public Vacancy Routes", "Frontend Verification Coverage"},
			[]TraceabilityRow{traceRow("jobs", "Alpha")},
		)
		violations, err := CheckRepository(layout)
		if err != nil {
			t.Fatalf("CheckRepository over a complete fixture tree: %v", err)
		}
		for _, v := range violations {
			if strings.Contains(v.File, "public-job-discovery") || strings.Contains(v.Detail, "public-job-discovery") {
				t.Fatalf("backend gate-arch reported a foreign frontend capability: %+v", v)
			}
		}
		if len(violations) != 0 {
			t.Fatalf("clean backend fixture produced violations: %+v", violations)
		}
	})

	t.Run("missing requirement in an owned capability is still detected", func(t *testing.T) {
		layout := runnerFixture(t,
			[]string{"Alpha", "Beta"},
			nil,
			[]TraceabilityRow{traceRow("jobs", "Alpha")},
		)
		violations, err := CheckRepository(layout)
		if err != nil {
			t.Fatalf("CheckRepository over a complete fixture tree: %v", err)
		}
		wantRuleNamed(t, violations, ruleTraceMissingRow, "Beta")
	})

	t.Run("added manifest row in an owned capability is still detected", func(t *testing.T) {
		layout := runnerFixture(t,
			[]string{"Alpha"},
			nil,
			[]TraceabilityRow{traceRow("jobs", "Alpha"), traceRow("jobs", "Ghost")},
		)
		violations, err := CheckRepository(layout)
		if err != nil {
			t.Fatalf("CheckRepository over a complete fixture tree: %v", err)
		}
		wantRuleNamed(t, violations, ruleTraceExtraRow, "Ghost")
	})

	t.Run("backend manifest cannot claim a foreign capability row", func(t *testing.T) {
		layout := runnerFixture(t,
			[]string{"Alpha"},
			[]string{"Public Vacancy Routes"},
			[]TraceabilityRow{traceRow("jobs", "Alpha"), traceRow("public-job-discovery", "Public Vacancy Routes")},
		)
		violations, err := CheckRepository(layout)
		if err != nil {
			t.Fatalf("CheckRepository over a complete fixture tree: %v", err)
		}
		wantRuleNamed(t, violations, ruleTraceExtraRow, "public-job-discovery")
	})
}

// TestScopeToBackendCapabilities_ClosedAndCapabilityBased pins the source-owned
// scope helper shared by the gate-arch runner and the closure report: a
// requirement in an owned capability is kept, a requirement in any other
// capability is dropped, and the decision is capability-based rather than
// title-based (an unknown title inside an owned capability is still kept so its
// drift stays detectable).
func TestScopeToBackendCapabilities_ClosedAndCapabilityBased(t *testing.T) {
	observed := []EffectiveRequirement{
		{Capability: "jobs", Title: "Alpha"},
		{Capability: "jobs", Title: "Unplanned Jobs Requirement"},
		{Capability: "public-job-discovery", Title: "Alpha"},
		{Capability: "public-job-discovery", Title: "Frontend Only"},
		{Capability: "not-a-backend-capability", Title: "Ghost"},
	}
	want := []EffectiveRequirement{
		{Capability: "jobs", Title: "Alpha"},
		{Capability: "jobs", Title: "Unplanned Jobs Requirement"},
	}
	got := ScopeToBackendCapabilities(observed)
	if len(got) != len(want) {
		t.Fatalf("ScopeToBackendCapabilities = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("ScopeToBackendCapabilities[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
	if !isBackendCapability("jobs") {
		t.Errorf("isBackendCapability(jobs) = false, want true")
	}
	if isBackendCapability("public-job-discovery") || isBackendCapability("not-a-backend-capability") {
		t.Errorf("isBackendCapability must reject capabilities outside the closed backend scope")
	}
}

// TestBackendCapabilities_PinnedToRealManifest pins the source-owned backend
// capability scope against the real backend traceability manifest, the document
// CheckRepository guards: every manifest row must belong to a backend
// capability and every declared backend capability must be carried by at least
// one manifest row. The scope and the manifest it guards therefore cannot drift
// apart silently. It reads the real manifest read-only.
func TestBackendCapabilities_PinnedToRealManifest(t *testing.T) {
	layout, err := DetectLayout(".")
	if err != nil {
		t.Fatalf("detecting the repository layout from the package directory: %v", err)
	}
	manifest, err := LoadTraceManifest(filepath.Join(layout.Backend, "quality", "traceability.json"))
	if err != nil {
		t.Fatalf("loading the real traceability manifest: %v", err)
	}

	manifestCaps := map[string]bool{}
	for _, row := range manifest.Rows {
		manifestCaps[row.Capability] = true
		if !isBackendCapability(row.Capability) {
			t.Errorf("manifest row (%s, %q) belongs to capability %q outside the closed backend scope", row.Capability, row.Requirement, row.Capability)
		}
	}
	declared := map[string]bool{}
	for _, capability := range BackendCapabilities {
		if declared[capability] {
			t.Fatalf("dup capability %q in BackendCapabilities", capability)
		}
		declared[capability] = true
		if !manifestCaps[capability] {
			t.Errorf("backend capability %q has no manifest row; the scope must match the manifest it guards", capability)
		}
	}
}
