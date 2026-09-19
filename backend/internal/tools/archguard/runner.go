// Runner for the gate-arch target (Task 7.2 REFACTOR, design §9):
// CheckRepository runs the gate-level archguard suite against the real
// repository — cross-feature import guard, error-catalog usage scan, locked
// non-goal scan, and traceability manifest structure/coverage — so a passing
// gate-arch means zero unexplained traceability-manifest rows.
//
// Anchor policy: gate-arch enforces the mechanically decidable anchor kinds
// (evidence path existence, test-selector matches). Full per-symbol anchor
// resolution, including descriptive prose anchors, is the WS7C report unit's
// traceability validation (design §10.2 condition 1), not a gate-level
// criterion. The route topology guard is delegated by the gate target to the
// pinned router-owner test (TestRouteTopology_ExactRegistrations), which owns
// the exact (method, path, gating) topology of the composition root.
package archguard

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// RepositoryLayout locates the two roots the repository validator walks:
// Backend is the Go module root (contains go.mod) and Repo is the repository
// root containing openspec/ and backend/.
type RepositoryLayout struct {
	Backend string
	Repo    string
}

// DetectLayout resolves the layout from a start directory (typically the gate
// script's CWD): it walks up to the backend module root, then requires the
// repository root one level above with an openspec/ directory.
func DetectLayout(start string) (RepositoryLayout, error) {
	backend, err := filepath.Abs(start)
	if err != nil {
		return RepositoryLayout{}, err
	}
	for {
		if _, err := os.Stat(filepath.Join(backend, "go.mod")); err == nil {
			break
		}
		parent := filepath.Dir(backend)
		if parent == backend {
			return RepositoryLayout{}, fmt.Errorf("no go.mod found at or above %s", start)
		}
		backend = parent
	}
	repo := filepath.Dir(backend)
	if _, err := os.Stat(filepath.Join(repo, "openspec")); err != nil {
		return RepositoryLayout{}, fmt.Errorf("repository root %s has no openspec/ directory", repo)
	}
	return RepositoryLayout{Backend: backend, Repo: repo}, nil
}

// LoadTraceManifest reads and decodes backend/quality/traceability.json.
func LoadTraceManifest(path string) (TraceManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return TraceManifest{}, fmt.Errorf("reading traceability manifest %s: %w", path, err)
	}
	var m TraceManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return TraceManifest{}, fmt.Errorf("decoding traceability manifest %s: %w", path, err)
	}
	if m.Change == "" {
		return TraceManifest{}, fmt.Errorf("traceability manifest %s has no change field", path)
	}
	return m, nil
}

// checkGateAnchors enforces the mechanically decidable anchor kinds at gate
// level: every evidence path must exist in the candidate tree and every test
// selector must match at least one declared test function. Descriptive symbol
// anchors are resolved by the WS7C report unit (design §10.2).
func checkGateAnchors(rows []TraceabilityRow, idx AnchorIndex) []Violation {
	var violations []Violation
	for _, v := range CheckManifestAnchors(rows, idx) {
		if v.Rule == ruleTraceUnresolvableSymbol {
			continue
		}
		violations = append(violations, v)
	}
	return violations
}

