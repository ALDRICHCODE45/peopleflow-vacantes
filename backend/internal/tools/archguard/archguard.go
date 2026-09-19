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
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
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

// RowEvidence anchors one manifest row to the candidate tree: the RESOLVED
// evidence file path, Go/SQL symbols or routes, and exact test selectors.
type RowEvidence struct {
	Path    string   `json:"path"`
	Symbols []string `json:"symbols"`
	Tests   []string `json:"tests"`
}

// TraceabilityRow is one manifest row: one effective MUST with its owners and
// evidence anchors.
type TraceabilityRow struct {
	Requirement string      `json:"requirement"`
	Capability  string      `json:"capability"`
	Tier        string      `json:"tier"`
	Owners      []string    `json:"owners"`
	Evidence    RowEvidence `json:"evidence"`
}

// TraceManifest is the backend/quality/traceability.json document schema.
type TraceManifest struct {
	Schema string            `json:"schema"`
	Change string            `json:"change"`
	Rows   []TraceabilityRow `json:"rows"`
}

// Traceability rule identifiers for the checker core (Task 7.2 TRIANGULATE).
const (
	ruleTraceDuplicateRequirement = "traceability-duplicate-requirement"
	ruleTraceDuplicateOwner       = "traceability-duplicate-owner"
	ruleTraceMissingRow           = "traceability-missing-row"
	ruleTraceExtraRow             = "traceability-extra-row"
	ruleTraceZeroAnchors          = "traceability-zero-anchors"
)

// anchors counts the evidence anchors on a row: the evidence path, each
// symbol, and each test selector each count as one anchor.
func (r TraceabilityRow) anchors() int {
	n := len(r.Evidence.Symbols) + len(r.Evidence.Tests)
	if r.Evidence.Path != "" {
		n++
	}
	return n
}

// EffectiveRequirement identifies one effective MUST by (capability, title).
type EffectiveRequirement struct {
	Capability string
	Title      string
}

// CheckManifestStructure validates manifest-internal invariants: every
// (capability, requirement) pair is unique, owners are unique within their
// row, and every row carries at least one evidence anchor.
func CheckManifestStructure(m TraceManifest) []Violation {
	var violations []Violation
	seen := map[string]bool{}
	for _, row := range m.Rows {
		key := row.Capability + "\x00" + row.Requirement
		if seen[key] {
			violations = append(violations, Violation{
				Rule:   ruleTraceDuplicateRequirement,
				File:   row.Capability,
				Detail: fmt.Sprintf("duplicate manifest row for requirement %q in capability %q", row.Requirement, row.Capability),
			})
		}
		seen[key] = true
		owners := map[string]bool{}
		for _, owner := range row.Owners {
			if owners[owner] {
				violations = append(violations, Violation{
					Rule:   ruleTraceDuplicateOwner,
					File:   row.Capability + "/" + row.Requirement,
					Detail: fmt.Sprintf("duplicate owner %q in manifest row (%s, %q)", owner, row.Capability, row.Requirement),
				})
			}
			owners[owner] = true
		}
		if row.anchors() == 0 {
			violations = append(violations, Violation{
				Rule:   ruleTraceZeroAnchors,
				File:   row.Capability + "/" + row.Requirement,
				Detail: fmt.Sprintf("manifest row (%s, %q) has zero evidence anchors: path, symbols, and tests are all empty", row.Capability, row.Requirement),
			})
		}
	}
	sortViolations(violations)
	return violations
}

