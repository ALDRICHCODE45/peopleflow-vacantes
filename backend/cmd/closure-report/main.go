// Command closure-report is the CE-04 report driver: it resolves the repository
// layout from the current directory, loads the fixed real-tree evidence, runs the
// canonical report algorithm, and writes the three generated artifacts under the
// repository docs/ root on both GO and NO-GO decisions.
//
// It prints exactly one deterministic decision line to stdout and exits 0 on GO,
// 1 on NO-GO, and 2 on a layout, load, or write error (with a
// "closure-report: <error>" diagnostic on stderr). Blocker bodies, receipt bytes,
// and DSNs are never printed.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/archguard"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/closurereport"
)

// reportSteps are the four ordered steps one report run executes. They are
// injectable so tests drive GO/NO-GO/error behavior deterministically without a
// real repository tree, while main stays a thin wiring shell.
type reportSteps struct {
	detectLayout func(start string) (archguard.RepositoryLayout, error)
	loadEvidence func(repoRoot string) (closurereport.Evidence, error)
	generate     func(ev closurereport.Evidence) closurereport.Report
	write        func(docsDir string, ev closurereport.Evidence, r closurereport.Report) error
}

// defaultSteps wires the production layout, loader, generator, and writer.
func defaultSteps() reportSteps {
	return reportSteps{
		detectLayout: archguard.DetectLayout,
		loadEvidence: closurereport.LoadEvidence,
		generate:     closurereport.Generate,
		write:        closurereport.WriteArtifacts,
	}
}

// runClosureReport performs one full report run anchored at start and returns the
// process exit code. Artifacts are written for both decisions; only a GO decision
// exits 0.
func runClosureReport(start string, stdout, stderr io.Writer, steps reportSteps) int {
	layout, err := steps.detectLayout(start)
	if err != nil {
		fmt.Fprintf(stderr, "closure-report: %v\n", err)
		return 2
	}
	evidence, err := steps.loadEvidence(layout.Repo)
	if err != nil {
		fmt.Fprintf(stderr, "closure-report: %v\n", err)
		return 2
	}
	report := steps.generate(evidence)
	if err := steps.write(filepath.Join(layout.Repo, "docs"), evidence, report); err != nil {
		fmt.Fprintf(stderr, "closure-report: %v\n", err)
		return 2
	}
	fmt.Fprintf(stdout, "closure-report: decision %s (%d blockers)\n", report.Decision, len(report.Blockers))
	if report.Decision == closurereport.DecisionGo {
		return 0
	}
	return 1
}

func main() {
	os.Exit(runClosureReport(".", os.Stdout, os.Stderr, defaultSteps()))
}
