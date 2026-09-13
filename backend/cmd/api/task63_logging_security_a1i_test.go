package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

const t63A1iCandidatesFile = "../../internal/features/candidates/infrastructure/http/handler.go"

func TestTask63A1i_CandidateDynamicAttrs(t *testing.T) {
	file := t63A1iParse(t, t63A1iCandidatesFile, nil)
	want := map[string]int{
		"getMyProfile":       1,
		"upsertMyProfile":    1,
		"listMyLanguages":    1,
		"replaceMyLanguages": 2,
	}
	total := 0
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || want[fn.Name.Name] == 0 {
			continue
		}
		calls, invalid := t63A1iScan(fn.Body)
		if calls != want[fn.Name.Name] || invalid != 0 {
			t.Errorf("%s dynamic attrs calls/invalid = %d/%d, want %d/0", fn.Name.Name, calls, invalid, want[fn.Name.Name])
		}
		total += calls
		delete(want, fn.Name.Name)
	}
	if total != 5 || len(want) != 0 {
		t.Fatalf("candidate dynamic attrs calls/missing handlers = %d/%v, want 5/none", total, want)
	}
}

func TestTask63A1i_AttrsSafetyFixtures(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantInvalid int
	}{
		{name: "accepts code class only", body: `attrs := []any{"code_class", def.Code}; slog.Error("x", attrs...)`},
		{name: "accepts guarded request ID", body: `attrs := []any{"code_class", def.Code}; if reqID := chimw.GetReqID(r.Context()); reqID != "" { attrs = append(attrs, "request_id", reqID) }; slog.Error("x", attrs...)`},
		{name: "rejects token key", body: `attrs := []any{"token", def.Code}; slog.Error("x", attrs...)`, wantInvalid: 1},
		{name: "rejects raw error value", body: `attrs := []any{"code_class", err}; slog.Error("x", attrs...)`, wantInvalid: 1},
		{name: "rejects err key", body: `attrs := []any{"err", def.Code}; slog.Error("x", attrs...)`, wantInvalid: 1},
		{name: "rejects error append", body: `attrs := []any{"code_class", def.Code}; attrs = append(attrs, "error", err); slog.Error("x", attrs...)`, wantInvalid: 1},
		{name: "rejects unguarded request ID", body: `attrs := []any{"code_class", def.Code}; attrs = append(attrs, "request_id", reqID); slog.Error("x", attrs...)`, wantInvalid: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := "package fixture; func f() {" + tt.body + "}"
			file := t63A1iParse(t, tt.name+".go", src)
			fn := file.Decls[0].(*ast.FuncDecl)
			calls, invalid := t63A1iScan(fn.Body)
			if calls != 1 || invalid != tt.wantInvalid {
				t.Fatalf("calls/invalid = %d/%d, want 1/%d", calls, invalid, tt.wantInvalid)
			}
		})
	}
}

func t63A1iParse(t *testing.T, name string, src any) *ast.File {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), name, src, 0)
	if err != nil {
		t.Fatal(err)
	}
	return file
}

func t63A1iScan(root *ast.BlockStmt) (calls, invalid int) {
	ast.Inspect(root, func(node ast.Node) bool {
		block, ok := node.(*ast.BlockStmt)
		if !ok {
			return true
		}
		for i, stmt := range block.List {
			if !t63A1iSpread(stmt) {
				continue
			}
			calls++
			if !t63A1iSafe(block.List[:i]) {
				invalid++
			}
		}
		return true
	})
	return calls, invalid
}

func t63A1iSpread(stmt ast.Stmt) bool {
	expr, ok := stmt.(*ast.ExprStmt)
	if !ok {
		return false
	}
	call := t63A1iCall(expr.X, "slog", "Error")
	return call != nil && call.Ellipsis.IsValid() && len(call.Args) == 2 && t63A1iIdent(call.Args[1], "attrs")
}

func t63A1iSafe(prior []ast.Stmt) bool {
	last := len(prior) - 1
	if last < 0 {
		return false
	}
	if t63A1iRequestID(prior[last]) {
		last--
	}
	return last >= 0 && t63A1iBase(prior[last])
}

func t63A1iBase(stmt ast.Stmt) bool {
	rhs := t63A1iAssignment(stmt, token.DEFINE, "attrs")
	literal, ok := rhs.(*ast.CompositeLit)
	if !ok || len(literal.Elts) != 2 {
		return false
	}
	array, ok := literal.Type.(*ast.ArrayType)
	return ok && array.Len == nil && t63A1iIdent(array.Elt, "any") &&
		t63A1iLiteral(literal.Elts[0], "code_class") && t63A1iSelector(literal.Elts[1], "def", "Code")
}

func t63A1iRequestID(stmt ast.Stmt) bool {
	guard, ok := stmt.(*ast.IfStmt)
	if !ok || guard.Else != nil || len(guard.Body.List) != 1 {
		return false
	}
	get := t63A1iCall(t63A1iAssignment(guard.Init, token.DEFINE, "reqID"), "chimw", "GetReqID")
	condition, ok := guard.Cond.(*ast.BinaryExpr)
	if get == nil || len(get.Args) != 1 {
		return false
	}
	contextCall := t63A1iCall(get.Args[0], "r", "Context")
	if contextCall == nil || len(contextCall.Args) != 0 || !ok || condition.Op != token.NEQ ||
		!t63A1iIdent(condition.X, "reqID") || !t63A1iLiteral(condition.Y, "") {
		return false
	}
	appendCall, ok := t63A1iAssignment(guard.Body.List[0], token.ASSIGN, "attrs").(*ast.CallExpr)
	return ok && t63A1iIdent(appendCall.Fun, "append") && len(appendCall.Args) == 3 &&
		t63A1iIdent(appendCall.Args[0], "attrs") && t63A1iLiteral(appendCall.Args[1], "request_id") &&
		t63A1iIdent(appendCall.Args[2], "reqID")
}

func t63A1iAssignment(stmt ast.Stmt, tok token.Token, lhs string) ast.Expr {
	assign, ok := stmt.(*ast.AssignStmt)
	if !ok || assign.Tok != tok || len(assign.Lhs) != 1 || len(assign.Rhs) != 1 || !t63A1iIdent(assign.Lhs[0], lhs) {
		return nil
	}
	return assign.Rhs[0]
}

func t63A1iCall(expr ast.Expr, receiver, name string) *ast.CallExpr {
	call, ok := expr.(*ast.CallExpr)
	if !ok || !t63A1iSelector(call.Fun, receiver, name) {
		return nil
	}
	return call
}

func t63A1iSelector(expr ast.Expr, receiver, name string) bool {
	selector, ok := expr.(*ast.SelectorExpr)
	return ok && selector.Sel.Name == name && t63A1iIdent(selector.X, receiver)
}

func t63A1iIdent(expr ast.Expr, name string) bool {
	ident, ok := expr.(*ast.Ident)
	return ok && ident.Name == name
}

func t63A1iLiteral(expr ast.Expr, value string) bool {
	literal, ok := expr.(*ast.BasicLit)
	return ok && literal.Kind == token.STRING && literal.Value == `"`+value+`"`
}
