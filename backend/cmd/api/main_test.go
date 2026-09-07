// TestCompanyWriteRoutes_MountedBehindGates asserts the WU6 wiring:
// the gated `PATCH /me/company` and `DELETE /me/company` routes are
// mounted on the composition root with `requireOwner` as middleware
// (the /me subtree already has `r.Use(requireAuth)`, so a single
// `r.With(requireOwner)` layer is sufficient — same pattern as the
// membership mutation routes). The test scans main.go's AST and
// finds:
//
//  1. A chi mutation whose method is `Patch` and whose first string
//     argument is the path template `/me/company`.
//  2. The same mutation's inner `With(...)` call references
//     `requireOwner`.
//  3. A chi mutation whose method is `Delete` and whose first string
//     argument is the path template `/me/company`.
//  4. The same mutation's inner `With(...)` call references
//     `requireOwner`.
//  5. There is NO `chi.Mount("/me/company", ...)` subrouter that
//     would shadow the per-method gates (the routing-split defense).
//
// The guard fails the moment either route is moved out from behind
// `requireOwner` (a regression where the write path becomes reachable
// to non-owners).
//
// Mirrors `TestJobsSoftDeleteRoute_MountedBehindGates` so the three
// composition-root guards (PATCH / POST / DELETE) live in the same
// idiom.
package main

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
)

// findFuncDecl returns the top-level function declaration named `name` in f (nil when absent).
func findFuncDecl(f *ast.File, name string) *ast.FuncDecl {
	for _, d := range f.Decls {
		if fn, ok := d.(*ast.FuncDecl); ok && fn.Name.Name == name {
			return fn
		}
	}
	return nil
}

// isPkgSelector reports whether e is exactly the qualified selector `pkg.name`.
func isPkgSelector(e ast.Expr, pkg, name string) bool {
	sel, ok := e.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	id, ok := sel.X.(*ast.Ident)
	return ok && id.Name == pkg && sel.Sel.Name == name
}

// chiMiddlewareLocalName resolves the local package name (alias or base) of
// the chi middleware import in f; "" when not imported. Resolving the real
// alias means an import rename cannot hide a legacy Logger reference.
func chiMiddlewareLocalName(f *ast.File) string {
	for _, imp := range f.Imports {
		p, err := strconv.Unquote(imp.Path.Value)
		if err != nil || p != "github.com/go-chi/chi/v5/middleware" {
			continue
		}
		if imp.Name != nil {
			return imp.Name.Name
		}
		return p[strings.LastIndex(p, "/")+1:]
	}
	return ""
}

// isSelectorOnReceiver reports whether e is EXACTLY the selector
// `<recv>.<name>` whose receiver is the bare identifier recv. The exact
// structural binding Guards 1a/1b require: a chained call like
// chi.NewRouter().Use carrying the same arguments, or an unrelated
// owner containing a .httpMetrics selector (e.g.
// routerDeps{httpMetrics: d.httpMetrics}.httpMetrics), must NOT match
// (ws6c-2c gen-109 verifier correction — the previous permissive
// subtree scan accepted both).
func isSelectorOnReceiver(e ast.Expr, recv, name string) bool {
	sel, ok := e.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	id, ok := sel.X.(*ast.Ident)
	return ok && id.Name == recv && sel.Sel.Name == name
}

func isNilIdent(e ast.Expr) bool {
	id, ok := e.(*ast.Ident)
	return ok && id.Name == "nil"
}

// TestProductionComposition_RequestObservabilityWired pins the ws6c-2c
// production-wiring slice (Task 6.3, design §8.3) with EXACT structural
// binding, not permissive scanning: (1) the root chain is the single
// top-level r.Use(...) directly inside func newRouter — exactly one root Use,
// exactly three arguments, exactly ordered middleware.RequestID,
// runtimemw.RequestObservability(nil, d.httpMetrics), middleware.Recoverer;
// nested closure Uses (the /me Route subtree) never count, and an extra root
// Use statement/argument — where an aliased legacy logger could hide — fails;
// (2) chi's legacy request logger is detected via the router owner's real
// import alias for go-chi/chi/v5/middleware (any <chiMW>.Logger reference
// fails); (3) no-op composition is bound to the single newRouter(routerDeps{...})
// call inside func run — the keyed field must be exactly
// httpMetrics: runtimemetrics.Default; a runtimemetrics.Default reference
// elsewhere (a decoy) does not satisfy it. Compile-safe AST walk.
//
// RED (preserved, not re-claimed): pre-wiring, the first failing run stopped
// at the FIRST drift (t.Fatalf does not continue): "production r.Use chain
// must install runtime RequestObservability exactly once; got 0 uses across
// 2 Use calls" — it did not name every drift in a single run.
//
// Correction RED (gen-109, guard non-vacuity only — NOT production
// behavior): external-temp probes previously PASSED INCORRECTLY under
// the permissive guard: (1) chi.NewRouter().Use(...) carrying the same
// three arguments (Use collected on Sel name alone); (2) the metrics
// argument rewritten to routerDeps{httpMetrics: d.httpMetrics}.httpMetrics
// (subtree scan matched any .httpMetrics selector). After the exact-binding
// fix each probe fails for its intended assertion.
func TestProductionComposition_RequestObservabilityWired(t *testing.T) {
	rf := mustParse(t, routerFile)
	cf := mustParse(t, compositionFile)

	// Guard 1a: exactly one root Use, bound to newRouter's DIRECT body
	// statements — a Use inside a FuncLit (the /me closure) is never collected.
	routerFn := findFuncDecl(rf, "newRouter")
	var rootUses []*ast.CallExpr
	if routerFn != nil {
		for _, stmt := range routerFn.Body.List {
			es, ok := stmt.(*ast.ExprStmt)
			if !ok {
				continue
			}
			call, ok := es.X.(*ast.CallExpr)
			if !ok {
				continue
			}
			// Exact receiver binding: only `r.Use(...)` counts — a chained
			// call like chi.NewRouter().Use(...) carrying the same arguments
			// must never be collected (gen-109 correction).
			if !isSelectorOnReceiver(call.Fun, "r", "Use") {
				continue
			}
			rootUses = append(rootUses, call)
		}
	}
	if len(rootUses) != 1 {
		t.Fatalf("router owner %s must declare func newRouter with exactly ONE root-level r.Use(...) statement (additional root Use calls or arguments could hide aliased legacy logging); got %d", routerFile, len(rootUses))
	}
	use := rootUses[0]

	if len(use.Args) != 3 {
		t.Fatalf("root r.Use must carry exactly the three production middleware arguments (extra arguments could hide aliased legacy logging); got %d", len(use.Args))
	}
	if !isPkgSelector(use.Args[0], "middleware", "RequestID") {
		t.Fatalf("root r.Use argument 1 must be exactly middleware.RequestID (the request_id must exist before the completion record is emitted); got %s", types.ExprString(use.Args[0]))
	}
	obsCall, ok := use.Args[1].(*ast.CallExpr)
	if !ok || !isPkgSelector(obsCall.Fun, "runtimemw", "RequestObservability") {
		t.Fatalf("root r.Use argument 2 must be exactly runtimemw.RequestObservability(...); got %s", types.ExprString(use.Args[1]))
	}
	// Exact metrics-owner binding: the argument must be exactly the
	// selector d.httpMetrics — a compile-safe subtree that merely
	// contains a .httpMetrics selector (e.g.
	// routerDeps{httpMetrics: d.httpMetrics}.httpMetrics) is NOT the
	// wiring (gen-109 correction).
	if len(obsCall.Args) != 2 || !isNilIdent(obsCall.Args[0]) || !isSelectorOnReceiver(obsCall.Args[1], "d", "httpMetrics") {
		t.Fatalf("runtimemw.RequestObservability must be called as (nil, d.httpMetrics) — the metrics argument must be EXACTLY the deps-field selector d.httpMetrics (a subtree containing a .httpMetrics selector does not count); the nil logger resolves to slog.Default() inside the middleware and the composed metrics must flow through; got %s", types.ExprString(obsCall.Args[1]))
	}
	if !isPkgSelector(use.Args[2], "middleware", "Recoverer") {
		t.Fatalf("root r.Use argument 3 must be exactly middleware.Recoverer (observability wraps recovery so the completion record sees the recovered status); got %s", types.ExprString(use.Args[2]))
	}

	// Guard 2: no chi legacy Logger, detected via the real import alias.
	chiMW := chiMiddlewareLocalName(rf)
	legacyLoggerUses := 0
	ast.Inspect(rf, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok && sel.Sel.Name == "Logger" {
			if id, isId := sel.X.(*ast.Ident); isId && id.Name == chiMW {
				legacyLoggerUses++
			}
		}
		return true
	})
	if legacyLoggerUses != 0 {
		t.Fatalf("chi legacy %s.Logger must be removed from the production wiring (RequestObservability owns per-request logging; duplicates would double-log); got %d references", chiMW, legacyLoggerUses)
	}

	// Guard 3: no-op composition bound to newRouter(routerDeps{httpMetrics: ...}) inside run.
	var newRouterCalls []*ast.CallExpr
	if runFn := findFuncDecl(cf, "run"); runFn != nil {
		ast.Inspect(runFn.Body, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok {
				if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "newRouter" {
					newRouterCalls = append(newRouterCalls, call)
				}
			}
			return true
		})
	}
	if len(newRouterCalls) != 1 {
		t.Fatalf("run must contain exactly ONE newRouter(...) call; got %d", len(newRouterCalls))
	}
	var lit *ast.CompositeLit
	if len(newRouterCalls[0].Args) == 1 {
		if l, isLit := newRouterCalls[0].Args[0].(*ast.CompositeLit); isLit {
			if id, isId := l.Type.(*ast.Ident); isId && id.Name == "routerDeps" {
				lit = l
			}
		}
	}
	if lit == nil {
		t.Fatalf("the newRouter call inside run must take a single routerDeps{...} composite literal; got %s", types.ExprString(newRouterCalls[0].Args[len(newRouterCalls[0].Args)-1]))
	}
	metricsFields := 0
	for _, elt := range lit.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			t.Fatalf("the routerDeps composite must use keyed fields (positional elements break when the struct grows)")
		}
		key, ok := kv.Key.(*ast.Ident)
		if !ok || key.Name != "httpMetrics" {
			continue
		}
		metricsFields++
		if !isPkgSelector(kv.Value, "runtimemetrics", "Default") {
			t.Fatalf("routerDeps field httpMetrics must be exactly runtimemetrics.Default (the no-op default: zero dependencies, no exporter, no metrics endpoint); a runtimemetrics.Default reference anywhere else is a decoy and does not count; got %s", types.ExprString(kv.Value))
		}
	}
	if metricsFields != 1 {
		t.Fatalf("the routerDeps composite passed to newRouter inside run must set the keyed field httpMetrics exactly once; got %d", metricsFields)
	}

	t.Logf("parsed %s/%s: single root r.Use(middleware.RequestID, runtimemw.RequestObservability(nil, d.httpMetrics), middleware.Recoverer), no chi legacy Logger (alias %q resolved), run composes newRouter(routerDeps{httpMetrics: runtimemetrics.Default})", routerFile, compositionFile, chiMW)
}

