package main

import (
	"go/ast"
	"go/types"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

var externalObservabilityPrefixes = strings.Fields(`
github.com/prometheus/ go.opentelemetry.io/ go.opencensus.io/
github.com/datadog/ gopkg.in/datadog. github.com/newrelic/ go.elastic.co/apm/
github.com/getsentry/ github.com/jaegertracing/ github.com/uber/jaeger-client-go
github.com/grafana/ github.com/pyroscope-io/ github.com/honeycombio/
github.com/influxdata/ github.com/rollbar/
`)

func TestTask63A2_ClosurePolicyRejectsExporterFixture(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		importPath string
		rejected   bool
	}{
		{name: "prometheus exporter", importPath: "github.com/prometheus/client_golang/prometheus/promhttp", rejected: true},
		{name: "otel exporter", importPath: "go.opentelemetry.io/otel/exporters/otlp/otlptrace", rejected: true},
		{name: "datadog exporter case insensitive", importPath: "github.com/DataDog/dd-trace-go/v2", rejected: true},
		{name: "standard library", importPath: "net/http", rejected: false},
		{name: "first party noop metrics", importPath: "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics", rejected: false},
		{name: "database driver", importPath: "github.com/jackc/pgx/v5", rejected: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isExternalObservabilityDependency(tt.importPath); got != tt.rejected {
				t.Fatalf("isExternalObservabilityDependency(%q) = %t, want %t", tt.importPath, got, tt.rejected)
			}
		})
	}
}

func TestTask63A2_CompiledAPIClosureHasNoObservabilityExporters(t *testing.T) {
	moduleRoot := findModuleRoot(t)
	cmd := exec.Command("go", "list", "-mod=readonly", "-deps", "-f={{.ImportPath}}", "./cmd/api")
	cmd.Dir = moduleRoot
	cmd.Env = offlineGoEnv()

	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("list compiled API dependencies without network or module changes: %v\n%s", err, output)
	}

	dependencies := strings.Fields(string(output))
	if len(dependencies) == 0 {
		t.Fatal("compiled API dependency closure must not be empty")
	}

	const apiImportPath = "github.com/aldrichcode45/peopleflow-vacantes/cmd/api"
	apiFound := false
	for _, dependency := range dependencies {
		if dependency == apiImportPath {
			apiFound = true
		}
		if isExternalObservabilityDependency(dependency) {
			t.Errorf("compiled API dependency closure contains external observability package %q", dependency)
		}
	}
	if !apiFound {
		t.Fatalf("compiled API dependency closure does not contain %q", apiImportPath)
	}
}

func TestTask63A2_ReadinessMetricsBindsDefault(t *testing.T) {
	composition := mustParse(t, compositionFile)
	runFn := findFuncDecl(composition, "run")
	if runFn == nil {
		t.Fatalf("composition root %s must declare func run", compositionFile)
	}

	var calls []*ast.CallExpr
	ast.Inspect(runFn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		callee, ok := call.Fun.(*ast.Ident)
		if ok && callee.Name == "newRouter" {
			calls = append(calls, call)
		}
		return true
	})
	if len(calls) != 1 || len(calls[0].Args) != 1 {
		t.Fatalf("run must call newRouter exactly once with one routerDeps argument; got %d call(s)", len(calls))
	}

	deps, ok := calls[0].Args[0].(*ast.CompositeLit)
	if !ok {
		t.Fatalf("newRouter argument must be routerDeps composite; got %s", types.ExprString(calls[0].Args[0]))
	}
	depsType, ok := deps.Type.(*ast.Ident)
	if !ok || depsType.Name != "routerDeps" {
		t.Fatalf("newRouter argument must be exactly routerDeps{...}; got %s", types.ExprString(calls[0].Args[0]))
	}

	readinessFields := 0
	for _, element := range deps.Elts {
		field, ok := element.(*ast.KeyValueExpr)
		if !ok {
			t.Fatal("routerDeps composite must use keyed fields")
		}
		key, ok := field.Key.(*ast.Ident)
		if !ok || key.Name != "readinessMetrics" {
			continue
		}
		readinessFields++
		if !isPkgSelector(field.Value, "runtimemetrics", "Default") {
			t.Fatalf("readinessMetrics must bind exactly to runtimemetrics.Default; got %s", types.ExprString(field.Value))
		}
	}
	if readinessFields != 1 {
		t.Fatalf("routerDeps must bind readinessMetrics exactly once; got %d", readinessFields)
	}
}

func isExternalObservabilityDependency(importPath string) bool {
	importPath = strings.ToLower(importPath)
	for _, prefix := range externalObservabilityPrefixes {
		if strings.HasPrefix(importPath, prefix) {
			return true
		}
	}
	return false
}

func findModuleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	for {
		if info, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil && !info.IsDir() {
			return dir
		} else if statErr != nil && !os.IsNotExist(statErr) {
			t.Fatalf("inspect go.mod in %s: %v", dir, statErr)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("find module root from %s", dir)
		}
		dir = parent
	}
}

func offlineGoEnv() []string {
	blocked := []string{"GOFLAGS=", "GOPROXY=", "GOSUMDB=", "GOTOOLCHAIN=", "GOWORK="}
	env := make([]string, 0, len(os.Environ())+5)
	for _, entry := range os.Environ() {
		keep := true
		for _, prefix := range blocked {
			if strings.HasPrefix(entry, prefix) {
				keep = false
				break
			}
		}
		if keep {
			env = append(env, entry)
		}
	}
	return append(env, "GOFLAGS=-mod=readonly", "GOPROXY=off", "GOSUMDB=off", "GOTOOLCHAIN=local", "GOWORK=off")
}
