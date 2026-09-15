// Package archguard enforces the backend-runtime Architecture Guard rules
// (design A1): forbidden cross-feature imports, the exact documented narrow
// exceptions, route topology against composition-root drift, error-catalog
// usage, and the locked non-goals.
//
// GREEN (Task 7.2 / WS7B, Slice A): every guard below is deterministic and
// reports concrete violations naming the offender. The focused command
// `go test ./internal/tools/archguard -run '^TestGuard_' -count=1` is the
// pass criterion for this slice.
package archguard

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path"
	"slices"
	"sort"
	"strings"
)

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

const (
	ruleCrossFeatureImport = "cross-feature-infrastructure-import"
	ruleRouteTopologyDrift = "route-topology-drift"
	ruleAdhocCodeLiteral   = "error-catalog-adhoc-code"
	ruleDirectErrorWrite   = "error-catalog-direct-write"
	ruleNonGoal            = "locked-non-goal-path"

	httpjsonPkgMarker = "/shared/httpjson"
	featuresMarker    = "/features/"
)

// featureOf extracts the feature segment of an internal feature-owned package
// path (.../features/<name>/...). It returns "" for paths that are not
// feature-owned (shared, runtime, external).
func featureOf(pkg string) string {
	i := strings.Index(pkg, featuresMarker)
	if i < 0 {
		return ""
	}
	rest := pkg[i+len(featuresMarker):]
	if j := strings.Index(rest, "/"); j >= 0 {
		return rest[:j]
	}
	return rest
}

// isExcepted reports whether the import path is exactly one of the documented
// exceptions, matched after the module prefix. No wildcards.
func isExcepted(importPath string) bool {
	for _, ex := range DocumentedExceptions {
		if importPath == ex || strings.HasSuffix(importPath, "/"+ex) {
			return true
		}
	}
	return false
}

// sortViolations makes guard output deterministic regardless of map
// iteration order.
func sortViolations(violations []Violation) {
	sort.Slice(violations, func(i, j int) bool {
		if violations[i].File != violations[j].File {
			return violations[i].File < violations[j].File
		}
		if violations[i].Rule != violations[j].Rule {
			return violations[i].Rule < violations[j].Rule
		}
		return violations[i].Detail < violations[j].Detail
	})
}

// CheckCrossFeatureImports reports imports of another feature's packages
// outside the exact DocumentedExceptions set, naming the offender. Feature
// code may not reach into a sibling feature's internals — infrastructure or
// otherwise — unless the import is an exactly documented exception.
func CheckCrossFeatureImports(packages map[string][]string) []Violation {
	var violations []Violation
	for pkg, imports := range packages {
		pkgFeature := featureOf(pkg)
		if pkgFeature == "" {
			continue
		}
		for _, imp := range imports {
			if isExcepted(imp) {
				continue
			}
			impFeature := featureOf(imp)
			if impFeature == "" || impFeature == pkgFeature {
				continue
			}
			violations = append(violations, Violation{
				Rule: ruleCrossFeatureImport,
				File: pkg,
				Detail: fmt.Sprintf(
					"feature %q imports cross-feature package %q (owned by feature %q); only DocumentedExceptions are allowed",
					pkgFeature, imp, impFeature,
				),
			})
		}
	}
	sortViolations(violations)
	return violations
}

// routeKey identifies a route by method and path.
func routeKey(r Route) string {
	return r.Method + " " + r.Path
}

// CheckRouteTopology reports route-topology drift against the declared
// composition root: a gated write route moved onto a public mount, a gated
// route missing from the gated subtree, or a required middleware removed
// from a gated route.
func CheckRouteTopology(want, got Topology) []Violation {
	gotPublic := make(map[string]Route, len(got.Public))
	for _, r := range got.Public {
		gotPublic[routeKey(r)] = r
	}
	gotGated := make(map[string]Route, len(got.Gated))
	for _, r := range got.Gated {
		gotGated[routeKey(r)] = r
	}

	var violations []Violation
	for _, w := range want.Gated {
		if !w.Gated {
			continue
		}
		key := routeKey(w)
		if _, onPublic := gotPublic[key]; onPublic {
			violations = append(violations, Violation{
				Rule:   ruleRouteTopologyDrift,
				File:   key,
				Detail: fmt.Sprintf("gated route %q moved onto a public mount; it must stay behind the authenticated subtree", key),
			})
			continue
		}
		g, present := gotGated[key]
		if !present {
			violations = append(violations, Violation{
				Rule:   ruleRouteTopologyDrift,
				File:   key,
				Detail: fmt.Sprintf("gated route %q missing from the gated subtree", key),
			})
			continue
		}
		for _, mw := range w.Middleware {
			if !slices.Contains(g.Middleware, mw) {
				violations = append(violations, Violation{
					Rule:   ruleRouteTopologyDrift,
					File:   key,
					Detail: fmt.Sprintf("required middleware %q removed from gated route %q", mw, key),
				})
			}
		}
	}
	sortViolations(violations)
	return violations
}