// TestProductionComposition_DBPoolMetricsWired pins the ws6c-5a production
// wiring (Task 6.3, design §8.3) with exact structural binding against the
// composition root's AST: (1) run() constructs the metrics-owned pinger
// decorator exactly once as `poolPinger := runtimemetrics.NewDBObservedPinger(...)`
// with the ORIGINAL pool as the decorated inner pinger, a sampler closure that
// reads pool.Stat() and returns the current AcquiredConns/IdleConns/MaxConns,
// and the shared no-op runtimemetrics.Default as DBMetrics; (2) the
// newRouter(routerDeps{...}) composite binds pool: poolPinger — the decorated
// readiness pinger, never the bare pool — so /healthz and /readyz pings sample
// the pool; (3) at least one repository constructor still receives the bare
// original pool, proving repositories keep the undecorated *pgxpool.Pool.
// Compile-safe AST walk; the router and health packages are untouched by this
// binding (the guard reads main.go only).
func TestProductionComposition_DBPoolMetricsWired(t *testing.T) {
	cf := mustParse(t, compositionFile)

	runFn := findFuncDecl(cf, "run")
	if runFn == nil {
		t.Fatalf("composition root %s must declare func run", compositionFile)
	}

	// Guard 1: exactly one decorator construction inside run().
	var ctorCalls []*ast.CallExpr
	ast.Inspect(runFn.Body, func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok && isPkgSelector(call.Fun, "runtimemetrics", "NewDBObservedPinger") {
			ctorCalls = append(ctorCalls, call)
		}
		return true
	})
	if len(ctorCalls) != 1 {
		t.Fatalf("run() must construct the DB pool metrics decorator via runtimemetrics.NewDBObservedPinger exactly once; got %d", len(ctorCalls))
	}
	ctor := ctorCalls[0]
	if len(ctor.Args) != 3 {
		t.Fatalf("NewDBObservedPinger must take (pinger, sampler, dbMetrics); got %d arguments", len(ctor.Args))
	}
	if id, ok := ctor.Args[0].(*ast.Ident); !ok || id.Name != "pool" {
		t.Fatalf("NewDBObservedPinger argument 1 must be the ORIGINAL pool identifier (the decorator wraps the pool's own Ping); got %s", types.ExprString(ctor.Args[0]))
	}
	sampler, ok := ctor.Args[1].(*ast.FuncLit)
	if !ok {
		t.Fatalf("NewDBObservedPinger argument 2 must be a sampler closure over pgxpool.Stat(); got %s", types.ExprString(ctor.Args[1]))
	}
	// Single-snapshot binding (ord-153 correction): the sampler must capture
	// exactly ONE `s := pool.Stat()` assignment and return all three counts
	// from that SAME captured snapshot, in order. A mixed form like
	// `return pool.Stat().AcquiredConns(), s.IdleConns(), s.MaxConns()`
	// samples twice and binds inconsistent snapshots, so it must FAIL.
	statAssigns := 0
	snapName := ""
	ast.Inspect(sampler.Body, func(n ast.Node) bool {
		assign, ok := n.(*ast.AssignStmt)
		if !ok || assign.Tok != token.DEFINE || len(assign.Lhs) != 1 || len(assign.Rhs) != 1 {
			return true
		}
		lhs, ok := assign.Lhs[0].(*ast.Ident)
		if !ok {
			return true
		}
		call, ok := assign.Rhs[0].(*ast.CallExpr)
		if !ok || !isSelectorOnReceiver(call.Fun, "pool", "Stat") {
			return true
		}
		statAssigns++
		snapName = lhs.Name
		return true
	})
	if statAssigns != 1 {
		t.Fatalf("the sampler must capture exactly ONE pool.Stat() snapshot into a single variable; got %d assignments", statAssigns)
	}
	last := sampler.Body.List[len(sampler.Body.List)-1]
	ret, ok := last.(*ast.ReturnStmt)
	if !ok || len(ret.Results) != 3 {
		t.Fatalf("the sampler must end with a three-value return from one captured snapshot; got %T", last)
	}
	for i, want := range []string{"AcquiredConns", "IdleConns", "MaxConns"} {
		call, isCall := ret.Results[i].(*ast.CallExpr)
		if !isCall || !isSelectorOnReceiver(call.Fun, snapName, want) {
			t.Fatalf("return value %d must be exactly %s.%s() — all three counts must come from the SAME captured pool.Stat() snapshot, in order; got %s", i+1, snapName, want, types.ExprString(ret.Results[i]))
		}
	}
	if !isPkgSelector(ctor.Args[2], "runtimemetrics", "Default") {
		t.Fatalf("NewDBObservedPinger argument 3 must be exactly runtimemetrics.Default (the shared no-op DBMetrics; no exporter/endpoint in this change); got %s", types.ExprString(ctor.Args[2]))
	}

	// Guard 2: routerDeps.pool is bound to the decorator variable, never the
	// bare pool (a bare pool would mean pings bypass pool sampling).
	var newRouterCalls []*ast.CallExpr
	ast.Inspect(runFn.Body, func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok {
			if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "newRouter" {
				newRouterCalls = append(newRouterCalls, call)
			}
		}
		return true
	})
	if len(newRouterCalls) != 1 {
		t.Fatalf("run must contain exactly ONE newRouter(...) call; got %d", len(newRouterCalls))
	}
	var lit *ast.CompositeLit
	if len(newRouterCalls[0].Args) == 1 {
		if l, isLit := newRouterCalls[0].Args[0].(*ast.CompositeLit); isLit {
			if id, isId := l.Type.(*ast.Ident); isId && id.Name == "routerDeps" {
				lit = l
			}
		}
	}
	if lit == nil {
		t.Fatalf("the newRouter call inside run must take a single routerDeps{...} composite literal; got %s", types.ExprString(newRouterCalls[0].Args[len(newRouterCalls[0].Args)-1]))
	}
	poolField := 0
	for _, elt := range lit.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			t.Fatalf("the routerDeps composite must use keyed fields (positional elements break when the struct grows)")
		}
		key, ok := kv.Key.(*ast.Ident)
		if !ok || key.Name != "pool" {
			continue
		}
		poolField++
		id, isId := kv.Value.(*ast.Ident)
		if !isId || id.Name != "poolPinger" {
			t.Fatalf("routerDeps field pool must be exactly the decorated pinger variable poolPinger (bare pool would bypass readiness pool sampling); got %s", types.ExprString(kv.Value))
		}
	}
	if poolField != 1 {
		t.Fatalf("the routerDeps composite must set the keyed field pool exactly once; got %d", poolField)
	}

	// Guard 3: repositories keep the ORIGINAL pool — at least one pool-owning
	// repository constructor inside run() still receives the bare pool ident.
	repoPoolArgs := 0
	ast.Inspect(runFn.Body, func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok && len(call.Args) > 0 {
			for _, arg := range call.Args {
				if id, isId := arg.(*ast.Ident); isId && id.Name == "pool" {
					repoPoolArgs++
				}
			}
		}
		return true
	})
	if repoPoolArgs == 0 {
		t.Fatalf("at least one repository constructor inside run() must still receive the original bare pool (only the readiness pinger is decorated)")
	}

	t.Logf("parsed %s: run() composes runtimemetrics.NewDBObservedPinger(pool, sampler over pool.Stat(), runtimemetrics.Default), binds routerDeps{pool: poolPinger}, and keeps the original pool for %d repository argument(s)", compositionFile, repoPoolArgs)
}