// CheckManifestCoverage compares manifest rows with the effective MUST set:
// every effective requirement MUST have exactly one manifest row and every
// manifest row MUST name an effective requirement.
func CheckManifestCoverage(rows []TraceabilityRow, effective []EffectiveRequirement) []Violation {
	var violations []Violation
	manifest := map[string]bool{}
	for _, row := range rows {
		manifest[row.Capability+"\x00"+row.Requirement] = true
	}
	effectiveSet := map[string]bool{}
	for _, e := range effective {
		key := e.Capability + "\x00" + e.Title
		effectiveSet[key] = true
		if !manifest[key] {
			violations = append(violations, Violation{
				Rule:   ruleTraceMissingRow,
				File:   e.Capability,
				Detail: fmt.Sprintf("no manifest row for effective MUST (%s, %q)", e.Capability, e.Title),
			})
		}
	}
	for _, row := range rows {
		key := row.Capability + "\x00" + row.Requirement
		if !effectiveSet[key] {
			violations = append(violations, Violation{
				Rule:   ruleTraceExtraRow,
				File:   row.Capability + "/" + row.Requirement,
				Detail: fmt.Sprintf("manifest row (%s, %q) is not in the effective MUST set", row.Capability, row.Requirement),
			})
		}
	}
	sortViolations(violations)
	return violations
}

// ComposeEffectiveSet composes the effective MUST set from the canonical
// capability specs (one directory per capability under canonicalDir) plus the
// active change deltas (one directory per capability under deltasDir). Delta
// titles under "## ADDED Requirements" extend the canonical set; titles under
// "## MODIFIED Requirements" REPLACE the canonical requirement with the same
// (capability, title) instead of duplicating it; titles under
// "## Requirements" contribute as additions, which tolerates capabilities
// whose canonical spec does not exist yet. Output is sorted by capability,
// then title.
func ComposeEffectiveSet(canonicalDir, deltasDir string) ([]EffectiveRequirement, error) {
	set := map[string]EffectiveRequirement{}
	order := []string{}
	add := func(capability, title string) {
		key := capability + "\x00" + title
		if _, ok := set[key]; !ok {
			set[key] = EffectiveRequirement{Capability: capability, Title: title}
			order = append(order, key)
		}
	}
	replace := func(capability, title string) {
		key := capability + "\x00" + title
		if _, ok := set[key]; !ok {
			order = append(order, key) // delta-only capability: no canonical spec yet
		}
		set[key] = EffectiveRequirement{Capability: capability, Title: title}
	}
	for _, specDir := range []struct {
		dir     string
		isDelta bool
	}{{canonicalDir, false}, {deltasDir, true}} {
		capDirs, err := os.ReadDir(specDir.dir)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", specDir.dir, err)
		}
		for _, c := range capDirs {
			if !c.IsDir() {
				continue
			}
			f, err := os.Open(filepath.Join(specDir.dir, c.Name(), "spec.md"))
			if err != nil {
				return nil, fmt.Errorf("opening spec for capability %s: %w", c.Name(), err)
			}
			added, modified, parseErr := parseDeltaRequirements(f)
			f.Close()
			if parseErr != nil {
				return nil, fmt.Errorf("parsing spec for capability %s: %w", c.Name(), parseErr)
			}
			for _, title := range added {
				add(c.Name(), title)
			}
			for _, title := range modified {
				if specDir.isDelta {
					replace(c.Name(), title)
				} else {
					add(c.Name(), title)
				}
			}
		}
	}
	out := make([]EffectiveRequirement, 0, len(order))
	for _, key := range order {
		out = append(out, set[key])
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Capability != out[j].Capability {
			return out[i].Capability < out[j].Capability
		}
		return out[i].Title < out[j].Title
	})
	return out, nil
}

// parseDeltaRequirements classifies delta requirement titles by their current
// top-level section: titles under "## ADDED Requirements" or "## Requirements"
// (or before any section header) count as additions, titles under
// "## MODIFIED Requirements" as replacements. Titles under other sections are
// not requirements of the effective set.
func parseDeltaRequirements(r io.Reader) (added, modified []string, err error) {
	sc := bufio.NewScanner(r)
	section := ""
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(line, "## ") {
			section = strings.TrimSpace(strings.TrimPrefix(line, "## "))
			continue
		}
		if !strings.HasPrefix(line, "### Requirement:") {
			continue
		}
		title := strings.TrimSpace(strings.TrimPrefix(line, "### Requirement:"))
		switch section {
		case "MODIFIED Requirements":
			modified = append(modified, title)
		case "ADDED Requirements", "Requirements", "":
			added = append(added, title)
		}
	}
	return added, modified, sc.Err()
}

