package entities

import (
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
)

var wantCategories = []Category{
	CategorySession, CategorySensitiveRead, CategoryCandidate, CategoryVacancy, CategoryPipeline,
	CategoryTeam, CategoryCompany, CategoryMembers, CategoryAudit,
}

// TestCatalogShape pins the closed category vocabulary (audit-log-v1 §8.2) and
// the invariants every catalog entry must satisfy.
func TestCatalogShape(t *testing.T) {
	for i, c := range Categories() {
		if c != wantCategories[i] {
			t.Fatalf("Categories()[%d]: want %q, got %q", i, wantCategories[i], c)
		}
	}
	if len(Categories()) != len(wantCategories) {
		t.Fatalf("Categories(): want %d, got %d", len(wantCategories), len(Categories()))
	}
	valid := map[Category]bool{}
	for _, c := range wantCategories {
		valid[c] = true
	}
	seen := map[string]bool{}
	for _, spec := range Catalog() {
		if spec.Type == "" || seen[spec.Type] {
			t.Errorf("catalog entry %q is empty or duplicated", spec.Type)
		}
		seen[spec.Type] = true
		if !valid[spec.Category] {
			t.Errorf("%s: category %q is outside the closed set", spec.Type, spec.Category)
		}
		if got, ok := LookupEvent(spec.Type); !ok || got.Type != spec.Type {
			t.Errorf("%s: LookupEvent must find every catalog entry", spec.Type)
		}
	}
	if _, ok := LookupEvent("NoSuchEvent"); ok {
		t.Error("LookupEvent must not find an unknown type")
	}
}

// TestCatalogEveryTypeHasAConstant proves the catalog and the exported Event*
// constants are the same set: no emitter can use a type the catalog lacks, and
// no constant exists outside the catalog.
func TestCatalogEveryTypeHasAConstant(t *testing.T) {
	constants := eventConstantValues(t)
	catalog := map[string]bool{}
	for _, spec := range Catalog() {
		catalog[spec.Type] = true
		if !constants[spec.Type] {
			t.Errorf("catalog type %q has no exported Event* constant", spec.Type)
		}
	}
	for value := range constants {
		if !catalog[value] {
			t.Errorf("Event* constant %q is not in the catalog", value)
		}
	}
}

// TestCatalogCompanyScope: every type is company-scoped except the candidate
// account creation, which has no company (audit-log-v1 §1).
func TestCatalogCompanyScope(t *testing.T) {
	for _, spec := range Catalog() {
		want := spec.Type != EventCandidateAccountCreated
		if spec.CompanyScoped != want {
			t.Errorf("%s: CompanyScoped want %v, got %v", spec.Type, want, spec.CompanyScoped)
		}
	}
}

// TestCatalogPreRegistersSlice2aTypes pins the T5 types and the export event
// with the metadata keys of the contract (§2, §3, §5, §8.5).
func TestCatalogPreRegistersSlice2aTypes(t *testing.T) {
	want := map[string]struct {
		category Category
		keys     []string
	}{
		EventSessionStarted:                   {CategorySession, nil},
		EventSessionEnded:                     {CategorySession, nil},
		EventCompanyCandidateViewed:           {CategorySensitiveRead, []string{"kind"}},
		EventCompanyCandidateCVDownloaded:     {CategorySensitiveRead, []string{"kind", "participation_id", "variant"}},
		EventCompanyCandidateContactsRevealed: {CategorySensitiveRead, []string{"candidates", "count"}},
		EventParticipationViewed:              {CategorySensitiveRead, nil},
		EventParticipationCVDownloaded:        {CategorySensitiveRead, []string{"variant"}},
		EventCompanyMemberAdded:               {CategoryMembers, []string{"member_user_id", "role"}},
		EventCompanyMemberRoleChanged:         {CategoryMembers, []string{"from_role", "member_user_id", "to_role"}},
		EventAuditLogExported:                 {CategoryAudit, []string{"filters", "row_count"}},
	}
	for eventType, w := range want {
		spec, ok := LookupEvent(eventType)
		if !ok {
			t.Errorf("%s: not registered", eventType)
			continue
		}
		if spec.Category != w.category {
			t.Errorf("%s: category want %q, got %q", eventType, w.category, spec.Category)
		}
		got := append([]string(nil), spec.MetadataKeys...)
		sort.Strings(got)
		if strings.Join(got, ",") != strings.Join(w.keys, ",") {
			t.Errorf("%s: metadata keys want %v, got %v", eventType, w.keys, got)
		}
	}
}

// TestCatalogIsOrderedAndCopied: the list for the 2b types endpoint is stable
// (grouped by category in the closed order) and callers cannot mutate it.
func TestCatalogIsOrderedAndCopied(t *testing.T) {
	rank := map[Category]int{}
	for i, c := range wantCategories {
		rank[c] = i
	}
	last := -1
	for _, spec := range Catalog() {
		if rank[spec.Category] < last {
			t.Fatalf("%s: catalog is not grouped in category order", spec.Type)
		}
		last = rank[spec.Category]
	}
	first := Catalog()
	first[0].Type = "Mutated"
	first[0].MetadataKeys = append(first[0].MetadataKeys, "x")
	if Catalog()[0].Type == "Mutated" {
		t.Error("Catalog() must return a copy")
	}
}

func companyID() *uuid.UUID { id := uuid.New(); return &id }