func TestCompanyWriteRoutes_MountedBehindGates(t *testing.T) {
	filePath := routerFile

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	var meRoutes, mountShadowing int
	var gatedPatch, gatedDelete, ungatedPatch, ungatedDelete int

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if sel.Sel.Name == "Mount" {
			if path, ok := chiPathLiteral(call); ok && path == `"/me/company"` {
				mountShadowing++
			}
			return true
		}
		if sel.Sel.Name != "Route" || len(call.Args) < 2 {
			return true
		}
		path, ok := chiPathLiteral(call)
		if !ok || path != `"/me"` {
			return true
		}
		fl, ok := call.Args[1].(*ast.FuncLit)
		if !ok {
			return true
		}
		meRoutes++
		// Only mutations lexically nested in the /me subtree count: a
		// root-level mutation or the owner-gated /company/members/{id}
		// routes must never satisfy this guard (false-positive defense:
		// the exact relative path /company is required).
		ast.Inspect(fl.Body, func(m ast.Node) bool {
			mut, ok := m.(*ast.CallExpr)
			if !ok {
				return true
			}
			msel, ok := mut.Fun.(*ast.SelectorExpr)
			if !ok || (msel.Sel.Name != "Patch" && msel.Sel.Name != "Delete") {
				return true
			}
			if path, ok := chiPathLiteral(mut); !ok || path != `"/company"` {
				return true
			}
			with, ok := msel.X.(*ast.CallExpr)
			if !ok || !isWithCall(with) || !referencesIdentifier(with, "requireOwner") {
				if msel.Sel.Name == "Patch" {
					ungatedPatch++
				} else {
					ungatedDelete++
				}
				return true
			}
			if msel.Sel.Name == "Patch" {
				gatedPatch++
			} else {
				gatedDelete++
			}
			return true
		})
		return true
	})

	if meRoutes != 1 {
		t.Fatalf("expected exactly one `r.Route(\"/me\", ...)` subtree in %s; got %d", filePath, meRoutes)
	}
	if mountShadowing != 0 {
		t.Fatalf("no chi.Mount(\"/me/company\", ...) subrouter may shadow the per-method gates; got %d", mountShadowing)
	}
	if gatedPatch != 1 || gatedDelete != 1 || ungatedPatch != 0 || ungatedDelete != 0 {
		t.Fatalf("/me subtree must mount exactly one requireOwner-gated PATCH and DELETE of the exact relative path /company (gated patch=%d delete=%d, ungated patch=%d delete=%d)",
			gatedPatch, gatedDelete, ungatedPatch, ungatedDelete)
	}

	t.Logf("parsed %s: /me subtree mounts PATCH and DELETE /company behind requireOwner, no shadowing mount", filePath)
}

// chiPathLiteral returns the first string-literal argument of a chi
// registration call, quoted as in source (e.g. `"/me/company"`).
// Shared by the company-write, health, and topology guards.
func chiPathLiteral(call *ast.CallExpr) (string, bool) {
	if len(call.Args) == 0 {
		return "", false
	}
	bl, ok := call.Args[0].(*ast.BasicLit)
	if !ok || bl.Kind != token.STRING {
		return "", false
	}
	return bl.Value, true
}

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
func mustParse(t *testing.T, path string) *ast.File {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("cannot parse %s: %v", path, err)
	}
	return f
}

func isBareIdentExpr(e ast.Expr) bool { _, ok := e.(*ast.Ident); return ok }

func TestRequireAuth_MountedOnMeRoutes(t *testing.T) {
	cf := mustParse(t, compositionFile)
	rf := mustParse(t, routerFile)

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

	ast.Inspect(cf, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}

		// Detect constructor call.
		if isConstructorCall(call) {
			hasConstructorCall = true
			constructorCalls++
		}
		return true
	})

	ast.Inspect(rf, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}

		// Detect chi Route mutation.
		if isChiRouteMutationCall(call) {
			chiMutationCalls++
			// Accept both the constructor form (RequireAuth) and the
			// hoisted-variable form (requireAuth). The Phase 6 hoist
			// moves the constructor call out of the route-mutation
			// argument list; the route arguments now reference the
			// hoisted `requireAuth` variable instead.
			if referencesIdentifier(call, "RequireAuth") || referencesIdentifier(call, "requireAuth") {
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
// mutation (WS6B-1b-b: also registration verbs). We accept both bare
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
	case "Use", "With", "Group", "Mount", "Route", "Get", "Post", "Put", "Patch", "Delete", "Handle", "HandleFunc":
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
	cf := mustParse(t, compositionFile)
	rf := mustParse(t, routerFile)

	handlerCtor := 0
	jobsMounts := 0

	ast.Inspect(cf, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if isJobsHandlerConstructorCall(call) {
			handlerCtor++
		}
		return true
	})
	ast.Inspect(rf, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
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

// TestJobsWriteRoute_MountedBehindGates asserts the Phase 6 D8 wiring:
// the gated `PATCH /jobs/{id}` route is mounted on the composition
// root with BOTH `requireAuth` AND `requireRecruiter` as middleware
// arguments on a chi `With(...).Patch(...)` mutation. The test scans
// main.go's AST and finds:
//
//  1. A chi mutation whose method is `Patch` and whose first string
//     argument is the path template `/jobs/{id}`.
//  2. The same mutation's argument list contains BOTH identifiers
//     `requireAuth` and `requireRecruiter` (the hoisted variables).
//
// The existing TestJobsMount_PublicReadRoutes keeps passing unchanged
// (the public mount stays public); TestRequireAuth_MountedOnMeRoutes
// now also recognizes the hoisted `requireAuth` variable.
//
// The guard fails the moment the PATCH route is moved out from
// behind the gates (a regression where the write path becomes
// reachable unauthenticated).
func TestJobsWriteRoute_MountedBehindGates(t *testing.T) {
	filePath := routerFile

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	var patchRoutes []string              // path templates of found Patch calls
	var properlyGatedPatchRoutes []string // subset that has BOTH gates

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		// We look for `r.With(...).Patch("/jobs/{id}", …)` chained
		// calls. AST shape:
		//   outer CallExpr.Fun = SelectorExpr{
		//       X:  CallExpr{Fun: SelectorExpr{r, With}, Args: [requireAuth, requireRecruiter]},
		//       Sel: Patch,
		//   }
		//   outer CallExpr.Args = ["/jobs/{id}", jobHandlers.UpdateJob]
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Patch" {
			return true
		}
		// The X side of the selector must be a With(...) CallExpr.
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok {
			return true
		}
		if !isWithCall(inner) {
			return true
		}
		// First arg must be the path template "/jobs/{id}".
		path, ok := patchPathLiteral(call)
		if !ok || path != `"/jobs/{id}"` {
			return true
		}
		patchRoutes = append(patchRoutes, path)
		// The inner With(...) call must reference BOTH requireAuth
		// AND requireRecruiter in its argument list.
		if referencesIdentifier(inner, "requireAuth") &&
			referencesIdentifier(inner, "requireRecruiter") {
			properlyGatedPatchRoutes = append(properlyGatedPatchRoutes, path)
		}
		return true
	})

	if len(properlyGatedPatchRoutes) < 1 {
		t.Fatalf("expected at least one `With(requireAuth, requireRecruiter).Patch(\"/jobs/{id}\", ...)` mutation in main.go; got %d (found %d PATCH /jobs/{id} calls without both gates)",
			len(properlyGatedPatchRoutes), len(patchRoutes))
	}

	t.Logf("parsed %s: %d PATCH /jobs/{id} routes total, %d gated behind both requireAuth+requireRecruiter",
		filePath, len(patchRoutes), len(properlyGatedPatchRoutes))
}

