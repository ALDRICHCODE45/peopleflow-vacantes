package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

const t63A1kJobsFile = "../../internal/features/jobs/infrastructure/http/jobHandler.go"

func TestTask63A1k_JobsDynamicAttrs(t *testing.T) {
	file := t63A1kParse(t, t63A1kJobsFile, nil)
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "classifyAndWriteError" {
			continue
		}
		if len(fn.Body.List) == 0 || !t63A1kDefinition(fn.Body.List[0]) {
			t.Fatal("classifyAndWriteError must classify err before logging")
		}
		calls, invalid, total := t63A1kScan(fn.Body)
		if calls != 1 || invalid != 0 || total != 1 {
			t.Fatalf("internal calls/invalid/total slog errors = %d/%d/%d, want 1/0/1", calls, invalid, total)
		}
		return
	}
	t.Fatal("classifyAndWriteError not found")
}

func TestTask63A1k_AttrsSafetyFixtures(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantInvalid int
	}{
		{name: "accepts bounded attrs", body: `attrs := []any{"code_class", def.Code}; if reqID := chimw.GetReqID(r.Context()); reqID != "" { attrs = append(attrs, "request_id", reqID) }; slog.Error("jobs handler failed", attrs...)`},
		{name: "rejects error key", body: `attrs := []any{"error", def.Code}; slog.Error("jobs handler failed", attrs...)`, wantInvalid: 1},
		{name: "rejects err key", body: `attrs := []any{"err", def.Code}; slog.Error("jobs handler failed", attrs...)`, wantInvalid: 1},
		{name: "rejects token key", body: `attrs := []any{"token", def.Code}; slog.Error("jobs handler failed", attrs...)`, wantInvalid: 1},
		{name: "rejects raw path", body: `attrs := []any{"code_class", def.Code}; attrs = append(attrs, "path", r.URL.Path); slog.Error("jobs handler failed", attrs...)`, wantInvalid: 1},
		{name: "rejects raw error", body: `attrs := []any{"code_class", err}; slog.Error("jobs handler failed", attrs...)`, wantInvalid: 1},
		{name: "rejects unguarded request ID", body: `attrs := []any{"code_class", def.Code}; attrs = append(attrs, "request_id", chimw.GetReqID(r.Context())); slog.Error("jobs handler failed", attrs...)`, wantInvalid: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := `package fixture; func f() { def := classifyError(err); if def.Status == http.StatusInternalServerError {` + tt.body + `} }`
			file := t63A1kParse(t, tt.name+".go", src)
			calls, invalid, total := t63A1kScan(file.Decls[0].(*ast.FuncDecl).Body)
			if calls != 1 || total != 1 || invalid != tt.wantInvalid {
				t.Fatalf("calls/invalid/total = %d/%d/%d, want 1/%d/1", calls, invalid, total, tt.wantInvalid)
			}
		})
	}
}

func t63A1kParse(t *testing.T, name string, src any) *ast.File {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), name, src, 0)
	if err != nil {
		t.Fatal(err)
	}
	return file
}

func t63A1kScan(root *ast.BlockStmt) (calls, invalid, total int) {
	ast.Inspect(root, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if ok && t63A1jSelector(call.Fun, "slog", "Error") {
			total++
		}
		return true
	})
	for _, stmt := range root.List {
		guard, ok := stmt.(*ast.IfStmt)
		if !ok || !t63A1kInternalError(guard.Cond) {
			continue
		}
		for i, nested := range guard.Body.List {
			if t63A1kErrorCall(nested) == nil {
				continue
			}
			calls++
			if !t63A1kSpread(nested) || !t63A1kSafe(guard.Body.List[:i]) {
				invalid++
			}
		}
	}
	return calls, invalid, total
}

func t63A1kDefinition(stmt ast.Stmt) bool {
	call := t63A1jCall(t63A1jAssignment(stmt, token.DEFINE, "def"), "", "classifyError")
	return call != nil && len(call.Args) == 1 && t63A1jIdent(call.Args[0], "err")
}

func t63A1kInternalError(expr ast.Expr) bool {
	comparison, ok := expr.(*ast.BinaryExpr)
	return ok && comparison.Op == token.EQL && t63A1jSelector(comparison.X, "def", "Status") &&
		t63A1jSelector(comparison.Y, "http", "StatusInternalServerError")
}

func t63A1kErrorCall(stmt ast.Stmt) *ast.CallExpr {
	expr, ok := stmt.(*ast.ExprStmt)
	if !ok {
		return nil
	}
	return t63A1jCall(expr.X, "slog", "Error")
}

func t63A1kSpread(stmt ast.Stmt) bool {
	call := t63A1kErrorCall(stmt)
	return call != nil && call.Ellipsis.IsValid() && len(call.Args) == 2 &&
		t63A1jLiteral(call.Args[0], "jobs handler failed") && t63A1jIdent(call.Args[1], "attrs")
}

func t63A1kSafe(prior []ast.Stmt) bool {
	return len(prior) == 2 && t63A1kBase(prior[0]) && t63A1iRequestID(prior[1])
}

func t63A1kBase(stmt ast.Stmt) bool {
	rhs := t63A1jAssignment(stmt, token.DEFINE, "attrs")
	literal, ok := rhs.(*ast.CompositeLit)
	if !ok || len(literal.Elts) != 2 {
		return false
	}
	array, ok := literal.Type.(*ast.ArrayType)
	return ok && array.Len == nil && t63A1jIdent(array.Elt, "any") &&
		t63A1jLiteral(literal.Elts[0], "code_class") && t63A1jSelector(literal.Elts[1], "def", "Code")
}
