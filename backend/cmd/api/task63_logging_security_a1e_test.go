package main

import (
	"go/ast"
	"go/token"
	"testing"
)

func TestTask63A1e_APITerminalFailureLogIsBounded(t *testing.T) {
	f := mustParse(t, compositionFile)
	mainFn := findFuncDecl(f, "main")
	if mainFn == nil {
		t.Fatalf("%s must declare main", compositionFile)
	}
	var branch *ast.IfStmt
	for _, stmt := range mainFn.Body.List {
		candidate, ok := stmt.(*ast.IfStmt)
		if !ok {
			continue
		}
		init, ok := candidate.Init.(*ast.AssignStmt)
		if !ok || len(init.Rhs) != 1 {
			continue
		}
		call, ok := init.Rhs[0].(*ast.CallExpr)
		if !ok {
			continue
		}
		if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "run" {
			branch = candidate
		}
	}
	if branch == nil {
		t.Fatal("main must contain the terminal run failure branch")
	}
	literal := func(e ast.Expr, kind token.Token, want string) bool {
		lit, ok := e.(*ast.BasicLit)
		return ok && lit.Kind == kind && lit.Value == want
	}

	errors, exits := 0, 0
	ast.Inspect(branch.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch {
		case isPkgSelector(call.Fun, "slog", "Error"):
			errors++
			if len(call.Args) != 3 || !literal(call.Args[0], token.STRING, `"server failed"`) || !literal(call.Args[1], token.STRING, `"code_class"`) || !literal(call.Args[2], token.STRING, `"internal_error"`) {
				t.Fatal("terminal slog.Error must be Error severity with message and literal attributes: server failed, code_class=internal_error")
			}
		case isPkgSelector(call.Fun, "os", "Exit"):
			exits++
			if len(call.Args) != 1 || !literal(call.Args[0], token.INT, "1") {
				t.Fatal("terminal os.Exit must be exactly os.Exit(1)")
			}
		}
		return true
	})
	if errors != 1 || exits != 1 {
		t.Fatalf("terminal branch must have one slog.Error and one os.Exit(1), got %d and %d", errors, exits)
	}
}