// isWithCall returns true if the call is `With(...)` (bare identifier
// OR selector, e.g. r.With). We narrow to `With` rather than the full
// mutation set so the guard targets the exact pattern D8 produces:
// a `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", …)`.
func isWithCall(call *ast.CallExpr) bool {
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return fn.Name == "With"
	case *ast.SelectorExpr:
		return fn.Sel.Name == "With"
	}
	return false
}

// patchPathLiteral returns the string literal of a `Patch("<path>", …)`
// call's first argument (path template) and a `true` second value when
// the call is shaped exactly that way. Used by
// TestJobsWriteRoute_MountedBehindGates to find the gated write route.
func patchPathLiteral(call *ast.CallExpr) (string, bool) {
	fn, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || fn.Sel.Name != "Patch" {
		return "", false
	}
	if len(call.Args) == 0 {
		return "", false
	}
	bl, ok := call.Args[0].(*ast.BasicLit)
	if !ok || bl.Kind != token.STRING {
		return "", false
	}
	return bl.Value, true
}

// TestJobsCreateRoute_MountedBehindGates asserts the Phase 6 D9 wiring
// for POST /jobs (jobs-create). It mirrors TestJobsWriteRoute_
// MountedBehindGates: an AST walk finds a chi `Post("/jobs", …)`
// mutation whose inner `With(...)` argument list references BOTH
// `requireAuth` AND `requireRecruiter` (the hoisted variables). The
// guard fails the moment the POST route is moved out from behind the
// gates (a regression where the write path becomes reachable
// unauthenticated).
func TestJobsCreateRoute_MountedBehindGates(t *testing.T) {
	filePath := routerFile

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	var postRoutes []string              // path templates of found Post calls
	var properlyGatedPostRoutes []string // subset that has BOTH gates

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		// We look for `r.With(...).Post("/jobs", ...)` chained calls.
		// AST shape:
		//   outer CallExpr.Fun = SelectorExpr{
		//       X:  CallExpr{Fun: SelectorExpr{r, With}, Args: [requireAuth, requireRecruiter]},
		//       Sel: Post,
		//   }
		//   outer CallExpr.Args = ["/jobs", jobHandlers.CreateJob]
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Post" {
			return true
		}
		// The X side of the selector must be a With(...) CallExpr.
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok {
			return true
		}
		if !isWithCall(inner) {
			return true
		}
		// First arg must be the path template "/jobs".
		path, ok := postPathLiteral(call)
		if !ok || path != `"/jobs"` {
			return true
		}
		postRoutes = append(postRoutes, path)
		// The inner With(...) call must reference BOTH requireAuth
		// AND requireRecruiter in its argument list.
		if referencesIdentifier(inner, "requireAuth") &&
			referencesIdentifier(inner, "requireRecruiter") {
			properlyGatedPostRoutes = append(properlyGatedPostRoutes, path)
		}
		return true
	})

	if len(properlyGatedPostRoutes) < 1 {
		t.Fatalf("expected at least one `With(requireAuth, requireRecruiter).Post(\"/jobs\", ...)` mutation in main.go; got %d (found %d POST /jobs calls without both gates)",
			len(properlyGatedPostRoutes), len(postRoutes))
	}

	t.Logf("parsed %s: %d POST /jobs routes total, %d gated behind both requireAuth+requireRecruiter",
		filePath, len(postRoutes), len(properlyGatedPostRoutes))
}

// postPathLiteral is the Post-route companion to patchPathLiteral. It
// returns the string literal of a `Post("<path>", …)` call's first
// argument and a `true` second value when the call is shaped exactly
// that way.
func postPathLiteral(call *ast.CallExpr) (string, bool) {
	fn, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || fn.Sel.Name != "Post" {
		return "", false
	}
	if len(call.Args) == 0 {
		return "", false
	}
	bl, ok := call.Args[0].(*ast.BasicLit)
	if !ok || bl.Kind != token.STRING {
		return "", false
	}
	return bl.Value, true
}

// TestJobsSoftDeleteRoute_MountedBehindGates asserts the jobs-soft-
// delete slice wiring: a chi `Delete("/jobs/{id}", …)` mutation whose
// inner `With(...)` argument list references BOTH `requireAuth` AND
// `requireRecruiter` (the hoisted variables, design D8). The guard
// fails the moment the DELETE route is moved out from behind the
// gates (a regression where the soft-delete write path becomes
// reachable unauthenticated).
//
// Mirrors TestJobsWriteRoute_MountedBehindGates (PATCH) and
// TestJobsCreateRoute_MountedBehindGates (POST): the three
// composition-root guards share the same idiom so a future refactor
// that touches the gate wiring fails all three tests in lockstep
// (rather than leaving one verb ungated by accident).
func TestJobsSoftDeleteRoute_MountedBehindGates(t *testing.T) {
	filePath := routerFile

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	var deleteRoutes []string              // path templates of found Delete calls
	var properlyGatedDeleteRoutes []string // subset that has BOTH gates

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		// We look for `r.With(...).Delete("/jobs/{id}", …)` chained
		// calls. AST shape:
		//   outer CallExpr.Fun = SelectorExpr{
		//       X:  CallExpr{Fun: SelectorExpr{r, With}, Args: [requireAuth, requireRecruiter]},
		//       Sel: Delete,
		//   }
		//   outer CallExpr.Args = ["/jobs/{id}", jobHandlers.SoftDeleteJob]
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Delete" {
			return true
		}
		// The X side of the selector must be a With(...) CallExpr.
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok {
			return true
		}
		if !isWithCall(inner) {
			return true
		}
		// First arg must be the path template "/jobs/{id}".
		path, ok := deletePathLiteral(call)
		if !ok || path != `"/jobs/{id}"` {
			return true
		}
		deleteRoutes = append(deleteRoutes, path)
		// The inner With(...) call must reference BOTH requireAuth
		// AND requireRecruiter in its argument list.
		if referencesIdentifier(inner, "requireAuth") &&
			referencesIdentifier(inner, "requireRecruiter") {
			properlyGatedDeleteRoutes = append(properlyGatedDeleteRoutes, path)
		}
		return true
	})

	if len(properlyGatedDeleteRoutes) < 1 {
		t.Fatalf("expected at least one `With(requireAuth, requireRecruiter).Delete(\"/jobs/{id}\", ...)` mutation in main.go; got %d (found %d DELETE /jobs/{id} calls without both gates)",
			len(properlyGatedDeleteRoutes), len(deleteRoutes))
	}

	t.Logf("parsed %s: %d DELETE /jobs/{id} routes total, %d gated behind both requireAuth+requireRecruiter",
		filePath, len(deleteRoutes), len(properlyGatedDeleteRoutes))
}

// deletePathLiteral is the Delete-route companion to patchPathLiteral
// and postPathLiteral. It returns the string literal of a
// `Delete("<path>", …)` call's first argument and a `true` second
// value when the call is shaped exactly that way. Used by
// TestJobsSoftDeleteRoute_MountedBehindGates to find the gated DELETE
// route.
func deletePathLiteral(call *ast.CallExpr) (string, bool) {
	fn, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || fn.Sel.Name != "Delete" {
		return "", false
	}
	if len(call.Args) == 0 {
		return "", false
	}
	bl, ok := call.Args[0].(*ast.BasicLit)
	if !ok || bl.Kind != token.STRING {
		return "", false
	}
	return bl.Value, true
}

// TestApplicationsApplyRoute_MountedBehindAuth asserts the applications
// slice candidate-apply wiring: a chi `Post("/jobs/{jobId}/applications",
// …)` mutation whose inner `With(...)` argument list references
// `requireAuth` (candidate apply is RequireAuth-ONLY — the candidate's
// company membership is NOT consulted). The guard fails the moment the
// apply route is moved out from behind auth (a regression where an
// unauthenticated candidate can apply).
func TestApplicationsApplyRoute_MountedBehindAuth(t *testing.T) {
	filePath := routerFile

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	var postRoutes []string              // path templates of found Post calls
	var properlyGatedPostRoutes []string // subset that references requireAuth

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Post" {
			return true
		}
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok || !isWithCall(inner) {
			return true
		}
		path, ok := postPathLiteral(call)
		if !ok || path != `"/jobs/{jobId}/applications"` {
			return true
		}
		postRoutes = append(postRoutes, path)
		if referencesIdentifier(inner, "requireAuth") {
			properlyGatedPostRoutes = append(properlyGatedPostRoutes, path)
		}
		return true
	})

	if len(properlyGatedPostRoutes) < 1 {
		t.Fatalf("expected at least one `With(requireAuth).Post(\"/jobs/{jobId}/applications\", ...)` mutation in main.go; got %d (found %d POST /jobs/{jobId}/applications calls without requireAuth)",
			len(properlyGatedPostRoutes), len(postRoutes))
	}

	t.Logf("parsed %s: %d POST /jobs/{jobId}/applications routes total, %d gated behind requireAuth",
		filePath, len(postRoutes), len(properlyGatedPostRoutes))
}

