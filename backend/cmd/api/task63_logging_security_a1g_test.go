package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

func TestTask63A1g_CompositionDirectLiteralKeys(t *testing.T) {
	t.Run("rejects a seeded forbidden terminal key", func(t *testing.T) {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, compositionFile, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", compositionFile, err)
		}
		seeded := false
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || !isPkgSelector(call.Fun, "slog", "Error") || len(call.Args) < 2 {
				return true
			}
			if key, ok := call.Args[1].(*ast.BasicLit); ok && key.Value == `"code_class"` {
				key.Value = `"token"`
				seeded = true
			}
			return true
		})
		if !seeded {
			t.Fatal("expected to seed the terminal slog.Error key")
		}
		got := t63A1gForbiddenDirectLiteralKeys(fset, file)
		want := `main.go:44:31: T63-A1G forbidden direct slog key "token"`
		if len(got) != 1 || got[0] != want {
			t.Fatalf("findings = %q, want [%q]", got, want)
		}
	})

	t.Run("traverses typed startup logger keys", func(t *testing.T) {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, compositionFile, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", compositionFile, err)
		}
		startup := findFuncDecl(file, "logStartupConfig")
		call := startup.Body.List[0].(*ast.ExprStmt).X.(*ast.CallExpr)
		var want []string
		for i := 1; i < len(call.Args); i += 2 {
			key := call.Args[i].(*ast.BasicLit)
			pos := fset.Position(key.Pos())
			key.Value = `"token"`
			want = append(want, fmt.Sprintf("%s:%d:%d: T63-A1G forbidden direct slog key %q", pos.Filename, pos.Line, pos.Column, "token"))
		}
		got := t63A1gForbiddenDirectLiteralKeys(fset, file)
		if len(got) != len(want) {
			t.Fatalf("findings = %q, want %q", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("finding %d = %q, want %q", i, got[i], want[i])
			}
		}
	})

	t.Run("accepts current terminal and startup records", func(t *testing.T) {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, compositionFile, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", compositionFile, err)
		}
		if got := t63A1gForbiddenDirectLiteralKeys(fset, file); len(got) != 0 {
			t.Fatalf("findings = %q, want none", got)
		}
	})
}

// t63A1gForbiddenDirectLiteralKeys scans direct literal keys in composition-root slog records.
func t63A1gForbiddenDirectLiteralKeys(fset *token.FileSet, file *ast.File) []string {
	if fset == nil || file == nil {
		return nil
	}
	var findings []string
	scan := func(call *ast.CallExpr, api string) {
		_, attrsIndex, _ := t63A1bArgumentBoundaries(api)
		if attrsIndex == 0 {
			return
		}
		for i := attrsIndex; i < len(call.Args); i += 2 {
			key, ok := t63A1cFirstLiteralKey(call, i)
			if !ok || !t63A1fForbiddenLiteralKey(key) {
				continue
			}
			pos := fset.Position(call.Args[i].Pos())
			findings = append(findings, fmt.Sprintf("%s:%d:%d: T63-A1G forbidden direct slog key %q", pos.Filename, pos.Line, pos.Column, t63A1fNormalizeLiteralKey(key)))
		}
	}
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if ok {
			if sel, ok := call.Fun.(*ast.SelectorExpr); ok && isPkgSelector(call.Fun, "slog", sel.Sel.Name) {
				scan(call, sel.Sel.Name)
			}
		}
		return true
	})
	startup := findFuncDecl(file, "logStartupConfig")
	if startup == nil || startup.Type.Params == nil {
		return findings
	}
	logger := false
	for _, field := range startup.Type.Params.List {
		for _, name := range field.Names {
			if name.Name == "logger" {
				if ptr, ok := field.Type.(*ast.StarExpr); ok && isPkgSelector(ptr.X, "slog", "Logger") {
					logger = true
				}
			}
		}
	}
	if !logger {
		return findings
	}
	ast.Inspect(startup.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if id, ok := sel.X.(*ast.Ident); ok && id.Name == "logger" {
			scan(call, sel.Sel.Name)
		}
		return true
	})
	return findings
}
