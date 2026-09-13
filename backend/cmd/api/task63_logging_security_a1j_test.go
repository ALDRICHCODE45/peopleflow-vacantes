package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

const t63A1jIndustriesFile = "../../internal/features/industries/infrastructure/http/handler.go"

func TestTask63A1j_IndustriesDynamicAttrs(t *testing.T) {
	file := t63A1jParse(t, t63A1jIndustriesFile, nil)
	found := map[string]bool{}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}
		switch fn.Name.Name {
		case "ListIndustries":
			found[fn.Name.Name] = t63A1jListCall(fn.Body)
		case "boundedUnexpectedErrorAttrs":
			found[fn.Name.Name] = t63A1jAttrs(fn.Body.List)
		}
	}
	for _, name := range []string{"ListIndustries", "boundedUnexpectedErrorAttrs"} {
		if !found[name] {
			t.Errorf("%s must match the bounded Industries logging contract", name)
		}
	}
}

func TestTask63A1j_AttrsSafetyFixtures(t *testing.T) {
	tests := []struct {
		name string
		body string
		safe bool
	}{
		{name: "accepts bounded attrs", body: `attrs := []any{"code_class", httpjson.CodeInternalError}; if reqID := chimw.GetReqID(ctx); reqID != "" { attrs = append(attrs, "request_id", reqID) }; return attrs`, safe: true},
		{name: "rejects error key", body: `attrs := []any{"error", httpjson.CodeInternalError}; return attrs`},
		{name: "rejects err key", body: `attrs := []any{"err", httpjson.CodeInternalError}; return attrs`},
		{name: "rejects token key", body: `attrs := []any{"token", httpjson.CodeInternalError}; return attrs`},
		{name: "rejects raw path", body: `attrs := []any{"code_class", httpjson.CodeInternalError}; attrs = append(attrs, "path", r.URL.Path); return attrs`},
		{name: "rejects raw error", body: `attrs := []any{"code_class", err}; return attrs`},
		{name: "rejects unguarded request ID", body: `attrs := []any{"code_class", httpjson.CodeInternalError}; attrs = append(attrs, "request_id", chimw.GetReqID(ctx)); return attrs`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := "package fixture; func f(ctx context.Context) []any {" + tt.body + "}"
			file := t63A1jParse(t, tt.name+".go", src)
			got := t63A1jAttrs(file.Decls[0].(*ast.FuncDecl).Body.List)
			if got != tt.safe {
				t.Fatalf("safe = %t, want %t", got, tt.safe)
			}
		})
	}
}

func t63A1jParse(t *testing.T, name string, src any) *ast.File {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), name, src, 0)
	if err != nil {
		t.Fatal(err)
	}
	return file
}

func t63A1jListCall(root ast.Node) bool {
	calls, valid := 0, 0
	ast.Inspect(root, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || !t63A1jSelector(call.Fun, "slog", "Error") {
			return true
		}
		calls++
		if !call.Ellipsis.IsValid() || len(call.Args) != 2 || !t63A1jLiteral(call.Args[0], "list industries failed") {
			return true
		}
		attrs := t63A1jCall(call.Args[1], "", "boundedUnexpectedErrorAttrs")
		if attrs != nil && len(attrs.Args) == 1 {
			ctx := t63A1jCall(attrs.Args[0], "r", "Context")
			if ctx != nil && len(ctx.Args) == 0 {
				valid++
			}
		}
		return true
	})
	return calls == 1 && valid == 1
}

func t63A1jAttrs(stmts []ast.Stmt) bool {
	if len(stmts) != 3 || !t63A1jBase(stmts[0]) || !t63A1jRequestID(stmts[1]) {
		return false
	}
	ret, ok := stmts[2].(*ast.ReturnStmt)
	return ok && len(ret.Results) == 1 && t63A1jIdent(ret.Results[0], "attrs")
}

func t63A1jBase(stmt ast.Stmt) bool {
	rhs := t63A1jAssignment(stmt, token.DEFINE, "attrs")
	literal, ok := rhs.(*ast.CompositeLit)
	if !ok || len(literal.Elts) != 2 {
		return false
	}
	array, ok := literal.Type.(*ast.ArrayType)
	return ok && array.Len == nil && t63A1jIdent(array.Elt, "any") &&
		t63A1jLiteral(literal.Elts[0], "code_class") &&
		t63A1jSelector(literal.Elts[1], "httpjson", "CodeInternalError")
}

func t63A1jRequestID(stmt ast.Stmt) bool {
	guard, ok := stmt.(*ast.IfStmt)
	if !ok || guard.Else != nil || len(guard.Body.List) != 1 {
		return false
	}
	get := t63A1jCall(t63A1jAssignment(guard.Init, token.DEFINE, "reqID"), "chimw", "GetReqID")
	condition, ok := guard.Cond.(*ast.BinaryExpr)
	if get == nil || len(get.Args) != 1 || !t63A1jIdent(get.Args[0], "ctx") || !ok ||
		condition.Op != token.NEQ || !t63A1jIdent(condition.X, "reqID") || !t63A1jLiteral(condition.Y, "") {
		return false
	}
	appendCall, ok := t63A1jAssignment(guard.Body.List[0], token.ASSIGN, "attrs").(*ast.CallExpr)
	return ok && t63A1jIdent(appendCall.Fun, "append") && len(appendCall.Args) == 3 &&
		t63A1jIdent(appendCall.Args[0], "attrs") && t63A1jLiteral(appendCall.Args[1], "request_id") &&
		t63A1jIdent(appendCall.Args[2], "reqID")
}

func t63A1jAssignment(stmt ast.Stmt, tok token.Token, lhs string) ast.Expr {
	assign, ok := stmt.(*ast.AssignStmt)
	if !ok || assign.Tok != tok || len(assign.Lhs) != 1 || len(assign.Rhs) != 1 || !t63A1jIdent(assign.Lhs[0], lhs) {
		return nil
	}
	return assign.Rhs[0]
}

func t63A1jCall(expr ast.Expr, receiver, name string) *ast.CallExpr {
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return nil
	}
	if receiver == "" && t63A1jIdent(call.Fun, name) || receiver != "" && t63A1jSelector(call.Fun, receiver, name) {
		return call
	}
	return nil
}

func t63A1jSelector(expr ast.Expr, receiver, name string) bool {
	selector, ok := expr.(*ast.SelectorExpr)
	return ok && selector.Sel.Name == name && t63A1jIdent(selector.X, receiver)
}

func t63A1jIdent(expr ast.Expr, name string) bool {
	ident, ok := expr.(*ast.Ident)
	return ok && ident.Name == name
}

func t63A1jLiteral(expr ast.Expr, value string) bool {
	literal, ok := expr.(*ast.BasicLit)
	return ok && literal.Kind == token.STRING && literal.Value == `"`+value+`"`
}
