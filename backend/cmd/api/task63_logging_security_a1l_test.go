package main

import (
	"go/ast"
	"go/token"
	"testing"
)

const t63A1lIdentityMiddlewareFile = "../../internal/features/identity/infrastructure/http/middleware.go"

func TestTask63A1l_RequireAuthBoundedUnauthenticatedLog(t *testing.T) {
	file := t63A1jParse(t, t63A1lIdentityMiddlewareFile, nil)
	if got := t63A1lMatches(file); got != 1 {
		t.Fatalf("RequireAuth bounded unauthenticated log matches = %d, want 1", got)
	}
}

func TestTask63A1l_IdentitySafetyFixtures(t *testing.T) {
	const safeCall = `slog.Debug("auth: token verification failed", boundedUnauthenticatedAttrs(r.Context())...)`
	const safeBody = `attrs := []any{"code_class", httpjson.CodeUnauthenticated}; if reqID := chimw.GetReqID(ctx); reqID != "" { attrs = append(attrs, "request_id", reqID) }; return attrs`
	tests := []struct {
		name string
		call string
		body string
		want int
	}{
		{name: "accepts bounded unauthenticated log", call: safeCall, body: safeBody, want: 1},
		{name: "rejects wrong message", call: `slog.Debug("verification failed", boundedUnauthenticatedAttrs(r.Context())...)`, body: safeBody},
		{name: "rejects missing spread", call: `slog.Debug("auth: token verification failed", boundedUnauthenticatedAttrs(r.Context()))`, body: safeBody},
		{name: "rejects error key", call: safeCall, body: `attrs := []any{"error", httpjson.CodeUnauthenticated}; return attrs`},
		{name: "rejects err key", call: safeCall, body: `attrs := []any{"err", httpjson.CodeUnauthenticated}; return attrs`},
		{name: "rejects token key", call: safeCall, body: `attrs := []any{"token", httpjson.CodeUnauthenticated}; return attrs`},
		{name: "rejects Authorization key", call: safeCall, body: `attrs := []any{"Authorization", httpjson.CodeUnauthenticated}; return attrs`},
		{name: "rejects raw path", call: safeCall, body: `attrs := []any{"code_class", httpjson.CodeUnauthenticated}; attrs = append(attrs, "path", r.URL.Path); return attrs`},
		{name: "rejects raw error", call: safeCall, body: `attrs := []any{"code_class", err}; return attrs`},
		{name: "rejects unguarded request ID", call: safeCall, body: `attrs := []any{"code_class", httpjson.CodeUnauthenticated}; attrs = append(attrs, "request_id", chimw.GetReqID(ctx)); return attrs`},
		{name: "rejects request ID from request context", call: safeCall, body: `attrs := []any{"code_class", httpjson.CodeUnauthenticated}; if reqID := chimw.GetReqID(r.Context()); reqID != "" { attrs = append(attrs, "request_id", reqID) }; return attrs`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := "package fixture; func RequireAuth() {" + tt.call + "}; func boundedUnauthenticatedAttrs(ctx any) []any {" + tt.body + "}"
			if got := t63A1lMatches(t63A1jParse(t, tt.name+".go", src)); got != tt.want {
				t.Fatalf("matches = %d, want %d", got, tt.want)
			}
		})
	}
}

func t63A1lMatches(file *ast.File) int {
	if file == nil {
		return 0
	}
	helperOK, matches := false, 0
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		switch fn.Name.Name {
		case "boundedUnauthenticatedAttrs":
			helperOK = t63A1lHelper(fn.Body.List)
		case "RequireAuth":
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				if call, ok := node.(*ast.CallExpr); ok && t63A1lLogCall(call) {
					matches++
				}
				return true
			})
		}
	}
	if !helperOK {
		return 0
	}
	return matches
}

func t63A1lLogCall(call *ast.CallExpr) bool {
	if call == nil || !call.Ellipsis.IsValid() || len(call.Args) != 2 ||
		!t63A1jSelector(call.Fun, "slog", "Debug") ||
		!t63A1jLiteral(call.Args[0], "auth: token verification failed") {
		return false
	}
	helper, ok := call.Args[1].(*ast.CallExpr)
	if !ok || !t63A1jIdent(helper.Fun, "boundedUnauthenticatedAttrs") || len(helper.Args) != 1 {
		return false
	}
	ctx, ok := helper.Args[0].(*ast.CallExpr)
	return ok && len(ctx.Args) == 0 && t63A1jSelector(ctx.Fun, "r", "Context")
}

func t63A1lHelper(stmts []ast.Stmt) bool {
	if len(stmts) != 3 || !t63A1lBase(stmts[0]) || !t63A1jRequestID(stmts[1]) {
		return false
	}
	ret, ok := stmts[2].(*ast.ReturnStmt)
	return ok && len(ret.Results) == 1 && t63A1jIdent(ret.Results[0], "attrs")
}

func t63A1lBase(stmt ast.Stmt) bool {
	rhs := t63A1jAssignment(stmt, token.DEFINE, "attrs")
	lit, ok := rhs.(*ast.CompositeLit)
	if !ok || len(lit.Elts) != 2 {
		return false
	}
	typ, ok := lit.Type.(*ast.ArrayType)
	return ok && typ.Len == nil && t63A1jIdent(typ.Elt, "any") &&
		t63A1jLiteral(lit.Elts[0], "code_class") &&
		t63A1jSelector(lit.Elts[1], "httpjson", "CodeUnauthenticated")
}
