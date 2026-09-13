package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type t63A1hCall struct {
	File, API, Class string
	Forbidden        []string
}

const (
	t63A1hDirect      = "direct_literal_keys"
	t63A1hUninspected = "dynamic_or_spread_attrs_uninspected"
)

func TestTask63A1h_RuntimeHandlerSlogCallCensus(t *testing.T) {
	calls := t63A1hProductCensus(t)
	if len(calls) != 15 {
		t.Fatalf("slog terminal calls = %d, want 15", len(calls))
	}
	manifest := map[string]int{}
	direct, uninspected := 0, 0
	for _, call := range calls {
		manifest[call.File+"|"+call.API+"|"+call.Class]++
		if call.Class == t63A1hDirect {
			direct++
			if len(call.Forbidden) != 0 {
				t.Fatalf("forbidden direct literal keys in %s: %v", call.File, call.Forbidden)
			}
		} else if call.Class == t63A1hUninspected {
			uninspected++
		}
	}
	if direct != 7 || uninspected != 8 {
		t.Fatalf("direct/uninspected = %d/%d, want 7/8", direct, uninspected)
	}
	want := map[string]int{
		"backend/internal/runtime/health/health.go|ErrorContext|" + t63A1hDirect:                                        1,
		"backend/internal/runtime/middleware/request.go|Info|" + t63A1hDirect:                                           1,
		"backend/internal/runtime/server/server.go|Info|" + t63A1hDirect:                                                1,
		"backend/internal/features/applications/infrastructure/http/applicationHandler.go|ErrorContext|" + t63A1hDirect: 1,
		"backend/internal/features/candidates/infrastructure/http/handler.go|Error|" + t63A1hUninspected:                5,
		"backend/internal/features/companies/infrastructure/http/handler.go|ErrorContext|" + t63A1hDirect:               1,
		"backend/internal/features/identity/infrastructure/http/middleware.go|Debug|" + t63A1hUninspected:               1,
		"backend/internal/features/identity/infrastructure/http/requireCompanyRole.go|Error|" + t63A1hDirect:            2,
		"backend/internal/features/industries/infrastructure/http/handler.go|Error|" + t63A1hUninspected:                1,
		"backend/internal/features/jobs/infrastructure/http/jobHandler.go|Error|" + t63A1hUninspected:                   1,
	}
	if !reflect.DeepEqual(manifest, want) {
		t.Errorf("manifest = %#v, want %#v", manifest, want)
	}
}

func TestTask63A1h_SeededRuntimeHandlerForbiddenDirectKey(t *testing.T) {
	calls := t63A1hScanSource(t, "seed.go", `package p; import "log/slog"; func f() { slog.Info("x", "token", "synthetic") }`)
	if len(calls) != 1 || calls[0].Class != t63A1hDirect || !reflect.DeepEqual(calls[0].Forbidden, []string{"token"}) {
		t.Fatalf("seeded call = %#v, want one direct forbidden token finding", calls)
	}
}

func TestTask63A1h_RecordsDynamicAttrsAsUninspected(t *testing.T) {
	calls := t63A1hScanSource(t, "dynamic.go", `package p; import "log/slog"; func f(attrs []any) { slog.Error("x", attrs...) }`)
	if len(calls) != 1 || calls[0].Class != t63A1hUninspected || len(calls[0].Forbidden) != 0 {
		t.Fatalf("dynamic call = %#v, want explicitly uninspected without a safety claim", calls)
	}
}

func t63A1hProductCensus(t *testing.T) []t63A1hCall {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	backend := filepath.Clean(filepath.Join(wd, "../.."))
	var calls []t63A1hCall
	err = filepath.WalkDir(filepath.Join(backend, "internal"), func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return walkErr
		}
		rel, err := filepath.Rel(backend, path)
		if err != nil || !t63A1hInScope(filepath.ToSlash(rel)) {
			return err
		}
		calls = append(calls, t63A1hScanFile(t, path, "backend/"+filepath.ToSlash(rel))...)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return calls
}

func t63A1hScanSource(t *testing.T, name, src string) []t63A1hCall {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, name, src, 0)
	if err != nil {
		t.Fatal(err)
	}
	return t63A1hScanAST(file, name)
}

func t63A1hScanFile(t *testing.T, path, label string) []t63A1hCall {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	return t63A1hScanAST(file, label)
}

func t63A1hInScope(path string) bool {
	parts := strings.Split(path, "/")
	return strings.HasPrefix(path, "internal/runtime/") || len(parts) >= 5 && parts[0] == "internal" && parts[1] == "features" && parts[3] == "infrastructure" && parts[4] == "http"
}

func t63A1hScanAST(file *ast.File, label string) []t63A1hCall {
	aliases, loggers := map[string]bool{}, map[string]bool{}
	for _, imp := range file.Imports {
		if imp.Path.Value != `"log/slog"` {
			continue
		}
		name := "slog"
		if imp.Name != nil {
			name = imp.Name.Name
		}
		aliases[name] = true
	}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Type.Params == nil {
			continue
		}
		for _, field := range fn.Type.Params.List {
			star, ok := field.Type.(*ast.StarExpr)
			if !ok {
				continue
			}
			sel, ok := star.X.(*ast.SelectorExpr)
			if !ok {
				continue
			}
			ident, named := sel.X.(*ast.Ident)
			if !named || !aliases[ident.Name] || sel.Sel.Name != "Logger" {
				continue
			}
			for _, name := range field.Names {
				loggers[name.Name] = true
			}
		}
	}
	attrs := map[string]int{"Debug": 1, "Info": 1, "Warn": 1, "Error": 1, "DebugContext": 2, "InfoContext": 2, "WarnContext": 2, "ErrorContext": 2, "Log": 3, "LogAttrs": 3}
	var calls []t63A1hCall
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		index, supported := attrs[sel.Sel.Name]
		receiver, named := sel.X.(*ast.Ident)
		if !supported || !named || (!aliases[receiver.Name] && !loggers[receiver.Name]) {
			return true
		}
		result := t63A1hCall{File: label, API: sel.Sel.Name, Class: t63A1hDirect}
		if call.Ellipsis.IsValid() {
			result.Class = t63A1hUninspected
		} else {
			for i := index; i < len(call.Args); i += 2 {
				key, literal := t63A1cFirstLiteralKey(call, i)
				if !literal {
					result.Class = t63A1hUninspected
					result.Forbidden = nil
					break
				}
				if t63A1fForbiddenLiteralKey(key) {
					result.Forbidden = append(result.Forbidden, t63A1fNormalizeLiteralKey(key))
				}
			}
		}
		calls = append(calls, result)
		return true
	})
	return calls
}
