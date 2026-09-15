package archguard

import (
	"strings"
	"testing"
)

const module = "github.com/aldrichcode45/peopleflow-vacantes/internal"

// wantViolations fails when a case expecting findings reports none (the
// intended behavioral RED of the accept-all scaffold) or reports the wrong
// count.
func wantViolations(t *testing.T, name string, got []Violation, want int) {
	t.Helper()
	if len(got) != want {
		t.Fatalf("%s: got %d violation(s), want %d (want=0 pass, want>0 fails on the accept-all scaffold: guards report no violation) — got: %+v",
			name, len(got), want, got)
	}
}

// wantRuleNamed asserts a violation carries the expected rule and names the
// offender.
func wantRuleNamed(t *testing.T, got []Violation, rule, offender string) {
	t.Helper()
	for _, v := range got {
		if v.Rule == rule && strings.Contains(v.File+v.Detail, offender) {
			return
		}
	}
	t.Fatalf("no violation for rule %q naming %q; got %+v", rule, offender, got)
}

func TestGuard_ForbiddenCrossFeatureInfrastructureImport(t *testing.T) {
	tests := []struct {
		name     string
		packages map[string][]string
		want     int
	}{
		{
			name: "feature imports another feature infrastructure fails naming offender",
			packages: map[string][]string{
				module + "/features/companies/infrastructure/http": {
					module + "/features/jobs/infrastructure/postgres",
				},
			},
			want: 1,
		},
		{
			name: "own-feature infrastructure import is allowed",
			packages: map[string][]string{
				module + "/features/jobs/infrastructure/http": {
					module + "/features/jobs/infrastructure/postgres",
				},
			},
			want: 0,
		},
		{
			name: "shared and runtime imports are allowed",
			packages: map[string][]string{
				module + "/features/jobs/infrastructure/http": {
					module + "/shared/httpjson",
					module + "/runtime/server",
				},
			},
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckCrossFeatureImports(tt.packages)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
	t.Run("offender is named", func(t *testing.T) {
		got := CheckCrossFeatureImports(map[string][]string{
			module + "/features/companies/infrastructure/http": {
				module + "/features/jobs/infrastructure/postgres",
			},
		})
		wantRuleNamed(t, got, "cross-feature-infrastructure-import",
			module+"/features/jobs/infrastructure/postgres")
	})
}

func TestGuard_DocumentedExceptionsPass(t *testing.T) {
	t.Run("documented exception set is exact", func(t *testing.T) {
		want := []string{
			"internal/features/audit_events/domain/entities",
			"internal/features/audit_events/domain/repositories",
			"internal/features/identity/domain/entities",
			"internal/features/identity/domain/repositories",
			"internal/features/identity/domain/security",
			"internal/features/identity/domain/valueobjects",
			"internal/features/companies/domain/entities",
			"internal/features/companies/domain/repositories",
			"internal/features/companies/domain/valueobjects",
		}
		if strings.Join(DocumentedExceptions, "\n") != strings.Join(want, "\n") {
			t.Fatalf("DocumentedExceptions mismatch:\n got %v\nwant %v", DocumentedExceptions, want)
		}
	})
	tests := []struct {
		name     string
		packages map[string][]string
		want     int
	}{
		{
			name: "audit co-write import stays allowed",
			packages: map[string][]string{
				module + "/features/companies/domain/repositories": {
					module + "/features/audit_events/domain/entities",
				},
			},
			want: 0,
		},
		{
			name: "identity domain-port import stays allowed",
			packages: map[string][]string{
				module + "/features/applications/application/usecases": {
					module + "/features/identity/domain/security",
				},
			},
			want: 0,
		},
		{
			name: "cross-feature import outside the exception set fails naming offender",
			packages: map[string][]string{
				module + "/features/companies/infrastructure/postgres": {
					module + "/features/candidates/domain/valueobjects",
				},
			},
			want: 1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckCrossFeatureImports(tt.packages)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
}

func TestGuard_RouteTopologyMutation(t *testing.T) {
	want := Topology{
		Public: []Route{{Method: "GET", Path: "/industries"}},
		Gated: []Route{
			{Method: "POST", Path: "/me/companies", Gated: true, Middleware: []string{"auth"}},
			{Method: "PUT", Path: "/me/candidates", Gated: true, Middleware: []string{"auth"}},
		},
	}
	tests := []struct {
		name string
		got  Topology
		want int
	}{
		{
			name: "gated route moved to the public mount fails",
			got: Topology{
				Public: []Route{
					{Method: "GET", Path: "/industries"},
					{Method: "POST", Path: "/me/companies"},
				},
				Gated: []Route{{Method: "PUT", Path: "/me/candidates", Gated: true, Middleware: []string{"auth"}}},
			},
			want: 1,
		},
		{
			name: "gated subtree middleware removed fails",
			got: Topology{
				Public: []Route{{Method: "GET", Path: "/industries"}},
				Gated: []Route{
					{Method: "POST", Path: "/me/companies", Gated: true},
					{Method: "PUT", Path: "/me/candidates", Gated: true, Middleware: []string{"auth"}},
				},
			},
			want: 1,
		},
		{
			name: "unchanged topology passes",
			got:  want,
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckRouteTopology(want, tt.got)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
}

func TestGuard_ErrorCatalogScan(t *testing.T) {
	tests := []struct {
		name  string
		files []SourceFile
		want  int
	}{
		{
			name: "ad-hoc code string literal outside httpjson fails",
			files: []SourceFile{{
				Path:    module + "/features/jobs/infrastructure/http/handler.go",
				Content: `w.WriteHeader(http.StatusNotFound)\njson.NewEncoder(w).Encode(map[string]string{"error": msg, "code": "not_found"})`,
			}},
			want: 1,
		},
		{
			name: "direct feature error-JSON write fails",
			files: []SourceFile{{
				Path:    module + "/features/companies/infrastructure/http/handler.go",
				Content: `w.Write([]byte("{\"error\": \"boom\"}"))`,
			}},
			want: 1,
		},
		{
			name: "catalog writer in a feature handler passes",
			files: []SourceFile{{
				Path:    module + "/features/jobs/infrastructure/http/handler.go",
				Content: `httpjson.WriteCatalogError(w, def, def.Message)`,
			}},
			want: 0,
		},
		{
			name: "code literals inside httpjson pass",
			files: []SourceFile{{
				Path:    module + "/shared/httpjson/errors.go",
				Content: `{"error": "conflict", "code": "conflict"}`,
			}},
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckErrorCatalogUsage(tt.files)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
}

func TestGuard_NonGoalScan(t *testing.T) {
	tests := []struct {
		name  string
		paths []string
		want  int
	}{
		{"new Dockerfile path fails", []string{"backend/Dockerfile"}, 1},
		{"new Terraform path fails", []string{"infra/main.tf"}, 1},
		{"new outbox package fails", []string{"internal/features/jobs/outbox/outbox.go"}, 1},
		{"new worker deployment resource fails", []string{"deploy/worker-lambda.yaml"}, 1},
		{"ordinary backend paths pass", []string{"internal/features/jobs/handler.go", "docs/ROADMAP.md"}, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckNonGoals(tt.paths)
			wantViolations(t, tt.name, got, tt.want)
		})
	}
}