// Anchor-resolution rule identifiers (Task 7.2 TRIANGULATE, Slice B).
const (
	ruleTraceUnresolvablePath   = "traceability-unresolvable-path"
	ruleTraceUnresolvableSymbol = "traceability-unresolvable-symbol"
	ruleTraceSelectorNoMatches  = "traceability-selector-no-matches"
)

// AnchorIndex is the resolved anchor inventory the manifest checker resolves
// evidence anchors against. It is built from a fixture copy of the repository
// (never the real tree) so manifest rows can be checked for resolvability.
type AnchorIndex struct {
	Paths    map[string]bool // repository-relative file/dir paths under the tree
	Symbols  map[string]bool // declared Go identifiers (func/method/type/const/var)
	Routes   map[string]bool // declared HTTP route literals "METHOD /path"
	Tests    map[string]bool // declared Go test function names
	Contents []string        // verbatim .go/.sql contents, for prose anchors
}

// Go declaration patterns used to index resolvable symbols. Top-level and
// grouped const/var entries, functions/methods, types, exact test functions,
// and HTTP route string literals are recognized.
var (
	goFuncRe  = regexp.MustCompile(`(?m)^func(?:\s+\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(`)
	goTypeRe  = regexp.MustCompile(`(?m)^type\s+([A-Za-z_][A-Za-z0-9_]*)\b`)
	goValueRe = regexp.MustCompile(`(?m)^(?:const|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b`)
	goGroupRe = regexp.MustCompile(`(?m)^\t([A-Za-z_][A-Za-z0-9_]*)\s*=`)
	goTestRe  = regexp.MustCompile(`(?m)^func\s+(Test[A-Za-z0-9_]+)\s*\(\s*[a-zA-Z_][A-Za-z0-9_]*\s+\*testing\.T`)
	goRouteRe = regexp.MustCompile(`"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/[^"]*"`)
	goIdentRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

// BuildAnchorIndex walks root (a fixture copy shaped like the repository root)
// and indexes every resolvable anchor:
//
//   - every repository-relative file or directory path under root;
//   - every declared Go identifier in any .go file (functions, methods,
//     types, top-level and grouped const/var names);
//   - every exact Go test function name declared in any .go file;
//   - every HTTP route string literal "METHOD /path" found in any .go file;
//   - the verbatim content of .go and .sql files, for descriptive prose
//     anchors. Generated Markdown and prose docs can never satisfy an anchor
//     check (design A1), so they are deliberately not indexed.
func BuildAnchorIndex(root string) (AnchorIndex, error) {
	idx := AnchorIndex{
		Paths:   map[string]bool{},
		Symbols: map[string]bool{},
		Routes:  map[string]bool{},
		Tests:   map[string]bool{},
	}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == ".git" {
			// Only a real .git directory may be skipped as a subtree. In a
			// linked Git worktree the root .git is a regular file, and
			// filepath.WalkDir reads SkipDir on a non-directory entry as
			// "skip the remaining files of the containing directory", which
			// would drop every ordinary root sibling from the index.
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		idx.Paths[rel] = true
		if d.IsDir() {
			return nil
		}
		switch {
		case strings.HasSuffix(rel, ".go"), strings.HasSuffix(rel, ".sql"):
			data, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			idx.Contents = append(idx.Contents, string(data))
			if strings.HasSuffix(rel, ".go") {
				indexGoDeclarations(string(data), idx)
			}
		}
		return nil
	})
	if err != nil {
		return AnchorIndex{}, fmt.Errorf("building anchor index from %s: %w", root, err)
	}
	return idx, nil
}

