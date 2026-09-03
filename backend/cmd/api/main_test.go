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
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

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
func TestRequireAuth_MountedOnMeRoutes(t *testing.T) {
	filePath := routerFile

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
	filePath := routerFile

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
	filePath := routerFile
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
	if err != nil {
		t.Skipf("cannot parse %s (run with cwd=backend/cmd/api): %v", filePath, err)
	}
	src, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read %s: %v", filePath, err)
	}

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
		ast.Inspect(f, func(n ast.Node) bool {
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

// routerFile names the router owner the guards scan; WS6B-1b keeps router
// construction in the composition root (physical extraction deferred to 1b-b),
// and guards name the owner instead of hardcoding a path assumption (design §8.1).
const routerFile = "main.go"

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
			// Readiness: health.Readyz over the pool port AND the configured timeout, never an ad-hoc literal.
			if owner.Name != "health" || hs.Sel.Name != "Readyz" ||
				len(h.Args) != 2 || !referencesIdentifier(h, "pool") ||
				!referencesIdentifier(h, "ReadinessTimeout") {
				t.Errorf("/readyz must mount health.Readyz(pool, <readiness timeout>); got %s.%s", owner.Name, hs.Sel.Name)
				return true
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
	f, err := parser.ParseFile(fset, routerFile, nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("cannot parse %s: %v", routerFile, err)
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
