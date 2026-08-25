package entities

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// TestActorTypeVocabulary pins the closed actor vocabulary (design D3): the
// two constants String() to their canonical DB wire values, and the AST guard
// proves this package declares exactly those two ActorType-typed constants —
// the closure is enforced by the typed-constant surface (the only sanctioned
// way to obtain an ActorType is one of these constants), mirrored at the DB
// boundary by the audit_events_actor_type_check CHECK. An out-of-vocabulary
// ActorType can never be produced through the package surface.
func TestActorTypeVocabulary(t *testing.T) {
	if got := ActorTypeUser.String(); got != "user" {
		t.Errorf("ActorTypeUser.String(): want %q, got %q", "user", got)
	}
	if got := ActorTypeSystem.String(); got != "system" {
		t.Errorf("ActorTypeSystem.String(): want %q, got %q", "system", got)
	}
	if ActorTypeUser == ActorTypeSystem {
		t.Error("ActorTypeUser and ActorTypeSystem must be distinct values")
	}

	want := map[ActorType]bool{ActorTypeUser: true, ActorTypeSystem: true}
	got := actorTypeConstantValues(t)
	if len(got) != len(want) {
		t.Errorf("ActorType vocabulary must contain exactly %d values (%s), got %d (%s)",
			len(want), sortedActorKeys(want), len(got), sortedActorKeys(got))
	}
	for v := range want {
		if !got[v] {
			t.Errorf("ActorType vocabulary: missing declared constant for %q", v.String())
		}
	}
}

// TestEventVocabularyIsClosed pins the closed event-type set (design D3 + the
// audit_events spec "Event Type Vocabulary" requirement): the domain exposes
// exactly ApplicationSubmitted and ApplicationTransitioned, and an AST guard
// walks backend/internal/features/** proving no other emit call site contains
// either literal — the only file allowed to declare them is this package's
// auditEvent.go (event_type deliberately has no DB CHECK, so the closure is a
// code-level invariant enforced here).
func TestEventVocabularyIsClosed(t *testing.T) {
	if got := EventApplicationSubmitted; got != "ApplicationSubmitted" {
		t.Errorf("EventApplicationSubmitted: want %q, got %q", "ApplicationSubmitted", got)
	}
	if got := EventApplicationTransitioned; got != "ApplicationTransitioned" {
		t.Errorf("EventApplicationTransitioned: want %q, got %q", "ApplicationTransitioned", got)
	}
	if EventApplicationSubmitted == EventApplicationTransitioned {
		t.Error("the two event-type constants must be distinct")
	}

	// The untyped string-constant surface of this package is exactly the two
	// event types plus EntityApplication. A third event constant would fail
	// here — the closed set for this cycle is a deliberate code change.
	want := map[string]bool{
		EventApplicationSubmitted:    true,
		EventApplicationTransitioned: true,
		EntityApplication:            true,
	}
	got := stringConstantValues(t)
	if len(got) != len(want) {
		t.Errorf("untyped string-constant surface: want exactly %d values (%s), got %d (%s)",
			len(want), sortedKeys(want), len(got), sortedKeys(got))
	}
	for k := range want {
		if !got[k] {
			t.Errorf("untyped string-constant surface: missing %q", k)
		}
	}

	// Emit guard: no production Go file under backend/internal/features/**
	// (outside this package) may contain an event-type literal.
	violations := eventTypeEmitLiteralsOutsideEntities(t)
	if len(violations) > 0 {
		for _, v := range violations {
			t.Errorf("event_type emit literal found outside the entities package: %s", v)
		}
	}
}

// actorTypeConstantValues parses this package's non-test Go files (the test
// runs with the package directory as CWD) and returns the literal value of
// every constant declared with the ActorType type.
func actorTypeConstantValues(t *testing.T) map[ActorType]bool {
	t.Helper()
	values := map[ActorType]bool{}
	for _, file := range parseThisPackage(t) {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				ident, ok := vs.Type.(*ast.Ident)
				if !ok || ident.Name != "ActorType" {
					continue
				}
				for _, value := range vs.Values {
					values[ActorType(stringLit(t, value))] = true
				}
			}
		}
	}
	return values
}

// stringConstantValues parses this package's non-test Go files and returns
// the literal value of every untyped string constant (no explicit type).
func stringConstantValues(t *testing.T) map[string]bool {
	t.Helper()
	values := map[string]bool{}
	for _, file := range parseThisPackage(t) {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok || vs.Type != nil {
					continue
				}
				for _, value := range vs.Values {
					values[stringLit(t, value)] = true
				}
			}
		}
	}
	return values
}

// parseThisPackage parses every non-test .go file in this package's directory
// into an *ast.File.
func parseThisPackage(t *testing.T) []*ast.File {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	fset := token.NewFileSet()
	var files []*ast.File
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		files = append(files, file)
	}
	return files
}

// stringLit unquotes a string BasicLit expression.
func stringLit(t *testing.T, expr ast.Expr) string {
	t.Helper()
	lit, ok := expr.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		t.Fatalf("expected a string literal, got %T", expr)
	}
	s, err := strconv.Unquote(lit.Value)
	if err != nil {
		t.Fatalf("unquote %s: %v", lit.Value, err)
	}
	return s
}

// featuresRootFromEntities is backend/internal/features relative to this
// package (entities → domain → audit_events → features).
const featuresRootFromEntities = "../../.."

// eventTypeEmitLiteralsOutsideEntities walks backend/internal/features/**
// parsing every non-test Go file and returns the source position of any
// "ApplicationSubmitted" / "ApplicationTransitioned" string literal found
// outside this package (audit_events/domain/entities), i.e. any emit call
// site that is not the constants declaration itself.
func eventTypeEmitLiteralsOutsideEntities(t *testing.T) []string {
	t.Helper()
	entitiesDir := filepath.Join(featuresRootFromEntities, "audit_events", "domain", "entities")
	var violations []string
	fset := token.NewFileSet()
	err := filepath.WalkDir(featuresRootFromEntities, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			return nil
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		absEntities, err := filepath.Abs(entitiesDir)
		if err != nil {
			return err
		}
		if abs == absEntities || strings.HasPrefix(abs, absEntities+string(filepath.Separator)) {
			return nil
		}
		file, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			value, uerr := strconv.Unquote(lit.Value)
			if uerr != nil {
				return true
			}
			if value == "ApplicationSubmitted" || value == "ApplicationTransitioned" {
				violations = append(violations, fset.Position(lit.Pos()).String())
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk backend/internal/features: %v", err)
	}
	return violations
}

// sortedActorKeys / sortedKeys render map keys deterministically for error
// messages.
func sortedActorKeys(m map[ActorType]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k.String())
	}
	sort.Strings(keys)
	return keys
}

func sortedKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
