// Task 7.3 (WS7C) GREEN-slice RED: focused tests for the deterministic output
// surface — the generated traceability Markdown view, the criterion-by-criterion
// go/no-go Markdown naming every blocker, and the WriteArtifacts fixture path.
// Added before the render implementation exists (strict TDD: new behavior needs
// a failing focused test first). Outputs are written only into temporary
// fixture roots; the real repository tree is never consumed or mutated.
package closurereport

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// wantCriterionProjection asserts the generated go/no-go view projects exactly
// the twelve package-owned criteria and marks exactly the named ones FAIL.
func wantCriterionProjection(t *testing.T, out string, failed ...string) {
	t.Helper()
	if got := strings.Count(out, "\n### "); got != len(fixedCriterionIDs) {
		t.Fatalf("go/no-go view projects %d criterion headings, want exactly %d:\n%s", got, len(fixedCriterionIDs), out)
	}
	for _, id := range fixedCriterionIDs {
		status := "PASS"
		if slices.Contains(failed, id) {
			status = "FAIL"
		}
		if want := "### " + id + " — " + status; !strings.Contains(out, want) {
			t.Fatalf("go/no-go view missing %q in:\n%s", want, out)
		}
	}
}

func TestRenderTraceability_DeterministicGeneratedView(t *testing.T) {
	ev := completeEvidence()
	r := Generate(ev)
	first := RenderTraceability(ev, r)
	if first != RenderTraceability(ev, Generate(ev)) {
		t.Fatal("traceability render is not deterministic between runs")
	}
	for _, want := range []string{
		"# Backend Go Closure",
		"Decision: NO-GO",
		"| Requirement | Capability | Tier | Owners | Anchors |",
		"| Migration Executable (`cmd/migrate`) | backend-runtime | MUST | backend/internal/tools/closurereport/report.go |",
		"| gate-integration | pass |",
		"| cmd/postconfirmation | true |",
	} {
		if !strings.Contains(first, want) {
			t.Fatalf("traceability view missing %q in:\n%s", want, first)
		}
	}
}

