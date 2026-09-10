package main

import (
	"go/ast"
	"go/parser"
	"go/scanner"
	"go/token"
	"testing"
)

// t63A1Diagnostic holds stable diagnostic metadata.
type t63A1Diagnostic struct {
	Code    string
	Line    int
	Column  int
	Message string
}

// t63A1Fixture pairs a name with source code for parsing.
type t63A1Fixture struct {
	Name   string
	Source string
}

// t63A1ParseFixture parses source and returns AST and diagnostics.
// Diagnostics are stable and parse-only (no type checking).
func t63A1ParseFixture(fset *token.FileSet, fixture t63A1Fixture) (*ast.File, []t63A1Diagnostic) {
	name := fixture.Name
	if name == "" {
		name = "fixture.go"
	}
	src := fixture.Source
	if src == "" {
		return nil, []t63A1Diagnostic{{Code: "T63-MALFORMED", Line: 1, Column: 1, Message: "empty source"}}
	}
	file, err := parser.ParseFile(fset, name, src, parser.AllErrors)
	if err == nil {
		return file, nil
	}
	line, col := 1, 1
	if errList, ok := err.(scanner.ErrorList); ok && len(errList) > 0 {
		pos := errList[0].Pos
		if pos.IsValid() {
			line, col = pos.Line, pos.Column
		}
	}
	return nil, []t63A1Diagnostic{{Code: "T63-MALFORMED", Line: line, Column: col, Message: "malformed source"}}
}

// t63A1AssertDiags checks length, code, and message.
func t63A1AssertDiags(t *testing.T, got []t63A1Diagnostic, expLen int, expCode string, expMsg string) {
	if len(got) != expLen {
		t.Errorf("expected %d diagnostics, got %d", expLen, len(got))
		return
	}
	if len(got) > 0 {
		if got[0].Code != expCode {
			t.Errorf("code = %q, want %q", got[0].Code, expCode)
		}
		if got[0].Message != expMsg {
			t.Errorf("message = %q, want %q", got[0].Message, expMsg)
		}
	}
}

// TestTask63A1a_DiagnosticMetadataIsStable checks parser-produced diagnostics have stable fields.
func TestTask63A1a_DiagnosticMetadataIsStable(t *testing.T) {
	t.Run("empty fixture yields parser diagnostic", func(t *testing.T) {
		fset := token.NewFileSet()
		_, diags := t63A1ParseFixture(fset, t63A1Fixture{Name: "e.go", Source: ""})
		if len(diags) != 1 {
			t.Fatalf("expected 1 diagnostic, got %d", len(diags))
		}
		if diags[0].Code != "T63-MALFORMED" {
			t.Errorf("code = %q, want T63-MALFORMED", diags[0].Code)
		}
		if diags[0].Line != 1 || diags[0].Column != 1 {
			t.Errorf("pos = (%d,%d), want (1,1)", diags[0].Line, diags[0].Column)
		}
		if diags[0].Message != "empty source" {
			t.Errorf("message = %q, want %q", diags[0].Message, "empty source")
		}
	})
}

// TestTask63A1a_MalformedFixtureIsCompileSafe asserts nil AST and exactly one stable diagnostic.
func TestTask63A1a_MalformedFixtureIsCompileSafe(t *testing.T) {
	tests := []struct {
		name     string
		src      string
		wantLine int
		wantCol  int
	}{
		{name: "unmatched delimiter", src: "package p\nfunc f() {", wantLine: 2, wantCol: 11},
		{name: "incomplete selector", src: "package p\nvar x = a.", wantLine: 2, wantCol: 11},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fset := token.NewFileSet()
			astFile, diags := t63A1ParseFixture(fset, t63A1Fixture{Name: "m.go", Source: tt.src})
			if astFile != nil {
				t.Errorf("expected nil AST for malformed source")
			}
			t63A1AssertDiags(t, diags, 1, "T63-MALFORMED", "malformed source")
			if len(diags) > 0 {
				if diags[0].Line != tt.wantLine {
					t.Errorf("line = %d, want %d", diags[0].Line, tt.wantLine)
				}
				if diags[0].Column != tt.wantCol {
					t.Errorf("column = %d, want %d", diags[0].Column, tt.wantCol)
				}
			}
		})
	}
}

// TestTask63A1a_EmptyAndValidFixturesAreNonVacuous covers empty, valid, and missing-name cases.
func TestTask63A1a_EmptyAndValidFixturesAreNonVacuous(t *testing.T) {
	tests := []struct {
		name        string
		fixName     string
		src         string
		expHasAST   bool
		expDiagLen  int
		expDiagCode string
		expDiagMsg  string
	}{
		{name: "empty source", fixName: "e.go", src: "", expHasAST: false, expDiagLen: 1, expDiagCode: "T63-MALFORMED", expDiagMsg: "empty source"},
		{name: "valid no-call source", fixName: "v.go", src: "package p\nvar x = 1", expHasAST: true, expDiagLen: 0, expDiagCode: "", expDiagMsg: ""},
		{name: "valid log/slog selector source", fixName: "s.go", src: "package p\nimport \"log/slog\"\nvar _ = slog.Default()", expHasAST: true, expDiagLen: 0, expDiagCode: "", expDiagMsg: ""},
		{name: "missing fixture name fallback", fixName: "", src: "package p", expHasAST: true, expDiagLen: 0, expDiagCode: "", expDiagMsg: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fset := token.NewFileSet()
			astFile, diags := t63A1ParseFixture(fset, t63A1Fixture{Name: tt.fixName, Source: tt.src})
			if tt.expHasAST && astFile == nil {
				t.Fatalf("expected non-nil AST")
			}
			if !tt.expHasAST && astFile != nil {
				t.Fatalf("expected nil AST")
			}
			t63A1AssertDiags(t, diags, tt.expDiagLen, tt.expDiagCode, tt.expDiagMsg)
			if tt.name == "missing fixture name fallback" {
				pos := fset.Position(astFile.Pos())
				if pos.Filename != "fixture.go" {
					t.Errorf("parsed filename = %q, want fixture.go", pos.Filename)
				}
			}
		})
	}
}
