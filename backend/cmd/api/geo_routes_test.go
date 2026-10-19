package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"reflect"
	"sort"
	"strconv"
	"testing"
)

func TestGeoRoutesExactPublicRegistration(t *testing.T) {
	assertGeoRoutesExactPublicRegistration(t)
}

func assertGeoRoutesExactPublicRegistration(t *testing.T) {
	t.Helper()
	f := mustParse(t, routerFile)
	calls := 0
	root := findFuncDecl(f, "newRouter")
	for _, stmt := range root.Body.List {
		es, ok := stmt.(*ast.ExprStmt)
		if !ok {
			continue
		}
		call, ok := es.X.(*ast.CallExpr)
		if ok && isPkgSelector(call.Fun, "geohttp", "RegisterRoutes") {
			calls++
			if len(call.Args) != 2 {
				t.Fatal("geo registration must use the root router and reader")
			}
			router, ok := call.Args[0].(*ast.Ident)
			if !ok || router.Name != "r" {
				t.Fatal("geo registration must use root r, no auth/NoStore wrapper")
			}
		}
	}
	total := 0
	ast.Inspect(f, func(n ast.Node) bool {
		if c, ok := n.(*ast.CallExpr); ok && isPkgSelector(c.Fun, "geohttp", "RegisterRoutes") {
			total++
		}
		return true
	})
	if calls != 1 || total != 1 {
		t.Fatalf("root=%d total=%d", calls, total)
	}
	routes, err := parser.ParseFile(token.NewFileSet(), "../../internal/features/geo/infrastructure/http/handler.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	ast.Inspect(routes, func(n ast.Node) bool {
		c, ok := n.(*ast.CallExpr)
		if !ok || len(c.Args) == 0 {
			return true
		}
		s, ok := c.Fun.(*ast.SelectorExpr)
		if !ok || !industryRegistrationMethods(s.Sel.Name) {
			return true
		}
		lit, ok := c.Args[0].(*ast.BasicLit)
		if !ok {
			return true
		}
		path, err := strconv.Unquote(lit.Value)
		if err == nil {
			got = append(got, s.Sel.Name+" "+path)
		}
		return true
	})
	want := []string{"Get /v2/geo/countries", "Get /v2/geo/countries/{country}/states", "Get /v2/geo/countries/{country}/states/{state}/municipalities", "Get /v2/geo/countries/{country}/postal-codes/{cp}"}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("geo routes drifted: %v", got)
	}
}
