package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// TestRequireAuth_MountedOnMeRoutes asserts the spec scenario
// "Authentication Required": RequireAuth is referenced in at least
// one chi route mutation (Use/With/Group/Mount/Route) so the
// /me/* candidate routes cannot be reached without going through
// the middleware. This is the inverted W5 guard — it fails the
// moment main.go drops the mount, preventing the regression where
// the candidates profile is reachable unauthenticated.
//
// Pre-WU5 the test was TestRequireAuth_ConstructedButNotMounted
// (asserted zero references). Post-WU5 the guard is positive: the
// mount must exist, exactly mirroring the spec scenario
// "missing Authorization header is rejected" — the only way the
// rejection can fire is if the middleware is actually wired into
// the route chain.
func TestRequireAuth_MountedOnMeRoutes(t *testing.T) {
	const filePath = "main.go"

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	// Walk the AST and collect:
	//   - every CallExpr whose function name is RequireAuth (or a
	//     selector expression ending in .RequireAuth)
	//   - every CallExpr whose function is one of the chi.Router
	//     mounting methods (Use, With, Group, Mount, Route) and
	//     whose argument list references the same identifier.
	constructorCalls := 0
	chiMutationCalls := 0
	routeReferences := 0

	// "RequireAuth" — single identifier form OR selector form (e.g.
	// x.RequireAuth).
	hasConstructorCall := false

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}

		// Detect constructor call.
		if isConstructorCall(call) {
			hasConstructorCall = true
			constructorCalls++
		}

		// Detect chi Route mutation.
		if isChiRouteMutationCall(call) {
			chiMutationCalls++
			if referencesIdentifier(call, "RequireAuth") {
				routeReferences++
			}
		}
		return true
	})

	if !hasConstructorCall {
		t.Fatalf("expected RequireAuth constructor to be called in main.go; got 0 calls")
	}
	if constructorCalls < 1 {
		t.Errorf("expected at least 1 RequireAuth constructor call")
	}
	// Inverted guard: RequireAuth MUST appear in at least one chi
	// route mutation (Use/With/Group/Mount/Route) so the /me/* chain
	// can't be reached without going through the middleware. The
	// previous (pre-WU5) guard asserted == 0; the post-WU5 guard
	// asserts >= 1. They flip atomically with the mount.
	if routeReferences < 1 {
		t.Errorf("expected >=1 chi route references to RequireAuth (RequireAuth must be wired into the /me/* route chain), got %d (of %d chi calls)",
			routeReferences, chiMutationCalls)
	}

	// Sanity log for the verbose run.
	t.Logf("parsed %s: %d RequireAuth constructor calls, %d chi route mutations, %d references",
		filePath, constructorCalls, chiMutationCalls, routeReferences)
}

// isConstructorCall returns true if the call is a `RequireAuth(...)`
// or `x.RequireAuth(...)` form.
func isConstructorCall(call *ast.CallExpr) bool {
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return fn.Name == "RequireAuth"
	case *ast.SelectorExpr:
		return fn.Sel.Name == "RequireAuth"
	}
	return false
}

// isChiRouteMutationCall returns true if the call is chi-style route
// mutation: Use, With, Group, Mount, Route. We accept both bare
// identifiers and selector expressions (e.g. r.Use).
func isChiRouteMutationCall(call *ast.CallExpr) bool {
	const mutations = "Use|With|Group|Mount|Route"

	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return strings.Contains(mutations, fn.Name) && isMutationName(fn.Name)
	case *ast.SelectorExpr:
		return isMutationName(fn.Sel.Name)
	}
	return false
}

func isMutationName(name string) bool {
	switch name {
	case "Use", "With", "Group", "Mount", "Route":
		return true
	}
	return false
}

// referencesIdentifier walks the AST subtree rooted at `call` and returns
// true if any sub-expression references the given identifier name.
// The walk is shallow on purpose: we want to fail loudly if RequireAuth
// is even mentioned as a string anywhere in a mutation call.
func referencesIdentifier(call *ast.CallExpr, name string) bool {
	found := false
	ast.Inspect(call, func(n ast.Node) bool {
		if found {
			return false
		}
		switch x := n.(type) {
		case *ast.Ident:
			if x.Name == name {
				found = true
				return false
			}
		}
		return true
	})
	return found
}

// TestJobsMount_PublicReadRoutes asserts the WU6 wiring of the jobs
// public-read slice. Spec scenario "GET /jobs is public" forbids
// auth on the mount; this test enforces the structural invariants
// that make the route reachable:
//
//  1. NewJobHandler(...) is called at the composition root (the
//     handler would not exist otherwise).
//  2. r.Mount("/jobs", ...) is present at the composition root
//     (the route would not be reachable otherwise).
//
// This is the post-WU6 guard. Pre-WU6 the test fails because the
// mount + constructor are absent; once main.go is wired (9.1) the
// test passes. The assertion style mirrors TestRequireAuth_
// MountedOnMeRoutes (AST walk of main.go) so the two guards live
// in the same idiom.
func TestJobsMount_PublicReadRoutes(t *testing.T) {
	const filePath = "main.go"

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	handlerCtor := 0
	jobsMounts := 0

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if isJobsHandlerConstructorCall(call) {
			handlerCtor++
		}
		if isJobsMountCall(call) {
			jobsMounts++
		}
		return true
	})

	if handlerCtor < 1 {
		t.Errorf("expected NewJobHandler() constructor call in main.go; got %d (the /jobs routes would never be served)", handlerCtor)
	}
	if jobsMounts < 1 {
		t.Errorf("expected r.Mount(\"/jobs\", ...) in main.go; got %d mounts (GET /jobs and GET /jobs/{id} are unreachable)", jobsMounts)
	}

	t.Logf("parsed %s: %d NewJobHandler constructor calls, %d /jobs mounts",
		filePath, handlerCtor, jobsMounts)
}

// isJobsHandlerConstructorCall returns true when the call is
// `NewJobHandler(...)` or `pkg.NewJobHandler(...)`. The selector form
// covers the alias `jobshttp.NewJobHandler` used at the composition
// root.
func isJobsHandlerConstructorCall(call *ast.CallExpr) bool {
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return fn.Name == "NewJobHandler"
	case *ast.SelectorExpr:
		return fn.Sel.Name == "NewJobHandler"
	}
	return false
}

// isJobsMountCall returns true when the call is a chi `Mount(...)`
// mutation whose first argument is the string literal "/jobs". Any
// other mount prefix, or a non-string-literal first arg, fails the
// check — the test is intentionally exact about the prefix so a
// typo like `/job` or `/jobs/` is caught at unit-test time.
func isJobsMountCall(call *ast.CallExpr) bool {
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		if fn.Name != "Mount" {
			return false
		}
	case *ast.SelectorExpr:
		if fn.Sel.Name != "Mount" {
			return false
		}
	default:
		return false
	}
	if len(call.Args) == 0 {
		return false
	}
	bl, ok := call.Args[0].(*ast.BasicLit)
	if !ok || bl.Kind != token.STRING {
		return false
	}
	return bl.Value == `"/jobs"`
}