func TestValidateRefusals(t *testing.T) {
	cases := []struct {
		name  string
		event AuditEvent
		want  error
	}{
		{"unknown type", AuditEvent{EventType: "NoSuchEvent", CompanyID: companyID()}, ErrUnknownEventType},
		{"empty type", AuditEvent{CompanyID: companyID()}, ErrUnknownEventType},
		{"company-scoped without company", AuditEvent{EventType: EventCompanyUpdated}, ErrCompanyRequired},
		{"metadata key outside the set", AuditEvent{EventType: EventCompanyUpdated, CompanyID: companyID(), Metadata: map[string]string{"name": "ACME"}}, ErrMetadataKeyNotAllowed},
		{"structured metadata key outside the set", AuditEvent{EventType: EventCompanyUpdated, CompanyID: companyID(), StructuredMetadata: map[string]any{"email": "a@b.c"}}, ErrMetadataKeyNotAllowed},
		{"structured metadata wins over legacy map", AuditEvent{EventType: EventCompanyDeleted, CompanyID: companyID(), Metadata: map[string]string{"jobs_closed": "0"}, StructuredMetadata: map[string]any{"bad": 1}}, ErrMetadataKeyNotAllowed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.event.Validate()
			if !errors.Is(err, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
		})
	}
}

// TestValidateErrorNeverEchoesValues: the refusal names the key, never its value.
func TestValidateErrorNeverEchoesValues(t *testing.T) {
	err := AuditEvent{EventType: EventCompanyUpdated, CompanyID: companyID(), Metadata: map[string]string{"name": "SECRET-VALUE"}}.Validate()
	if err == nil || strings.Contains(err.Error(), "SECRET-VALUE") {
		t.Fatalf("error must exist and not echo the value, got %v", err)
	}
}

func TestValidateAccepts(t *testing.T) {
	cases := []struct {
		name  string
		event AuditEvent
	}{
		{"company-scoped with company, no metadata", AuditEvent{EventType: EventCompanyUpdated, CompanyID: companyID(), Metadata: map[string]string{}}},
		{"nil metadata", AuditEvent{EventType: EventCompanyDeleted, CompanyID: companyID()}},
		{"allowed legacy keys", AuditEvent{EventType: EventCompanyDeleted, CompanyID: companyID(), Metadata: map[string]string{"jobs_closed": "2"}}},
		{"allowed structured keys", AuditEvent{EventType: EventCompanyCandidateEdited, CompanyID: companyID(), StructuredMetadata: map[string]any{"fields": []string{"phone"}}}},
		{"non-company type without company", AuditEvent{EventType: EventCandidateAccountCreated, Metadata: map[string]string{}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.event.Validate(); err != nil {
				t.Fatalf("want accepted, got %v", err)
			}
		})
	}
}

// TestNoEventTypeLiteralOutsideEntities: emitters use the catalog constants;
// no production file outside this package may spell a catalog event type.
func TestNoEventTypeLiteralOutsideEntities(t *testing.T) {
	types := map[string]bool{}
	for _, spec := range Catalog() {
		types[spec.Type] = true
	}
	entitiesDir, err := filepath.Abs(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	err = filepath.WalkDir(featuresRootFromEntities, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		if filepath.Dir(abs) == entitiesDir {
			return nil
		}
		file, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			if value, uerr := strconv.Unquote(lit.Value); uerr == nil && types[value] {
				t.Errorf("event type literal %q outside the entities package: %s", value, fset.Position(lit.Pos()))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// eventConstantValues returns every untyped string constant named Event* in
// this package's non-test files.
func eventConstantValues(t *testing.T) map[string]bool {
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
				for i, name := range vs.Names {
					if strings.HasPrefix(name.Name, "Event") {
						values[stringLit(t, vs.Values[i])] = true
					}
				}
			}
		}
	}
	return values
}

// pendingEmitters are catalog types registered ahead of their emitters. Add an
// entry for a type whose emitter lands in a later slice; remove it when the
// emitter does, from then on the type must be referenced by production code.
// Empty since MetricsDetailViewed was emitted by the metrics read API (3c).
var pendingEmitters = map[string]bool{}

// TestEveryCatalogTypeHasAnEmitter: a catalog type nobody references is either
// dead or an emitter still using a different spelling. Production code outside
// this package must reference an Event* constant for every non-pending type.
func TestEveryCatalogTypeHasAnEmitter(t *testing.T) {
	names := map[string]string{} // constant name -> value
	for _, file := range parseThisPackage(t) {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, s := range gen.Specs {
				vs, ok := s.(*ast.ValueSpec)
				if !ok || vs.Type != nil {
					continue
				}
				for i, n := range vs.Names {
					if strings.HasPrefix(n.Name, "Event") {
						names[n.Name] = stringLit(t, vs.Values[i])
					}
				}
			}
		}
	}
	entitiesDir, err := filepath.Abs(".")
	if err != nil {
		t.Fatal(err)
	}
	referenced := map[string]bool{}
	fset := token.NewFileSet()
	err = filepath.WalkDir(featuresRootFromEntities, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		if filepath.Dir(abs) == entitiesDir {
			return nil
		}
		file, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			if sel, ok := n.(*ast.SelectorExpr); ok {
				if value, known := names[sel.Sel.Name]; known {
					referenced[value] = true
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, spec := range Catalog() {
		switch {
		case pendingEmitters[spec.Type] && referenced[spec.Type]:
			t.Errorf("%s has an emitter now: drop it from pendingEmitters", spec.Type)
		case !pendingEmitters[spec.Type] && !referenced[spec.Type]:
			t.Errorf("%s is in the catalog but no production code references its constant", spec.Type)
		}
	}
}