// CheckErrorCatalogUsage rejects ad-hoc `code` string literals outside
// internal/shared/httpjson and direct error-JSON byte writes outside the
// catalog writer. Files under internal/shared/httpjson own the catalog and
// are the only place raw error/code literals are allowed.
func CheckErrorCatalogUsage(files []SourceFile) []Violation {
	var violations []Violation
	for _, f := range files {
		inHTTPJSON := strings.Contains(f.Path, httpjsonPkgMarker)
		if inHTTPJSON {
			continue
		}
		if strings.Contains(f.Content, `"code"`) {
			violations = append(violations, Violation{
				Rule:   ruleAdhocCodeLiteral,
				File:   f.Path,
				Detail: `ad-hoc "code" string literal outside internal/shared/httpjson; use the httpjson error-catalog writers`,
			})
		}
		if strings.Contains(f.Content, `w.Write([]byte(`) && strings.Contains(f.Content, `"error`) {
			violations = append(violations, Violation{
				Rule:   ruleDirectErrorWrite,
				File:   f.Path,
				Detail: "direct error-JSON byte write outside internal/shared/httpjson; use the httpjson error-catalog writers",
			})
		}
	}
	sortViolations(violations)
	return violations
}

// CheckNonGoals rejects newly introduced locked non-goal paths for this
// closure: Docker, Terraform, workers, outbox, and deployment-resource paths.
func CheckNonGoals(paths []string) []Violation {
	var violations []Violation
	for _, p := range paths {
		rule := nonGoalRule(p)
		if rule == "" {
			continue
		}
		violations = append(violations, Violation{
			Rule:   ruleNonGoal,
			File:   p,
			Detail: fmt.Sprintf("path matches locked non-goal %q for this closure", rule),
		})
	}
	sortViolations(violations)
	return violations
}

// nonGoalRule returns the non-goal category a path belongs to, or "" when the
// path is allowed. First match wins so a path yields at most one violation.
func nonGoalRule(p string) string {
	base := path.Base(p)
	switch {
	case strings.HasPrefix(base, "Dockerfile"):
		return "docker"
	case strings.HasSuffix(p, ".tf"):
		return "terraform"
	case containsSegment(p, "outbox"):
		return "outbox"
	case firstSegment(p) == "deploy" || containsSegment(p, "deploy"):
		return "deployment-resource"
	case strings.Contains(p, "worker"):
		return "workers"
	default:
		return ""
	}
}

// containsSegment reports whether a path contains dir as a complete path
// segment.
func containsSegment(p, dir string) bool {
	return strings.HasPrefix(p, dir+"/") || strings.Contains(p, "/"+dir+"/")
}

// firstSegment returns the first path segment of p.
func firstSegment(p string) string {
	if i := strings.Index(p, "/"); i >= 0 {
		return p[:i]
	}
	return p
}

// CheckRepositoryImports runs `go list -json ./...` in workdir, builds the
// package import graph, and feeds it to CheckCrossFeatureImports.
func CheckRepositoryImports(workdir string) ([]Violation, error) {
	cmd := exec.Command("go", "list", "-json", "./...")
	cmd.Dir = workdir
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("go list -json ./... in %s: %w", workdir, err)
	}

	packages := make(map[string][]string)
	dec := json.NewDecoder(bytes.NewReader(out))
	for {
		var pkg struct {
			ImportPath string
			Imports    []string
		}
		if err := dec.Decode(&pkg); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, fmt.Errorf("decoding go list output: %w", err)
		}
		if pkg.ImportPath != "" {
			packages[pkg.ImportPath] = pkg.Imports
		}
	}
	return CheckCrossFeatureImports(packages), nil
}