// TestRenderTraceability_ProjectsOnlyTrustedEvidence proves the generated
// traceability artifact is derived only from the observed native manifest and the
// validated unique raw receipts, so it can never contradict the canonical
// decision: legacy manifest and receipt projections have no influence, native and
// raw changes are reflected, and invalid or ambiguous raw receipts never appear as
// accepted receipt rows.
func TestRenderTraceability_ProjectsOnlyTrustedEvidence(t *testing.T) {
	base := RenderTraceability(completeEvidence(), Generate(completeEvidence()))

	tests := []struct {
		name      string
		identical bool
		want      string
		absent    string
		mutate    func(*testing.T, *Evidence)
	}{
		{
			name:      "nil legacy manifest and receipt projections",
			identical: true,
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Manifest = nil
				ev.Receipts = nil
			},
		},
		{
			name:      "hostile legacy manifest and receipt projections",
			identical: true,
			absent:    "Legacy Only Row",
			mutate: func(t *testing.T, ev *Evidence) {
				ev.Manifest = []ManifestRow{{Requirement: "Legacy Only Row", Capability: "backend-runtime", Tier: TierMUST, Owner: "legacy", Anchor: "legacy"}}
				ev.Receipts = []Receipt{{Gate: "gate-legacy", Status: "fail", Tree: treeID, ExitCode: 1}}
			},
		},
		{
			name: "observed native manifest change is projected",
			want: "| JWT Middleware | identity | SHOULD |",
			mutate: func(t *testing.T, ev *Evidence) {
				fixtureRow(t, ev, "JWT Middleware").Tier = "SHOULD"
			},
		},
		{
			name: "validated raw receipt change is projected",
			want: "| gate-fmt | fail |",
			mutate: func(t *testing.T, ev *Evidence) {
				replaceRawReceipt(t, ev, "gate-fmt",
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"failure":""`, `"failure":"gate fmt failure"`},
				)
			},
		},
		{
			name:   "invalid raw receipt never appears as an accepted row",
			absent: "| gate-build | pass |",
			mutate: func(t *testing.T, ev *Evidence) {
				ev.RawReceipts[0] = []byte(`{"gate":`)
			},
		},
		{
			name:   "ambiguous duplicate raw receipt never appears as an accepted row",
			absent: "| gate-build | pass |",
			mutate: func(t *testing.T, ev *Evidence) {
				ev.RawReceipts = append(ev.RawReceipts, slices.Clone(ev.RawReceipts[0]))
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev := completeEvidence()
			tt.mutate(t, &ev)
			out := RenderTraceability(ev, Generate(ev))
			if out != RenderTraceability(ev, Generate(ev)) {
				t.Fatal("traceability render is not deterministic between runs")
			}
			if tt.identical && out != base {
				t.Fatalf("legacy projections changed the traceability view:\n%s", out)
			}
			if tt.want != "" && !strings.Contains(out, tt.want) {
				t.Fatalf("traceability view missing %q in:\n%s", tt.want, out)
			}
			if tt.absent != "" && strings.Contains(out, tt.absent) {
				t.Fatalf("traceability view unexpectedly contains %q in:\n%s", tt.absent, out)
			}
		})
	}
}

func TestRenderGoNoGo_CriterionByCriterionNamesEveryBlocker(t *testing.T) {
	ev := completeEvidence()
	ev.Manifest[0].Anchor = ""
	ev.NonGoalFindings = []string{"backend/Dockerfile"}
	replaceRawReceipt(t, &ev, "gate-integration",
		receiptReplacement{`"status":"pass"`, `"status":"fail"`},
		receiptReplacement{`"exit_code":0`, `"exit_code":1`},
		receiptReplacement{`"skip_names":[]`, `"skip_names":["TestUnexpectedSkip"]`},
		receiptReplacement{`"failure":""`, `"failure":"integration failure"`},
	)
	r := Generate(ev)
	out := RenderGoNoGo(ev, r)
	if !strings.Contains(out, "Decision: NO-GO") {
		t.Fatalf("go/no-go view missing NO-GO decision in:\n%s", out)
	}
	for _, bl := range r.Blockers {
		want := "- [" + bl.Kind + "] " + bl.Subject
		if !strings.Contains(out, want) {
			t.Fatalf("go/no-go view does not name blocker %q in:\n%s", want, out)
		}
	}
	if !strings.Contains(out, "### criterion-3-serial-live-integration-zero-unexpected-skips — FAIL") {
		t.Fatalf("criterion-3 not marked FAIL after skip/anchor mutations in:\n%s", out)
	}
	goOut := RenderGoNoGo(completeEvidence(), Generate(completeEvidence()))
	if !strings.Contains(goOut, "Decision: NO-GO") {
		t.Fatalf("complete fixture go/no-go view missing deterministic NO-GO decision in:\n%s", goOut)
	}
	wantCriterionProjection(t, out, criterionC3, criterionC10, criterionC12)
	wantCriterionProjection(t, goOut, criterionC12)
	for _, callerCriteria := range [][]Criterion{
		nil,
		{{ID: "criterion-99-invented"}, {ID: criterionC3, RequiredGates: []string{"gate-invented"}}},
	} {
		caller := completeEvidence()
		caller.Criteria = callerCriteria
		if got := RenderGoNoGo(caller, Generate(caller)); got != goOut {
			t.Fatalf("caller criteria %#v changed the projected criteria view:\n%s", callerCriteria, got)
		}
	}
}

func TestWriteArtifacts_TemporaryFixtureRootDeterministic(t *testing.T) {
	dir := t.TempDir()
	ev := completeEvidence()
	r := Generate(ev)
	if err := WriteArtifacts(dir, ev, r); err != nil {
		t.Fatalf("write artifacts: %v", err)
	}
	read := func(name string) []byte {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if len(data) == 0 {
			t.Fatalf("%s is empty", name)
		}
		return data
	}
	for _, name := range []string{TraceabilityFile, GoNoGoFile, ReportJSONFile} {
		read(name)
	}
	var buf bytes.Buffer
	if err := r.WriteJSON(&buf); err != nil {
		t.Fatalf("encode report: %v", err)
	}
	if !bytes.Equal(read(ReportJSONFile), buf.Bytes()) {
		t.Fatal("report JSON artifact does not match the canonical WriteJSON encoding")
	}
	first := read(GoNoGoFile)
	if err := WriteArtifacts(dir, ev, r); err != nil {
		t.Fatalf("rewrite artifacts: %v", err)
	}
	if !bytes.Equal(first, read(GoNoGoFile)) {
		t.Fatal("go/no-go artifact is not byte-identical between runs on unchanged evidence")
	}
}