// TestApplicationsRecruiterRoute_MountedBehindGates asserts the
// applications slice recruiter-pipeline wiring: a chi
// `With(requireAuth, requireRecruiter).Route("/jobs/{jobId}/applications",
// fn)` mutation whose inner `With(...)` argument list references BOTH
// `requireAuth` AND `requireRecruiter`, and whose callback declares Get
// and Patch mutations (every recruiter method lives inside the gated
// subtree). The guard fails the moment a recruiter route is moved out
// from behind the gates or onto the public /jobs mount.
func TestApplicationsRecruiterRoute_MountedBehindGates(t *testing.T) {
	filePath := routerFile

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	var gatedRoutes []string

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Route" {
			return true
		}
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok || !isWithCall(inner) {
			return true
		}
		if len(call.Args) < 2 {
			return true
		}
		bl, ok := call.Args[0].(*ast.BasicLit)
		if !ok || bl.Kind != token.STRING || bl.Value != `"/jobs/{jobId}/applications"` {
			return true
		}
		if !referencesIdentifier(inner, "requireAuth") ||
			!referencesIdentifier(inner, "requireRecruiter") {
			return true
		}
		gatedRoutes = append(gatedRoutes, bl.Value)
		return true
	})

	if len(gatedRoutes) < 1 {
		t.Fatalf("expected at least one `With(requireAuth, requireRecruiter).Route(\"/jobs/{jobId}/applications\", fn)` mutation in main.go; got %d",
			len(gatedRoutes))
	}

	t.Logf("parsed %s: %d gated recruiter Route(\"/jobs/{jobId}/applications\") subtrees behind both requireAuth+requireRecruiter",
		filePath, len(gatedRoutes))
}

// industryRegistrationMethods is the chi.Router method set that can
// register a route. The scan collects ANY of them targeting the exact
// "/industries" path literal so a duplicate cannot hide behind a
// different mutation.
func industryRegistrationMethods(name string) bool {
	switch name {
	case "Mount", "Get", "Post", "Put", "Patch", "Delete", "Route", "Group", "Handle", "HandleFunc":
		return true
	}
	return false
}

// TestIndustriesRoute_SingleCanonicalRegistration asserts the WS3B
// "exactly one industries registration" spec scenario at the composition
// root: main.go calls the production-owned registrar
// (industrieshttp.RegisterRoutes) EXACTLY once and itself registers NO
// literal "/industries" route. A reintroduced r.Get/r.Mount
// ("/industries", ...) duplicate or a second registrar call fails here;
// the path literal is matched exactly so a typo cannot sneak past.
func TestIndustriesRoute_SingleCanonicalRegistration(t *testing.T) {
	filePath := routerFile

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}

	var registrarCalls, literalRegs []string

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if x, ok := sel.X.(*ast.Ident); ok && x.Name == "industrieshttp" && sel.Sel.Name == "RegisterRoutes" {
			registrarCalls = append(registrarCalls, sel.Sel.Name)
			if len(call.Args) == 0 || !isBareIdentExpr(call.Args[0]) {
				t.Fatalf("industrieshttp.RegisterRoutes first argument must be the bare router identifier, not a With-wrapped subrouter")
			}
		}
		if industryRegistrationMethods(sel.Sel.Name) && len(call.Args) > 0 {
			if bl, ok := call.Args[0].(*ast.BasicLit); ok && bl.Kind == token.STRING && bl.Value == `"/industries"` {
				literalRegs = append(literalRegs, sel.Sel.Name)
			}
		}
		return true
	})

	if len(registrarCalls) != 1 {
		t.Fatalf("expected exactly ONE industrieshttp.RegisterRoutes call in main.go, got %d", len(registrarCalls))
	}
	if len(literalRegs) != 0 {
		t.Fatalf("no literal /industries chi registration may remain in main.go; the route must go through industrieshttp.RegisterRoutes, got %v", literalRegs)
	}

	t.Logf("parsed %s: %d industrieshttp.RegisterRoutes call(s), %d literal /industries registrations", filePath, len(registrarCalls), len(literalRegs))
}

// mwMainPEM is a fixed valid PKIX RSA public key for the factory's pem mode.
const mwMainPEM = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA39J11KFuFgePmdlaTa5B\nUtD+daejJ5Qo9AQx7TOLI1uchwCqJRIrUoK/CQ2vlkgq7GDafubmztexTwFWoj8r\nRjOuE6IldM7TyN67EWiEyZ5jW6wygLEpUNm5zNWOUtQI5bGxtqfS8tUHDRr7TVgx\ndkjOkopemuQR8n6ux4l27fsT+jPk6P2YR0y/qmwnwCYJQyRJmN9hdAz7X4DGh8du\nAcNqQFHepjHvcmkKwAhWMQJpWHVugAWqlSkbWLp15/1ch2T5O64KZrShaZAENwEh\npeSLQHY6mputbSXsITVGkMyX3kiVvvgOi/7DxKvk4u7NDvFQqrlgi4nzIzL4oQ/B\nbwIDAQAB\n-----END PUBLIC KEY-----\n"

// TestRun_StartsOnlyWithValidExplicitMode: run() must fail on verifier misconfiguration BEFORE infrastructure
// wiring (DSN/pool); a valid explicit local pem selection reaches DATABASE_URL.
func TestRun_StartsOnlyWithValidExplicitMode(t *testing.T) {
	tests := []struct {
		name    string
		appEnv  string
		mode    string
		wantErr string // error substring; non-DSN cases must NOT hit DATABASE_URL
	}{
		{"missing mode aborts startup before infrastructure wiring", "local", "", "IDENTITY_JWT_MODE"},
		{"production pem mode is rejected", "production", "pem", "not allowed in production"},
		{"valid explicit local pem passes the verifier gate", "local", "pem", "DATABASE_URL"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for k, v := range map[string]string{
				"APP_ENV": tc.appEnv, "IDENTITY_JWT_MODE": tc.mode,
				"IDENTITY_JWT_PUBLIC_KEY_PEM": mwMainPEM, "IDENTITY_JWT_ISSUER": "https://cognito-idp.test.local",
				"IDENTITY_JWT_TOKEN_USE": "", "IDENTITY_JWT_CACHE_TTL": "", "IDENTITY_JWT_FETCH_TIMEOUT": "",
				"IDENTITY_JWT_AUDIENCE": "test-client-id", "DATABASE_URL": "",
			} {
				t.Setenv(k, v)
			}
			err := run()
			if err == nil {
				t.Fatalf("run() must fail (want %q)", tc.wantErr)
			}
			msg := err.Error()
			if !strings.Contains(msg, tc.wantErr) {
				t.Fatalf("run() error: want substring %q, got: %v", tc.wantErr, err)
			}
		})
	}
}

