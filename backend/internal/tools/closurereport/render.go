package closurereport

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/archguard"
)

// Artifact file names the generator writes under the target docs root. At this
// stage (Task 7.3 GREEN) they are written only into temporary fixture roots;
// the real-tree run belongs to the Task 7.3 TRIANGULATE checkbox.
const (
	TraceabilityFile = "backend-go-closure-traceability.md"
	GoNoGoFile       = "aws-go-no-go.md"
	ReportJSONFile   = "go-no-go-report.json"
)

// fixedCriterionIDs is the fixed proposal §9 criterion projection the generated
// go/no-go view renders in this order, independent of any caller-supplied
// criteria: caller data can neither narrow nor widen the criterion view.
var fixedCriterionIDs = []string{
	criterionC1, criterionC2, criterionC3, criterionC4, criterionC5, criterionC6,
	criterionC7, criterionC8, criterionC9, criterionC10, criterionC11, criterionC12,
}

// RenderTraceability renders the generated traceability Markdown view. It is a
// generated projection only — never a source of truth; the manifest and the
// receipts remain canonical. Output depends solely on the evidence order.
// RenderTraceability renders the generated traceability Markdown view. Both
// projections come from the same trusted inputs the decision uses: the observed
// native manifest carried by PreparedEvidence and the validated unique raw
// receipts. The render-only legacy manifest and receipt projections are
// deliberately never consulted, so the generated artifact can never contradict
// the canonical decision, and output is deterministic.
func RenderTraceability(ev Evidence, r Report) string {
	var b strings.Builder
	fmt.Fprintln(&b, "# Backend Go Closure — Traceability (generated)")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "Generated view by internal/tools/closurereport; never a source of truth.")
	fmt.Fprintf(&b, "\nDecision: %s\n", r.Decision)

	fmt.Fprintln(&b, "\n## Requirements (manifest)")
	b.WriteString("| Requirement | Capability | Tier | Owners | Anchors |\n|---|---|---|---|---|\n")
	if ev.Prepared != nil && ev.Prepared.loaded {
		for _, row := range ev.Prepared.manifest.Rows {
			fmt.Fprintf(&b, "| %s | %s | %s | %s | %s |\n",
				row.Requirement, row.Capability, row.Tier,
				strings.Join(row.Owners, ", "), rowAnchors(row.Evidence))
		}
	} else {
		b.WriteString("Observed native evidence is absent; no canonical manifest rows are available.\n")
	}

	fmt.Fprintln(&b, "\n## Gate receipts")
	b.WriteString("| Gate | Status | Tree | Exit | Skips |\n|---|---|---|---|---|\n")
	byGate, _ := validatedGateReceipts(ev.RawReceipts)
	gates := make([]string, 0, len(byGate))
	for gate := range byGate {
		gates = append(gates, gate)
	}
	slices.Sort(gates)
	for _, gate := range gates {
		rec := byGate[gate]
		fmt.Fprintf(&b, "| %s | %s | %s | %d | %s |\n",
			rec.Gate, rec.Status, rec.Tree, rec.ExitCode, strings.Join(rec.SkipNames, ", "))
	}

	fmt.Fprintln(&b, "\n## Executables")
	b.WriteString("| Name | Runtime boundary tests |\n|---|---|\n")
	for _, ex := range ev.Executables {
		fmt.Fprintf(&b, "| %s | %t |\n", ex.Name, ex.RuntimeBoundaryTests)
	}
	return b.String()
}

// rowAnchors renders one observed row's declared native anchors deterministically:
// the evidence path, then each declared symbol, then each test selector.
func rowAnchors(evidence archguard.RowEvidence) string {
	anchors := []string{}
	if evidence.Path != "" {
		anchors = append(anchors, evidence.Path)
	}
	anchors = append(anchors, evidence.Symbols...)
	anchors = append(anchors, evidence.Tests...)
	return strings.Join(anchors, ", ")
}

// RenderGoNoGo renders the criterion-by-criterion proposal §9 go/no-go result,
// naming every blocker from the single Generate run. The criterion projection is
// package-owned (fixedCriterionIDs), so a nil or hostile caller criteria
// projection can neither narrow nor widen it.
func RenderGoNoGo(ev Evidence, r Report) string {
	var b strings.Builder
	fmt.Fprintln(&b, "# AWS Go/No-Go (generated)")
	fmt.Fprintf(&b, "\nDecision: %s\n", r.Decision)

	fmt.Fprintln(&b, "\n## Criteria (proposal §9)")
	for _, id := range fixedCriterionIDs {
		status := "PASS"
		var lines []string
		for _, bl := range r.Blockers {
			if bl.Subject == id {
				status = "FAIL"
				lines = append(lines, fmt.Sprintf("- blocker [%s] %s: %s", bl.Kind, bl.Subject, bl.Detail))
			}
		}
		fmt.Fprintf(&b, "\n### %s — %s\n", id, status)
		for _, line := range lines {
			b.WriteString(line + "\n")
		}
	}

	fmt.Fprintln(&b, "\n## Blockers")
	if len(r.Blockers) == 0 {
		b.WriteString("None.\n")
	}
	for _, bl := range r.Blockers {
		fmt.Fprintf(&b, "- [%s] %s — %s\n", bl.Kind, bl.Subject, bl.Detail)
	}
	return b.String()
}

// WriteArtifacts writes the generated Markdown views plus the canonical JSON
// report into dir (the docs root). Generation is deterministic: identical
// evidence yields byte-identical files. Callers own the target root; at this
// stage only temporary fixture roots are authorized.
func WriteArtifacts(dir string, ev Evidence, r Report) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating docs root: %w", err)
	}
	var buf bytes.Buffer
	if err := r.WriteJSON(&buf); err != nil {
		return fmt.Errorf("encoding report: %w", err)
	}
	files := map[string][]byte{
		TraceabilityFile: []byte(RenderTraceability(ev, r)),
		GoNoGoFile:       []byte(RenderGoNoGo(ev, r)),
		ReportJSONFile:   buf.Bytes(),
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", name, err)
		}
	}
	return nil
}
