package main

import (
	"go/ast"
	"go/importer"
	"go/token"
	"go/types"
	"testing"
)

// t63A1Finding holds the shape of one security finding.
type t63A1Finding struct {
	API        string
	Receiver   string
	ImportPath string
	FnPkgPath  string
	Filename   string
	Line       int
	Column     int
	MsgIndex   int
	AttrsIndex int
	PrefixLen  int
}

// t63A1bScan checks for real log/slog.Info calls with import aliases.
func t63A1bScan(fset *token.FileSet, file *ast.File, info *types.Info) []t63A1Finding {
	var findings []t63A1Finding
	if info == nil {
		return findings
	}
	uses := info.Uses
	selections := info.Selections
	ast.Inspect(file, func(n ast.Node) bool {
		sel, ok := n.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if selections[sel] != nil {
			return true
		}
		x, ok := sel.X.(*ast.Ident)
		if !ok {
			return true
		}
		obj := uses[x]
		if obj == nil {
			return true
		}
		pn, ok := obj.(*types.PkgName)
		if !ok {
			return true
		}
		if pn.Imported().Path() != "log/slog" {
			return true
		}
		fnObj := uses[sel.Sel]
		if fnObj == nil {
			return true
		}
		fn, ok := fnObj.(*types.Func)
		if !ok {
			return true
		}
		if fn.Pkg() != pn.Imported() {
			return true
		}
		if fn.Name() != "Info" {
			return true
		}
		pos := sel.Sel.Pos()
		findings = append(findings, t63A1Finding{
			API: "Info", Receiver: "package", ImportPath: "log/slog",
			FnPkgPath: "log/slog", Filename: fset.Position(pos).Filename,
			Line: fset.Position(pos).Line, Column: fset.Position(pos).Column,
			MsgIndex: 0, AttrsIndex: 1, PrefixLen: 0,
		})
		return true
	})
	return findings
}

// t63A1bParseWithTypes wraps t63A1ParseFixture and adds type checking.
func t63A1bParseWithTypes(fset *token.FileSet, fixture t63A1Fixture) (*ast.File, []t63A1Diagnostic, *types.Info) {
	file, diags := t63A1ParseFixture(fset, fixture)
	if file == nil {
		return nil, diags, nil
	}
	cfg := &types.Config{Importer: importer.Default()}
	info := &types.Info{
		Uses:       make(map[*ast.Ident]types.Object),
		Selections: make(map[*ast.SelectorExpr]*types.Selection),
	}
	_, err := cfg.Check("p", fset, []*ast.File{file}, info)
	if err != nil {
		line, col := 1, 1
		switch e := err.(type) {
		case types.Error:
			if e.Pos.IsValid() {
				line, col = fset.Position(e.Pos).Line, fset.Position(e.Pos).Column
			}
		case *types.Error:
			if e.Pos.IsValid() {
				line, col = fset.Position(e.Pos).Line, fset.Position(e.Pos).Column
			}
		}
		return nil, append(diags, t63A1Diagnostic{Code: "T63-TYPE", Line: line, Column: col, Message: "type error"}), nil
	}
	return file, nil, info
}

// t63A1bAssertFinding validates all fields of a single finding.
func t63A1bAssertFinding(t *testing.T, got, want t63A1Finding) {
	if got.API != want.API || got.Receiver != want.Receiver ||
		got.ImportPath != want.ImportPath || got.FnPkgPath != want.FnPkgPath ||
		got.Filename != want.Filename || got.Line != want.Line ||
		got.Column != want.Column || got.MsgIndex != want.MsgIndex ||
		got.AttrsIndex != want.AttrsIndex || got.PrefixLen != want.PrefixLen {
		t.Errorf("\ngot:  {API:%q Rcv:%q IP:%q FP:%q F:%q L:%d C:%d MI:%d AI:%d PL:%d}\nwant:{API:%q Rcv:%q IP:%q FP:%q F:%q L:%d C:%d MI:%d AI:%d PL:%d}",
			got.API, got.Receiver, got.ImportPath, got.FnPkgPath, got.Filename,
			got.Line, got.Column, got.MsgIndex, got.AttrsIndex, got.PrefixLen,
			want.API, want.Receiver, want.ImportPath, want.FnPkgPath, want.Filename,
			want.Line, want.Column, want.MsgIndex, want.AttrsIndex, want.PrefixLen)
	}
}

// TestTask63A1b_BindsRealSlogImportAliases verifies import alias binding for log/slog.Info.
func TestTask63A1b_BindsRealSlogImportAliases(t *testing.T) {
	t.Run("valid fixture detects real aliased slog.Info and rejects nested decoy", func(t *testing.T) {
		src := `package p
import sl "log/slog"
type fake struct{}
func (fake) Info(string, ...any) {}
func f() {
sl.Info("real", "key", "value")
{
sl := fake{}
sl.Info("decoy")
}
}`
		fset := token.NewFileSet()
		file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "valid.go", Source: src})
		if file == nil {
			t.Fatalf("expected non-nil AST for valid source")
		}
		if len(diags) != 0 {
			t.Fatalf("expected 0 diagnostics, got %d", len(diags))
		}
		findings := t63A1bScan(fset, file, info)
		if len(findings) != 1 {
			t.Fatalf("findings count = %d, want 1", len(findings))
		}
		t63A1bAssertFinding(t, findings[0], t63A1Finding{
			API: "Info", Receiver: "package", ImportPath: "log/slog",
			FnPkgPath: "log/slog", Filename: "valid.go",
			Line: 6, Column: 4, MsgIndex: 0, AttrsIndex: 1, PrefixLen: 0,
		})
	})

	t.Run("malformed fixture yields zero findings and T63-MALFORMED diagnostic", func(t *testing.T) {
		src := `package p
func f() {`
		fset := token.NewFileSet()
		file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "malformed.go", Source: src})
		if file != nil {
			t.Errorf("expected nil AST for malformed source")
		}
		t63A1AssertDiags(t, diags, 1, "T63-MALFORMED", "malformed source")
		if diags[0].Line != 2 || diags[0].Column != 11 {
			t.Errorf("pos = (%d,%d), want (2,11)", diags[0].Line, diags[0].Column)
		}
		findings := t63A1bScan(fset, file, info)
		if len(findings) != 0 {
			t.Errorf("findings count = %d, want 0", len(findings))
		}
	})

	t.Run("type-invalid fixture yields zero findings and T63-TYPE diagnostic at 3:24", func(t *testing.T) {
		src := `package p
import "log/slog"
var _ interface{x()} = slog.Info("x")`
		fset := token.NewFileSet()
		file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "typeerror.go", Source: src})
		if file != nil {
			t.Fatalf("expected nil AST for type-invalid source")
		}
		t63A1AssertDiags(t, diags, 1, "T63-TYPE", "type error")
		if diags[0].Line != 3 || diags[0].Column != 24 {
			t.Errorf("pos = (%d,%d), want (3,24)", diags[0].Line, diags[0].Column)
		}
		findings := t63A1bScan(fset, file, info)
		if len(findings) != 0 {
			t.Errorf("findings count = %d, want 0", len(findings))
		}
	})
}
