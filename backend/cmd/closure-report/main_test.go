package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/archguard"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/closurereport"
)

// stubReportSteps builds injectable steps anchored at repoRoot that always
// resolve layout from any start directory, so CLI behavior is exercised without
// a real repository tree.
func stubReportSteps(repoRoot string, report closurereport.Report) reportSteps {
	return reportSteps{
		detectLayout: func(string) (archguard.RepositoryLayout, error) {
			return archguard.RepositoryLayout{Backend: filepath.Join(repoRoot, "backend"), Repo: repoRoot}, nil
		},
		loadEvidence: func(string) (closurereport.Evidence, error) { return closurereport.Evidence{}, nil },
		generate:     func(closurereport.Evidence) closurereport.Report { return report },
	}
}

func TestRunClosureReportGo(t *testing.T) {
	repo := t.TempDir()
	wroteDir := ""
	steps := stubReportSteps(repo, closurereport.Report{Decision: closurereport.DecisionGo})
	steps.write = func(docsDir string, _ closurereport.Evidence, _ closurereport.Report) error {
		wroteDir = docsDir
		return nil
	}

	var stdout, stderr bytes.Buffer
	if code := runClosureReport(".", &stdout, &stderr, steps); code != 0 {
		t.Fatalf("GO exit code = %d, want 0; stderr=%q", code, stderr.String())
	}
	if got, want := stdout.String(), "closure-report: decision GO (0 blockers)\n"; got != want {
		t.Fatalf("stdout = %q, want %q", got, want)
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want empty", stderr.String())
	}
	if want := filepath.Join(repo, "docs"); wroteDir != want {
		t.Fatalf("write docs dir = %q, want %q", wroteDir, want)
	}
}

func TestRunClosureReportNoGoStillWritesArtifacts(t *testing.T) {
	repo := t.TempDir()
	writes := 0
	steps := stubReportSteps(repo, closurereport.Report{
		Decision: closurereport.DecisionNoGo,
		Blockers: []closurereport.Blocker{{
			Kind:    "receipt",
			Subject: "gate-build",
			Detail:  "secret DSN postgres://user:password@host:5432/db must never be printed",
		}},
	})
	steps.write = func(string, closurereport.Evidence, closurereport.Report) error {
		writes++
		return nil
	}

	var stdout, stderr bytes.Buffer
	if code := runClosureReport(".", &stdout, &stderr, steps); code != 1 {
		t.Fatalf("NO-GO exit code = %d, want 1; stderr=%q", code, stderr.String())
	}
	if got, want := stdout.String(), "closure-report: decision NO-GO (1 blockers)\n"; got != want {
		t.Fatalf("stdout = %q, want %q", got, want)
	}
	if writes != 1 {
		t.Fatalf("artifacts must be written on NO-GO too; write calls=%d", writes)
	}
	for _, leak := range []string{"postgres://", "secret DSN", "password"} {
		if strings.Contains(stdout.String(), leak) {
			t.Fatalf("stdout leaked blocker body %q: %q", leak, stdout.String())
		}
	}
}

func TestRunClosureReportErrors(t *testing.T) {
	sentinel := errors.New("layout unavailable: no go.mod above start")
	tests := []struct {
		name        string
		mutate      func(*reportSteps)
		wantStderr  string
		allowWrite  bool
		writeCalled *int
	}{
		{
			name: "layout error",
			mutate: func(s *reportSteps) {
				s.detectLayout = func(string) (archguard.RepositoryLayout, error) {
					return archguard.RepositoryLayout{}, sentinel
				}
			},
			wantStderr: sentinel.Error(),
		},
		{
			name: "load error",
			mutate: func(s *reportSteps) {
				s.loadEvidence = func(string) (closurereport.Evidence, error) {
					return closurereport.Evidence{}, errors.New("load failed: manifest unreadable")
				}
			},
			wantStderr: "load failed: manifest unreadable",
		},
		{
			name: "write error",
			mutate: func(s *reportSteps) {
				s.write = func(string, closurereport.Evidence, closurereport.Report) error {
					return errors.New("write failed: docs root not writable")
				}
			},
			wantStderr: "write failed: docs root not writable",
			allowWrite: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := t.TempDir()
			writes := 0
			steps := stubReportSteps(repo, closurereport.Report{Decision: closurereport.DecisionGo})
			steps.write = func(string, closurereport.Evidence, closurereport.Report) error {
				writes++
				return nil
			}
			tt.mutate(&steps)

			var stdout, stderr bytes.Buffer
			if code := runClosureReport(".", &stdout, &stderr, steps); code != 2 {
				t.Fatalf("error exit code = %d, want 2", code)
			}
			if stdout.Len() != 0 {
				t.Fatalf("stdout must stay empty on error; got %q", stdout.String())
			}
			if got := stderr.String(); !strings.HasPrefix(got, "closure-report: ") || !strings.Contains(got, tt.wantStderr) {
				t.Fatalf("stderr = %q, want prefix %q and %q", got, "closure-report: ", tt.wantStderr)
			}
			if !tt.allowWrite && writes != 0 {
				t.Fatalf("write must not run after a layout/load error; calls=%d", writes)
			}
		})
	}
}

func TestRunClosureReportWritesExactlyThreeArtifacts(t *testing.T) {
	repo := t.TempDir()
	steps := stubReportSteps(repo, closurereport.Report{Decision: closurereport.DecisionGo})
	steps.write = closurereport.WriteArtifacts

	var stdout, stderr bytes.Buffer
	if code := runClosureReport(".", &stdout, &stderr, steps); code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr=%q", code, stderr.String())
	}
	entries, err := os.ReadDir(filepath.Join(repo, "docs"))
	if err != nil {
		t.Fatalf("read docs dir: %v", err)
	}
	want := map[string]bool{
		closurereport.TraceabilityFile: true,
		closurereport.GoNoGoFile:       true,
		closurereport.ReportJSONFile:   true,
	}
	if len(entries) != len(want) {
		t.Fatalf("docs dir holds %d artifacts, want exactly %d", len(entries), len(want))
	}
	for _, entry := range entries {
		if !want[entry.Name()] {
			t.Fatalf("unexpected artifact %q in docs dir", entry.Name())
		}
	}
}

func TestDefaultStepsWired(t *testing.T) {
	steps := defaultSteps()
	if steps.detectLayout == nil || steps.loadEvidence == nil || steps.generate == nil || steps.write == nil {
		t.Fatalf("defaultSteps must wire all four production steps: %+v", steps)
	}
}