// TestVerifierComposition_AstGuards scans main.go's AST for the WS5C composition contract: factory-only verifier wiring with no deny-all
// fallback, and the /me subtree wrapped with r.Use(requireAuth).
func TestVerifierComposition_AstGuards(t *testing.T) {
	f := mustParse(t, compositionFile)
	src, err := os.ReadFile(compositionFile)
	if err != nil {
		t.Fatalf("read %s: %v", compositionFile, err)
	}
	rf := mustParse(t, routerFile)

	t.Run("factory-only wiring, no deny-all fallback", func(t *testing.T) {
		factoryCalls := 0
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if id, ok := sel.X.(*ast.Ident); ok && id.Name == "auth" && sel.Sel.Name == "NewVerifierConfigFromEnv" {
				factoryCalls++
			}
			return true
		})
		for _, sym := range []string{"denyAllVerifier", "errFailClosedVerifier", "buildVerifierFromEnv"} {
			if strings.Contains(string(src), sym) {
				t.Errorf("deny-all fallback symbol %q must be removed from main.go", sym)
			}
		}
		if factoryCalls != 1 {
			t.Fatalf("expected exactly ONE auth.NewVerifierConfigFromEnv call in main.go (the WS5A factory is the only verifier source), got %d", factoryCalls)
		}
	})

	t.Run("me subtree wrapped with requireAuth", func(t *testing.T) {
		wrapped := false
		ast.Inspect(rf, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "Route" || len(call.Args) < 2 {
				return true
			}
			if bl, ok := call.Args[0].(*ast.BasicLit); !ok || bl.Kind != token.STRING || bl.Value != `"/me"` {
				return true
			}
			fn, ok := call.Args[1].(*ast.FuncLit)
			if !ok {
				return true
			}
			ast.Inspect(fn.Body, func(m ast.Node) bool {
				if inner, ok := m.(*ast.CallExpr); ok {
					if s, ok := inner.Fun.(*ast.SelectorExpr); ok && s.Sel.Name == "Use" && referencesIdentifier(inner, "requireAuth") {
						wrapped = true
						return false
					}
				}
				return true
			})
			return true
		})
		if !wrapped {
			t.Fatalf(`the /me/* subtree must be wrapped with r.Use(requireAuth) inside r.Route("/me", ...)`)
		}
	})
}

// routerFile = chi router owner (router.go since WS6B-1b-b); compositionFile = composition root.
const routerFile = "router.go"
const compositionFile = "main.go"

// TestRouterOwner_HealthAndReadinessMounted pins the WS6B-1b health composition
// (design §8.1): /healthz mounts health.Healthz (static liveness, never touches
// the DB port) and /readyz mounts health.Readyz (narrow ping port + configured
// timeout). Fails pre-rewiring: inline DB-pinging /healthz, no /readyz at all.
func TestRouterOwner_HealthAndReadinessMounted(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, routerFile, nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("cannot parse router owner %s: %v", routerFile, err)
	}

	var healthz, readyz int
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Get" || len(call.Args) < 2 {
			return true
		}
		path, ok := chiPathLiteral(call)
		if !ok {
			return true
		}
		// Asserted receiver/type: the handler must call the expected health-package runtime constructor.
		h, ok := call.Args[1].(*ast.CallExpr)
		if !ok {
			return true
		}
		hs, ok := h.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		owner, ok := hs.X.(*ast.Ident)
		if !ok {
			return true
		}
		switch path {
		case `"/healthz"`:
			// Liveness: health.Healthz over the pool (narrow Pinger port), not an inline DB-pinging handler.
			if owner.Name != "health" || hs.Sel.Name != "Healthz" ||
				len(h.Args) != 1 || !referencesIdentifier(h, "pool") {
				t.Errorf("/healthz must mount health.Healthz(pool); got %s.%s", owner.Name, hs.Sel.Name)
				return true
			}
			healthz++
		case `"/readyz"`:
			// Readiness (ws6c-4a correction, ordinal 150): the registration
			// must be the EXACT production call on the EXACT root-router
			// receiver:
			//
			//	r.Get("/readyz", health.Readyz(d.pool, d.readinessTimeout,
			//		d.readinessLogger, d.readinessMetrics))
			//
			// The Get receiver must be exactly the bare identifier r (a
			// sub-router or any other receiver never satisfies this guard),
			// and every readiness argument must be the EXACT direct selector
			// expression at its position — identifiers nested anywhere inside
			// a larger expression (the previous recursive
			// referencesIdentifier scan) never satisfy the guard. The exact
			// health-package owner check is preserved.
			if !isSelectorOnReceiver(call.Fun, "r", "Get") {
				t.Errorf("/readyz must be registered on the exact root-router receiver r.Get(...); got a non-root Get receiver for path %s", path)
				return true
			}
			if owner.Name != "health" || hs.Sel.Name != "Readyz" || len(h.Args) != 4 {
				t.Errorf("/readyz must mount health.Readyz(...); got %s.%s", owner.Name, hs.Sel.Name)
				return true
			}
			wantReadyzArgs := [4]string{"pool", "readinessTimeout", "readinessLogger", "readinessMetrics"}
			for i, wantArg := range wantReadyzArgs {
				if !isSelectorOnReceiver(h.Args[i], "d", wantArg) {
					t.Errorf("health.Readyz argument %d must be the EXACT direct selector d.%s (nested or non-direct expressions never satisfy the guard); got %s", i, wantArg, types.ExprString(h.Args[i]))
					return true
				}
			}
			readyz++
		}
		return true
	})
	if healthz != 1 || readyz != 1 {
		t.Fatalf("router owner must register exactly one /healthz and one /readyz through the runtime health handlers (healthz=%d readyz=%d)", healthz, readyz)
	}

	t.Logf("parsed %s: exactly one /healthz -> health.Healthz and one /readyz -> health.Readyz", routerFile)
}

// TestComposition_RootUsesRuntimeLifecycle pins the WS6B-1b composition contract:
// main.go builds the server through runtime/config + runtime/server.New/Run with no
// inline http.Server literal or ListenAndServe/Shutdown lifecycle. Fails pre-rewiring.
func TestComposition_RootUsesRuntimeLifecycle(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, compositionFile, nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("cannot parse %s: %v", compositionFile, err)
	}

	var newCalls, runCalls, defaultCfgCalls, serverLiterals, lifecycleRefs int
	ast.Inspect(f, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.CallExpr:
			if sel, ok := x.Fun.(*ast.SelectorExpr); ok {
				if id, ok := sel.X.(*ast.Ident); ok {
					switch {
					case id.Name == "server" && sel.Sel.Name == "New":
						newCalls++
					case id.Name == "server" && sel.Sel.Name == "Run":
						runCalls++
					case id.Name == "runtimeconfig" && sel.Sel.Name == "DefaultServerConfig":
						defaultCfgCalls++
					}
				}
			}
		case *ast.CompositeLit:
			if sel, ok := x.Type.(*ast.SelectorExpr); ok {
				if id, ok := sel.X.(*ast.Ident); ok && id.Name == "http" && sel.Sel.Name == "Server" {
					serverLiterals++
				}
			}
		case *ast.SelectorExpr:
			if x.Sel.Name == "ListenAndServe" || x.Sel.Name == "Shutdown" {
				lifecycleRefs++
			}
		}
		return true
	})

	if newCalls < 1 || runCalls < 1 || defaultCfgCalls < 1 {
		t.Fatalf("composition root must wire runtime/server.New, runtime/server.Run and runtime/config.DefaultServerConfig (got server.New=%d server.Run=%d DefaultServerConfig=%d)",
			newCalls, runCalls, defaultCfgCalls)
	}
	if serverLiterals != 0 || lifecycleRefs != 0 {
		t.Fatalf("composition root must not build its own http.Server literal or inline ListenAndServe/Shutdown lifecycle (http.Server literals=%d, ListenAndServe/Shutdown refs=%d)",
			serverLiterals, lifecycleRefs)
	}

	t.Logf("parsed %s: runtimeconfig.DefaultServerConfig=%d server.New=%d server.Run=%d, no inline http.Server lifecycle", routerFile, defaultCfgCalls, newCalls, runCalls)
}

// TestMainComposition_DelegatesRouterConstruction pins the WS6B-1b-b split: main.go builds the router via ONE newRouter call and registers no chi routes.
func TestMainComposition_DelegatesRouterConstruction(t *testing.T) {
	var newRouterCalls, chiRegistrations int
	ast.Inspect(mustParse(t, compositionFile), func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok {
			if id, isId := call.Fun.(*ast.Ident); isId && id.Name == "newRouter" {
				newRouterCalls++
			}
			if isChiRouteMutationCall(call) {
				chiRegistrations++
			}
		}
		return true
	})
	if newRouterCalls != 1 || chiRegistrations != 0 {
		t.Fatalf("main.go must delegate router construction via exactly one newRouter call and contain no chi registrations; got newRouter=%d chiRegistrations=%d", newRouterCalls, chiRegistrations)
	}
}