// indexGoDeclarations feeds every resolvable Go anchor of src into idx.
func indexGoDeclarations(src string, idx AnchorIndex) {
	for _, m := range goFuncRe.FindAllStringSubmatch(src, -1) {
		idx.Symbols[m[1]] = true
	}
	for _, m := range goTypeRe.FindAllStringSubmatch(src, -1) {
		idx.Symbols[m[1]] = true
	}
	for _, m := range goValueRe.FindAllStringSubmatch(src, -1) {
		idx.Symbols[m[1]] = true
	}
	for _, m := range goGroupRe.FindAllStringSubmatch(src, -1) {
		idx.Symbols[m[1]] = true
	}
	for _, m := range goTestRe.FindAllStringSubmatch(src, -1) {
		idx.Tests[m[1]] = true
	}
	for _, m := range goRouteRe.FindAllStringSubmatch(src, -1) {
		idx.Routes[strings.Trim(m[0], `"`)] = true
	}
}

// Anchor resolution rule (documented, deterministic — Task 7.2 TRIANGULATE,
// Slice B):
//
//   - The evidence path must exist as a repository-relative path in the
//     indexed tree (files or directories).
//   - A symbol anchor resolves when it is a declared Go identifier, a declared
//     HTTP route, or a non-identifier phrase that appears verbatim in the
//     indexed .go/.sql content.
//   - A test anchor resolves when its exact selector matches at least one
//     declared test function; the selector may name a subtest after "/", and
//     the test function before "/" must be declared.
//
// The prose/identifier boundary: an identifier-shaped anchor is NEVER resolved
// through the verbatim-phrase rule. A token that looks like a Go identifier
// but is not declared anywhere is unresolvable even when the token occurs in a
// comment or string literal — the checker does not falsely claim prose is a Go
// symbol. Conversely, a phrase containing spaces or punctuation is descriptive
// prose and is never claimed to be a Go identifier; it resolves only by
// verbatim occurrence.
func CheckManifestAnchors(rows []TraceabilityRow, idx AnchorIndex) []Violation {
	var violations []Violation
	for _, row := range rows {
		where := row.Capability + "/" + row.Requirement
		if p := row.Evidence.Path; p != "" && !idx.Paths[p] {
			violations = append(violations, Violation{
				Rule: ruleTraceUnresolvablePath,
				File: where,
				Detail: fmt.Sprintf(
					"manifest row (%s, %q) anchors path %q that does not exist in the candidate tree",
					row.Capability, row.Requirement, p,
				),
			})
		}
		for _, s := range row.Evidence.Symbols {
			if resolvesSymbol(s, idx) {
				continue
			}
			violations = append(violations, Violation{
				Rule: ruleTraceUnresolvableSymbol,
				File: where,
				Detail: fmt.Sprintf(
					"manifest row (%s, %q) anchors symbol %q that resolves to nothing: it is not a declared Go identifier, not a declared HTTP route, and does not occur verbatim in the tree",
					row.Capability, row.Requirement, s,
				),
			})
		}
		for _, sel := range row.Evidence.Tests {
			if resolvesSelector(sel, idx.Tests) {
				continue
			}
			violations = append(violations, Violation{
				Rule: ruleTraceSelectorNoMatches,
				File: where,
				Detail: fmt.Sprintf(
					"manifest row (%s, %q) anchors test selector %q matching zero test functions in the tree",
					row.Capability, row.Requirement, sel,
				),
			})
		}
	}
	sortViolations(violations)
	return violations
}

// resolvesSymbol applies the documented symbol-anchor rule.
func resolvesSymbol(anchor string, idx AnchorIndex) bool {
	if idx.Symbols[anchor] || idx.Routes[anchor] {
		return true
	}
	if goIdentRe.MatchString(anchor) {
		return false // identifier-shaped: never resolved via prose occurrence
	}
	return containsPhrase(idx.Contents, anchor)
}

// resolvesSelector reports whether the exact test selector matches at least
// one declared test function; the base before "/" must be declared.
func resolvesSelector(selector string, tests map[string]bool) bool {
	if tests[selector] {
		return true
	}
	base, _, hasSub := strings.Cut(selector, "/")
	return hasSub && tests[base]
}

// containsPhrase reports whether phrase occurs verbatim in any indexed
// content blob.
func containsPhrase(contents []string, phrase string) bool {
	for _, c := range contents {
		if strings.Contains(c, phrase) {
			return true
		}
	}
	return false
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