// CheckRepository runs the gate-level archguard suite over the real repository
// and returns every violation (empty slice means the repository is clean):
//
//   - cross-feature imports via go list -json ./... in the backend module;
//   - error-catalog usage over non-test .go sources under internal/features;
//   - locked non-goals over backend file paths;
//   - traceability manifest structure and coverage against the effective MUST
//     set composed from canonical openspec specs plus this change's deltas —
//     zero unexplained manifest rows.
func CheckRepository(layout RepositoryLayout) ([]Violation, error) {
	var violations []Violation
	importV, err := CheckRepositoryImports(layout.Backend)
	if err != nil {
		return nil, err
	}
	violations = append(violations, importV...)

	files, err := featureSourceFiles(layout.Backend)
	if err != nil {
		return nil, err
	}
	violations = append(violations, CheckErrorCatalogUsage(files)...)

	paths, err := backendFilePaths(layout.Backend)
	if err != nil {
		return nil, err
	}
	violations = append(violations, CheckNonGoals(paths)...)

	manifest, err := LoadTraceManifest(filepath.Join(layout.Backend, "quality", "traceability.json"))
	if err != nil {
		return nil, err
	}
	violations = append(violations, CheckManifestStructure(manifest)...)
	effective, err := ComposeEffectiveSet(
		filepath.Join(layout.Repo, "openspec", "specs"),
		filepath.Join(layout.Repo, "openspec", "changes", manifest.Change, "specs"),
	)
	if err != nil {
		return nil, err
	}
	violations = append(violations, CheckManifestCoverage(manifest.Rows, effective)...)

	index, err := BuildAnchorIndex(layout.Repo)
	if err != nil {
		return nil, err
	}
	violations = append(violations, checkGateAnchors(manifest.Rows, index)...)
	return violations, nil
}

// EvidenceScan is the split real-tree observation the closure report consumes
// for the two independent native criteria: the locked non-goal path scan
// (criterion 10) and the architecture guard scan (criterion 11). The two
// results are observed independently: an empty slice is a real observation of
// that domain only, and neither slice can stand in for the other.
type EvidenceScan struct {
	NonGoal      []Violation
	Architecture []Violation
}

// ScanEvidence runs the two real-tree scans behind the closure report's
// independent C10/C11 observations, reusing the package's private tree
// collectors and the repository import scan:
//
//   - NonGoal is the locked non-goal path scan over every backend file path.
//   - Architecture is the design A1 native source observation: the forbidden
//     cross-feature import guard over the repository package graph, plus the
//     error-catalog rules over non-test feature sources (ad-hoc `code` literals
//     and direct error-JSON writes).
//
// Scope boundary: route topology is owned by the pinned router-owner test
// (TestRouteTopology_ExactRegistrations) and is therefore gate-level evidence
// through the required gate-arch receipt, which the report requires as a passing
// same-identity receipt. It is deliberately NOT re-derived from test-only AST
// truth here, and no other architecture domain is delegated to a receipt: the
// import guard is observed natively. A failed collector or a failed import scan
// returns an error and no observations, so an unobserved domain can never be
// mistaken for a clean one.
func ScanEvidence(layout RepositoryLayout) (EvidenceScan, error) {
	paths, err := backendFilePaths(layout.Backend)
	if err != nil {
		return EvidenceScan{}, err
	}
	files, err := featureSourceFiles(layout.Backend)
	if err != nil {
		return EvidenceScan{}, err
	}
	imports, err := CheckRepositoryImports(layout.Backend)
	if err != nil {
		return EvidenceScan{}, err
	}
	architecture := append(imports, CheckErrorCatalogUsage(files)...)
	sortViolations(architecture)
	return EvidenceScan{
		NonGoal:      CheckNonGoals(paths),
		Architecture: architecture,
	}, nil
}

// featureSourceFiles collects non-test .go files under internal/features.
func featureSourceFiles(backend string) ([]SourceFile, error) {
	var files []SourceFile
	root := filepath.Join(backend, "internal", "features")
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		content, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(backend, p)
		if err != nil {
			return err
		}
		files = append(files, SourceFile{Path: filepath.ToSlash(rel), Content: string(content)})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walking feature sources under %s: %w", root, err)
	}
	return files, nil
}

// backendFilePaths collects every file path under the backend module (skipping
// .git), slash-separated and backend-relative, for the non-goal scan.
func backendFilePaths(backend string) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(backend, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(backend, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == ".git" || strings.HasPrefix(rel, ".git/") {
			return filepath.SkipDir
		}
		if d.IsDir() {
			return nil
		}
		paths = append(paths, rel)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walking backend paths under %s: %w", backend, err)
	}
	return paths, nil
}