// TestRouteTopology_ExactRegistrations pins the full chi route topology of the router
// owner as an exact sorted (method, path) multiset over all string-literal
// registrations (incl. nested Route closures); any added/removed/renamed/re-gated
// registration drifts the multiset and fails, proving topology is preserved.
func TestRouteTopology_ExactRegistrations(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, routerFile, nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("cannot parse router owner %s: %v", routerFile, err)
	}

	var got []string
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		switch sel.Sel.Name {
		case "Get", "Post", "Patch", "Delete", "Mount", "Route":
			path, ok := chiPathLiteral(call)
			if !ok {
				return true
			}
			if wc, isCall := sel.X.(*ast.CallExpr); isCall && (sel.Sel.Name == "Get" || sel.Sel.Name == "Mount") &&
				!(sel.Sel.Name == "Get" && strings.Trim(path, `"`) == "/company/members" && referencesIdentifier(wc, "requireRecruiter")) {
				t.Fatalf("Get/Mount receiver must be the bare router identifier; direct With-wrapping of %s %s evades the pinned gating topology (sole exemption: Get /company/members on a requireRecruiter-wrapped receiver)", sel.Sel.Name, strings.Trim(path, `"`))
			}
			if wc, isCall := sel.X.(*ast.CallExpr); sel.Sel.Name == "Get" && strings.Trim(path, `"`) == "/company/members" && (!isCall || !isWithCall(wc) || len(wc.Args) != 1 || !referencesIdentifier(wc, "requireRecruiter")) {
				t.Fatalf("Get /company/members must be registered as the exact recruiter-gated triple r.With(requireRecruiter).Get(\"/company/members\"); a bare or otherwise-ungated registration evades the pinned gating topology")
			}
			got = append(got, sel.Sel.Name+" "+strings.Trim(path, `"`))
		}
		return true
	})
	sort.Strings(got)

	want := []string{
		"Delete /company",
		"Delete /company/members/{id}",
		"Delete /jobs/{id}",
		"Get /",
		"Get /{id}",
		"Get /applications",
		"Get /companies/{id}",
		"Get /company",
		"Get /company/members",
		"Get /healthz",
		"Get /readyz",
		"Mount /jobs",
		"Mount /profile",
		"Patch /{id}/transition",
		"Patch /company",
		"Patch /company/members/{id}",
		"Patch /jobs/{id}",
		"Post /companies",
		"Post /company/members",
		"Post /jobs",
		"Post /jobs/{jobId}/applications",
		"Route /jobs/{jobId}/applications",
		"Route /me",
	}
	sort.Strings(want)

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("route topology drifted;\n got: %v\nwant: %v", got, want)
	}

	t.Logf("parsed %s: all %d chi registrations match the pinned topology exactly", routerFile, len(got))
}

// TestStartupLog_EffectiveNonSecretConfig is the behavioral RED/GREEN test for
// the Task 6.3 startup event (ws6c-3a): the helper must emit EXACTLY ONE
// structured JSON record whose key set is the explicit non-secret allowlist —
// addr, every effective server/readiness/drain timeout (canonical
// time.Duration.String()), and the numeric JSON request-body cap — plus only
// the standard slog keys (time/level/msg). event and action are stable semantic
// keys. Durations are exact strings; the byte limit is a number. No environment
// map, DSN, JWT/JWKS/PEM/token material, credential, error, or env key/value may
// appear.
func TestStartupLog_EffectiveNonSecretConfig(t *testing.T) {
	cfg := runtimeconfig.ServerConfig{
		Addr:              ":9099",
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		ReadinessTimeout:  2 * time.Second,
		DrainTimeout:      10 * time.Second,
	}
	var buf bytes.Buffer
	logStartupConfig(slog.New(slog.NewJSONHandler(&buf, nil)), cfg, 1_048_576)

	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	if len(lines) != 1 || lines[0] == "" {
		t.Fatalf("startup helper must emit EXACTLY ONE JSON record; got %d line(s): %q", len(lines), buf.String())
	}
	var rec map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &rec); err != nil {
		t.Fatalf("startup record is not valid JSON: %v\nline: %s", err, lines[0])
	}
	want := map[string]any{
		"level":               "INFO",
		"msg":                 "startup",
		"event":               "startup",
		"action":              "startup_config",
		"addr":                ":9099",
		"read_header_timeout": "5s",
		"read_timeout":        "10s",
		"write_timeout":       "30s",
		"idle_timeout":        "2m0s",
		"readiness_timeout":   "2s",
		"drain_timeout":       "10s",
		"max_json_body_bytes": float64(1_048_576),
	}
	if _, ok := rec["time"]; !ok {
		t.Errorf("standard slog key time missing from startup record: %s", lines[0])
	}
	delete(rec, "time")
	if !reflect.DeepEqual(rec, want) {
		t.Fatalf("startup record key set or values drifted (exact non-secret allowlist enforced);\n got: %v\nwant: %v", rec, want)
	}

	t.Run("no forbidden key or value fragments", func(t *testing.T) {
		low := strings.ToLower(buf.String())
		for _, frag := range []string{"database", "dsn", "jwt", "jwks", "pem", "secret", "token", "credential", "password", "error", "env"} {
			if strings.Contains(low, frag) {
				t.Errorf("startup record contains forbidden fragment %q: %s", frag, buf.String())
			}
		}
	})
}

// TestBodyLimitBinding_Guarded pins the 1 MiB JSON request-body cap that the
// startup event reports to the values actually enforced at decode time. The
// limit is NOT centralized: the JSON-accepting feature handlers each compile
// their own identical maxJSONBodyBytes constant, and main.go compiles
// startupMaxJSONBodyBytes for the startup record; renaming or changing ANY
// copy without the others fails here, keeping the startup value truthful.
// Generation-110 correction (verifier blocker sha256:172d8636…0a4): beyond
// the declaration pins — which could not prove the reported 1 MiB value
// reaches decode time and omitted the companies member handler (a borrower
// of the companies constant, not a declarer) — a bounded AST census over ALL
// production feature .go files pins every production httpjson.DecodeJSON
// call: exactly the five census files, two calls per file, ten total, exactly
// four arguments, fourth argument the BARE identifier maxJSONBodyBytes.
// Generation-111 correction (sha256:e090cf62…1bd): parser object ownership
// binds both identifiers: local maxJSONBodyBytes shadows fail, and a local
// httpjson receiver is rejected rather than counted as the imported package.
func TestBodyLimitBinding_Guarded(t *testing.T) {
	const want = int64(1_048_576)
	cf := mustParse(t, compositionFile)
	if got, ok := intConstValue(cf, "startupMaxJSONBodyBytes"); !ok || got != want {
		t.Fatalf("composition root must pin startupMaxJSONBodyBytes to %d (the enforced 1 MiB cap the startup event reports); got %d, present=%v", want, got, ok)
	}
	calls := censusFeatureDecodeJSON(t, "../../internal/features")
	var extra []string
	for p := range calls {
		if !slices.Contains(decodeJSONCensusFiles, p) {
			extra = append(extra, p)
		}
	}
	if len(extra) > 0 {
		sort.Strings(extra)
		t.Fatalf("every production feature httpjson.DecodeJSON call must live in the pinned census files; production feature file(s) omitted from the census contain call(s): %v", extra)
	}
	for _, p := range decodeJSONCensusFiles {
		if lines := calls[p]; len(lines) != decodeJSONCallsPerFile {
			t.Fatalf("%s must contain EXACTLY %d httpjson.DecodeJSON call(s) (full production census is %d); got %d at lines %v", p, decodeJSONCallsPerFile, decodeJSONCallsTotal, len(lines), lines)
		}
	}
	total := 0
	for _, lines := range calls {
		total += len(lines)
	}
	if total != decodeJSONCallsTotal {
		t.Fatalf("production feature httpjson.DecodeJSON census must count EXACTLY %d calls across the %d pinned files; got %d", decodeJSONCallsTotal, len(decodeJSONCensusFiles), total)
	}
	for _, p := range decodeJSONDeclaringFiles {
		f := mustParse(t, p)
		if got, ok := intConstValue(f, "maxJSONBodyBytes"); !ok || got != want {
			t.Fatalf("guarded feature body limit drifted: %s must keep maxJSONBodyBytes == %d to match the startup-reported cap; got %d, present=%v", p, want, got, ok)
		}
	}
	mf := mustParse(t, decodeJSONBorrowerFile)
	if _, ok := intConstValue(mf, "maxJSONBodyBytes"); ok {
		t.Fatalf("%s must BORROW the companies package maxJSONBodyBytes constant (the enforced 1 MiB cap) instead of declaring a second copy; found its own declaration", decodeJSONBorrowerFile)
	}
	t.Logf("guarded binding: startupMaxJSONBodyBytes in %s and maxJSONBodyBytes in %d declaring files all equal %d; census: EXACTLY %d production httpjson.DecodeJSON calls, %d per file across %d pinned files (incl. borrower %s), four args each, fourth argument bare maxJSONBodyBytes", compositionFile, len(decodeJSONDeclaringFiles), want, decodeJSONCallsTotal, decodeJSONCallsPerFile, len(decodeJSONCensusFiles), decodeJSONBorrowerFile)
}

// decodeJSONCensusFiles are the ONLY production feature files allowed to carry
// httpjson.DecodeJSON calls (two per file).
var decodeJSONCensusFiles = []string{
	"../../internal/features/applications/infrastructure/http/applicationHandler.go",
	"../../internal/features/candidates/infrastructure/http/handler.go",
	"../../internal/features/companies/infrastructure/http/handler.go",
	"../../internal/features/companies/infrastructure/http/memberHandler.go",
	"../../internal/features/jobs/infrastructure/http/jobHandler.go",
}

// decodeJSONDeclaringFiles own a package-level maxJSONBodyBytes constant.
var decodeJSONDeclaringFiles = []string{
	"../../internal/features/applications/infrastructure/http/applicationHandler.go",
	"../../internal/features/candidates/infrastructure/http/handler.go",
	"../../internal/features/companies/infrastructure/http/handler.go",
	"../../internal/features/jobs/infrastructure/http/jobHandler.go",
}

// decodeJSONBorrowerFile borrows the companies constant and declares no copy
// of its own; that absence is pinned, not assumed.
const decodeJSONBorrowerFile = "../../internal/features/companies/infrastructure/http/memberHandler.go"

const (
	decodeJSONCallsPerFile = 2
	decodeJSONCallsTotal   = 10
)

// httpjsonImportPath is the shared decode helper the census resolves per file.
const httpjsonImportPath = "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"

// censusFeatureDecodeJSON walks the production feature .go files under
// featuresRoot (excluding _test.go), resolves each file's httpjson import, and
// returns counted calls as file → call lines. A count requires the resolved
// import receiver with id.Obj == nil; a local same-named receiver fails. Arg 4
// must be bare maxJSONBodyBytes and bind to this file's package const, or be
// unresolved (Obj == nil) in borrower files; a local shadow fails.
func censusFeatureDecodeJSON(t *testing.T, featuresRoot string) map[string][]int {
	t.Helper()
	calls := make(map[string][]int)
	if werr := filepath.WalkDir(featuresRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		fset := token.NewFileSet()
		f, perr := parser.ParseFile(fset, path, nil, 0)
		if perr != nil {
			t.Fatalf("cannot parse production feature file %s: %v", path, perr)
		}
		localName, dotImported := resolveHTTPJSONImport(f)
		if dotImported {
			t.Fatalf("%s dot-imports the shared httpjson package; the decode census cannot resolve it", path)
		}
		if localName == "" {
			return nil // no httpjson import: cannot contribute a resolved call
		}
		var pkgLimit *ast.Object
		if f.Scope != nil {
			pkgLimit = f.Scope.Objects["maxJSONBodyBytes"]
		}
		ast.Inspect(f, func(n ast.Node) bool {
			call, isCall := n.(*ast.CallExpr)
			if !isCall {
				return true
			}
			sel, isSel := call.Fun.(*ast.SelectorExpr)
			if !isSel || sel.Sel.Name != "DecodeJSON" {
				return true
			}
			id, isId := sel.X.(*ast.Ident)
			if !isId || id.Name != localName {
				return true // receiver is not the resolved httpjson package
			}
			line := fset.Position(call.Pos()).Line
			if id.Obj != nil {
				t.Fatalf("receiver of the DecodeJSON call in %s (line %d) resolves to a function-local %q, not the imported shared httpjson package; the census rejects it instead of counting it", path, line, localName)
			}
			if len(call.Args) != 4 {
				t.Fatalf("httpjson.DecodeJSON call in %s (line %d) must take EXACTLY FOUR arguments; got %d", path, line, len(call.Args))
			}
			if arg4, isId := call.Args[3].(*ast.Ident); !isId || arg4.Name != "maxJSONBodyBytes" {
				t.Fatalf("fourth argument of the httpjson.DecodeJSON call in %s (line %d) must be the BARE package constant identifier maxJSONBodyBytes (the enforced 1 MiB cap); got %s", path, line, types.ExprString(call.Args[3]))
			} else if pkgLimit == nil {
				if arg4.Obj != nil {
					t.Fatalf("fourth argument of the httpjson.DecodeJSON call in %s (line %d) must remain unresolved in this file (the maxJSONBodyBytes const lives in a sibling file of the same package); got a function-local shadow owning its own object", path, line)
				}
			} else if arg4.Obj != pkgLimit {
				t.Fatalf("fourth argument of the httpjson.DecodeJSON call in %s (line %d) must bind to this file's package-level maxJSONBodyBytes const object; got a different object (function-local shadow)", path, line)
			}
			calls[path] = append(calls[path], line)
			return true
		})
		return nil
	}); werr != nil {
		t.Fatalf("cannot walk production feature tree %s: %v", featuresRoot, werr)
	}
	return calls
}

// resolveHTTPJSONImport resolves the local identifier bound to the shared
// httpjson package in f ("httpjson" unless aliased; empty when not imported)
// and flags dot imports. Ownership of the resolved identifier is verified at
// each use site via parser object resolution (id.Obj), not by a declaration
// scan.
func resolveHTTPJSONImport(f *ast.File) (localName string, dotImported bool) {
	for _, imp := range f.Imports {
		if path, uerr := strconv.Unquote(imp.Path.Value); uerr == nil && path == httpjsonImportPath {
			if imp.Name != nil && imp.Name.Name == "." {
				dotImported = true
				continue
			}
			localName = "httpjson"
			if imp.Name != nil {
				localName = imp.Name.Name
			}
		}
	}
	return
}

// intConstValue finds the package-level constant `name` in f and returns its
// parsed int64 value (underscore-separated literals normalized). ok=false when
// the constant is absent or its literal is not a plain integer.
func intConstValue(f *ast.File, name string) (int64, bool) {
	for _, d := range f.Decls {
		gd, isGen := d.(*ast.GenDecl)
		if !isGen || gd.Tok != token.CONST {
			continue
		}
		for _, spec := range gd.Specs {
			vs, isVal := spec.(*ast.ValueSpec)
			if !isVal {
				continue
			}
			for i, id := range vs.Names {
				if id.Name != name || i >= len(vs.Values) {
					continue
				}
				bl, isLit := vs.Values[i].(*ast.BasicLit)
				if !isLit || bl.Kind != token.INT {
					continue
				}
				v, err := strconv.ParseInt(strings.ReplaceAll(bl.Value, "_", ""), 10, 64)
				if err != nil {
					continue
				}
				return v, true
			}
		}
	}
	return 0, false
}

// TestStartupWiring_SingleStartupRecord pins the composition contract for the
// startup event: run() calls logStartupConfig EXACTLY ONCE (replacing — never
// duplicating — the former addr-only slog.Info("listening", ...) record), and
// the call sits after validated server construction (server.New) and before
// server.Run. The "listening" literal must be gone from main.go entirely.
func TestStartupWiring_SingleStartupRecord(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, compositionFile, nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("cannot parse %s: %v", compositionFile, err)
	}
	runFn := findFuncDecl(f, "run")
	if runFn == nil {
		t.Fatalf("func run not found in %s", compositionFile)
	}
	var logCalls, logLine, newLine, runLine int
	ast.Inspect(runFn.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if id, isId := call.Fun.(*ast.Ident); isId && id.Name == "logStartupConfig" {
			logCalls++
			logLine = fset.Position(call.Pos()).Line
		}
		if sel, isSel := call.Fun.(*ast.SelectorExpr); isSel {
			if id, isId := sel.X.(*ast.Ident); isId {
				switch {
				case id.Name == "server" && sel.Sel.Name == "New":
					newLine = fset.Position(call.Pos()).Line
				case id.Name == "server" && sel.Sel.Name == "Run":
					runLine = fset.Position(call.Pos()).Line
				}
			}
		}
		return true
	})
	if logCalls != 1 {
		t.Fatalf("run() must call logStartupConfig EXACTLY once (zero calls leaves no startup record; more duplicates it); got %d", logCalls)
	}
	if newLine == 0 || runLine == 0 || !(newLine < logLine && logLine < runLine) {
		t.Fatalf("the single logStartupConfig call (line %d) must sit after validated server construction server.New (line %d) and before server.Run (line %d)", logLine, newLine, runLine)
	}
	listening := 0
	ast.Inspect(f, func(n ast.Node) bool {
		if bl, ok := n.(*ast.BasicLit); ok && bl.Kind == token.STRING && bl.Value == `"listening"` {
			listening++
		}
		return true
	})
	if listening != 0 {
		t.Fatalf("the replaced addr-only slog.Info(\"listening\", ...) startup record must be gone from %s; got %d literal(s) (replaced, never duplicated)", compositionFile, listening)
	}
	t.Logf("parsed %s: exactly one logStartupConfig call at line %d, ordered server.New(%d) < logStartupConfig < server.Run(%d); no \"listening\" literal remains", compositionFile, logLine, newLine, runLine)
}
