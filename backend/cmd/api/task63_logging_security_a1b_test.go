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
	API          string
	Receiver     string
	ReceiverType string
	ImportPath   string
	FnPkgPath    string
	Filename     string
	Line         int
	Column       int
	MsgIndex     int
	AttrsIndex   int
	PrefixLen    int
}

// t63A1bArgumentBoundaries returns message and attribute argument boundaries for a slog API.
func t63A1bArgumentBoundaries(api string) (msgIndex, attrsIndex, prefixLen int) {
	switch api {
	case "Debug", "Info", "Warn", "Error":
		return 0, 1, 0
	case "DebugContext", "InfoContext", "WarnContext", "ErrorContext":
		return 1, 2, 1
	case "Log", "LogAttrs":
		return 2, 3, 2
	}
	return 0, 0, 0
}

// t63A1bScan checks for canonical log/slog logging calls.
func t63A1bScan(fset *token.FileSet, file *ast.File, info *types.Info) []t63A1Finding {
	var findings []t63A1Finding
	if file == nil || info == nil {
		return findings
	}

	var slogPkg *types.Package
	for _, obj := range info.Uses {
		pn, ok := obj.(*types.PkgName)
		if ok && pn.Imported() != nil && pn.Imported().Path() == "log/slog" {
			slogPkg = pn.Imported()
			break
		}
	}
	if slogPkg == nil {
		return findings
	}
	loggerObj := slogPkg.Scope().Lookup("Logger")
	typeName, ok := loggerObj.(*types.TypeName)
	if !ok || typeName.Pkg() != slogPkg {
		return findings
	}
	named, ok := typeName.Type().(*types.Named)
	if !ok || named.Obj() != typeName {
		return findings
	}
	loggerPointer := types.NewPointer(named)
	allowed := map[string]bool{
		"Debug": true, "Info": true, "Warn": true, "Error": true,
		"DebugContext": true, "InfoContext": true, "WarnContext": true, "ErrorContext": true,
		"Log": true, "LogAttrs": true,
	}

	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		pos := fset.Position(sel.Sel.Pos())

		if x, ok := sel.X.(*ast.Ident); ok {
			if pn, ok := info.Uses[x].(*types.PkgName); ok && pn.Imported() == slogPkg {
				fn, ok := info.Uses[sel.Sel].(*types.Func)
				if ok && fn.Pkg() == slogPkg && allowed[fn.Name()] {
					msgIndex, attrsIndex, prefixLen := t63A1bArgumentBoundaries(fn.Name())
					findings = append(findings, t63A1Finding{
						API: fn.Name(), Receiver: "package", ImportPath: "log/slog", FnPkgPath: "log/slog",
						Filename: pos.Filename, Line: pos.Line, Column: pos.Column,
						MsgIndex: msgIndex, AttrsIndex: attrsIndex, PrefixLen: prefixLen,
					})
				}
				return true
			}
		}

		selection := info.Selections[sel]
		if selection == nil || selection.Kind() != types.MethodVal {
			return true
		}
		fn, ok := selection.Obj().(*types.Func)
		if !ok || fn.Pkg() != slogPkg || !allowed[fn.Name()] || !types.Identical(selection.Recv(), loggerPointer) {
			return true
		}
		signature, ok := fn.Type().(*types.Signature)
		if !ok || signature.Recv() == nil || !types.Identical(signature.Recv().Type(), loggerPointer) {
			return true
		}
		msgIndex, attrsIndex, prefixLen := t63A1bArgumentBoundaries(fn.Name())
		findings = append(findings, t63A1Finding{
			API: fn.Name(), Receiver: "method", ReceiverType: "*log/slog.Logger",
			ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: pos.Filename,
			Line: pos.Line, Column: pos.Column,
			MsgIndex: msgIndex, AttrsIndex: attrsIndex, PrefixLen: prefixLen,
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
		got.ReceiverType != want.ReceiverType || got.ImportPath != want.ImportPath ||
		got.FnPkgPath != want.FnPkgPath || got.Filename != want.Filename ||
		got.Line != want.Line || got.Column != want.Column ||
		got.MsgIndex != want.MsgIndex || got.AttrsIndex != want.AttrsIndex ||
		got.PrefixLen != want.PrefixLen {
		t.Errorf("\ngot:  {API:%q Rcv:%q RT:%q IP:%q FP:%q F:%q L:%d C:%d MI:%d AI:%d PL:%d}\nwant:{API:%q Rcv:%q RT:%q IP:%q FP:%q F:%q L:%d C:%d MI:%d AI:%d PL:%d}",
			got.API, got.Receiver, got.ReceiverType, got.ImportPath, got.FnPkgPath, got.Filename,
			got.Line, got.Column, got.MsgIndex, got.AttrsIndex, got.PrefixLen,
			want.API, want.Receiver, want.ReceiverType, want.ImportPath, want.FnPkgPath, want.Filename,
			want.Line, want.Column, want.MsgIndex, want.AttrsIndex, want.PrefixLen)
	}
}

// t63A1bAssertBinding compares B2 identity and source-position metadata.
func t63A1bAssertBinding(t *testing.T, got, want t63A1Finding) {
	t.Helper()
	if got.API != want.API || got.Receiver != want.Receiver ||
		got.ReceiverType != want.ReceiverType || got.ImportPath != want.ImportPath ||
		got.FnPkgPath != want.FnPkgPath || got.Filename != want.Filename ||
		got.Line != want.Line || got.Column != want.Column {
		t.Errorf("\ngot:  {API:%q Rcv:%q RT:%q IP:%q FP:%q F:%q L:%d C:%d}\nwant:{API:%q Rcv:%q RT:%q IP:%q FP:%q F:%q L:%d C:%d}",
			got.API, got.Receiver, got.ReceiverType, got.ImportPath, got.FnPkgPath, got.Filename, got.Line, got.Column,
			want.API, want.Receiver, want.ReceiverType, want.ImportPath, want.FnPkgPath, want.Filename, want.Line, want.Column)
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

func TestTask63A1b_RecognizesExactlyTenAPIs(t *testing.T) {
	src := `package p
import sl "log/slog"

func f(logger *sl.Logger) {
sl.Debug("package")
logger.Debug("method")
sl.Info("package")
logger.Info("method")
sl.Warn("package")
logger.Warn("method")
sl.Error("package")
logger.Error("method")
sl.DebugContext(nil, "package")
logger.DebugContext(nil, "method")
sl.InfoContext(nil, "package")
logger.InfoContext(nil, "method")
sl.WarnContext(nil, "package")
logger.WarnContext(nil, "method")
sl.ErrorContext(nil, "package")
logger.ErrorContext(nil, "method")
sl.Log(nil, sl.LevelInfo, "package")
logger.Log(nil, sl.LevelInfo, "method")
sl.LogAttrs(nil, sl.LevelInfo, "package")
logger.LogAttrs(nil, sl.LevelInfo, "method")
}`
	fset := token.NewFileSet()
	file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "ten.go", Source: src})
	if file == nil || len(diags) != 0 {
		t.Fatalf("expected valid typed fixture, file=%v diagnostics=%d", file != nil, len(diags))
	}
	findings := t63A1bScan(fset, file, info)
	wants := []t63A1Finding{
		{API: "Debug", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 5, Column: 4},
		{API: "Debug", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 6, Column: 8},
		{API: "Info", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 7, Column: 4},
		{API: "Info", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 8, Column: 8},
		{API: "Warn", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 9, Column: 4},
		{API: "Warn", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 10, Column: 8},
		{API: "Error", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 11, Column: 4},
		{API: "Error", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 12, Column: 8},
		{API: "DebugContext", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 13, Column: 4},
		{API: "DebugContext", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 14, Column: 8},
		{API: "InfoContext", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 15, Column: 4},
		{API: "InfoContext", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 16, Column: 8},
		{API: "WarnContext", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 17, Column: 4},
		{API: "WarnContext", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 18, Column: 8},
		{API: "ErrorContext", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 19, Column: 4},
		{API: "ErrorContext", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 20, Column: 8},
		{API: "Log", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 21, Column: 4},
		{API: "Log", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 22, Column: 8},
		{API: "LogAttrs", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 23, Column: 4},
		{API: "LogAttrs", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "ten.go", Line: 24, Column: 8},
	}
	if len(findings) != len(wants) {
		t.Fatalf("findings count = %d, want %d", len(findings), len(wants))
	}
	for i := range wants {
		t63A1bAssertBinding(t, findings[i], wants[i])
	}
}

func TestTask63A1b_NormalizesArgumentBoundariesExactly(t *testing.T) {
	src := `package p
import sl "log/slog"

func f(logger *sl.Logger) {
sl.Debug("package")
logger.Debug("method")
sl.Info("package")
logger.Info("method")
sl.Warn("package")
logger.Warn("method")
sl.Error("package")
logger.Error("method")
sl.DebugContext(nil, "package")
logger.DebugContext(nil, "method")
sl.InfoContext(nil, "package")
logger.InfoContext(nil, "method")
sl.WarnContext(nil, "package")
logger.WarnContext(nil, "method")
sl.ErrorContext(nil, "package")
logger.ErrorContext(nil, "method")
sl.Log(nil, sl.LevelInfo, "package")
logger.Log(nil, sl.LevelInfo, "method")
sl.LogAttrs(nil, sl.LevelInfo, "package")
logger.LogAttrs(nil, sl.LevelInfo, "method")
}`
	fset := token.NewFileSet()
	file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "boundaries.go", Source: src})
	if file == nil || len(diags) != 0 {
		t.Fatalf("expected valid typed fixture, file=%v diagnostics=%d", file != nil, len(diags))
	}

	wants := []struct {
		api      string
		receiver string
		msg      int
		attrs    int
		prefix   int
	}{
		{"Debug", "package", 0, 1, 0}, {"Debug", "method", 0, 1, 0},
		{"Info", "package", 0, 1, 0}, {"Info", "method", 0, 1, 0},
		{"Warn", "package", 0, 1, 0}, {"Warn", "method", 0, 1, 0},
		{"Error", "package", 0, 1, 0}, {"Error", "method", 0, 1, 0},
		{"DebugContext", "package", 1, 2, 1}, {"DebugContext", "method", 1, 2, 1},
		{"InfoContext", "package", 1, 2, 1}, {"InfoContext", "method", 1, 2, 1},
		{"WarnContext", "package", 1, 2, 1}, {"WarnContext", "method", 1, 2, 1},
		{"ErrorContext", "package", 1, 2, 1}, {"ErrorContext", "method", 1, 2, 1},
		{"Log", "package", 2, 3, 2}, {"Log", "method", 2, 3, 2},
		{"LogAttrs", "package", 2, 3, 2}, {"LogAttrs", "method", 2, 3, 2},
	}
	findings := t63A1bScan(fset, file, info)
	if len(findings) != len(wants) {
		t.Fatalf("findings count = %d, want %d", len(findings), len(wants))
	}
	for i, want := range wants {
		got := findings[i]
		if got.API != want.api || got.Receiver != want.receiver ||
			got.MsgIndex != want.msg || got.AttrsIndex != want.attrs || got.PrefixLen != want.prefix {
			t.Errorf("finding %d = {API:%q Receiver:%q MsgIndex:%d AttrsIndex:%d PrefixLen:%d}, want {API:%q Receiver:%q MsgIndex:%d AttrsIndex:%d PrefixLen:%d}",
				i, got.API, got.Receiver, got.MsgIndex, got.AttrsIndex, got.PrefixLen,
				want.api, want.receiver, want.msg, want.attrs, want.prefix)
		}
	}
}

func TestTask63A1b_BindsOnlyGenuineLoggerReceivers(t *testing.T) {
	src := `package p
import (
sl "log/slog"
"testing"
)
type Logger struct{}
func (Logger) Info(string, ...any) {}
type wrapper struct{ *sl.Logger }
type fieldHolder struct{ Info func(string, ...any) }
func f(logger *sl.Logger, test *testing.T) {
sl.Info("package")
logger.Info("method")
var fake Logger
fake.Info("fake")
var value sl.Logger
value.Info("value")
var promoted wrapper
promoted.Info("promoted")
(*sl.Logger).Info(logger, "method expression")
test.Error("test")
var fields fieldHolder
fields.Info("field")
_ = logger.Info
{
sl := Logger{}
sl.Info("shadow")
}
logger.With("unsupported")
logger.Enabled(nil, sl.LevelInfo)
}`
	fset := token.NewFileSet()
	file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "decoys.go", Source: src})
	if file == nil || len(diags) != 0 {
		t.Fatalf("expected valid typed fixture, file=%v diagnostics=%d", file != nil, len(diags))
	}
	findings := t63A1bScan(fset, file, info)
	wants := []t63A1Finding{
		{API: "Info", Receiver: "package", ReceiverType: "", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "decoys.go", Line: 11, Column: 4},
		{API: "Info", Receiver: "method", ReceiverType: "*log/slog.Logger", ImportPath: "log/slog", FnPkgPath: "log/slog", Filename: "decoys.go", Line: 12, Column: 8},
	}
	if len(findings) != len(wants) {
		t.Fatalf("findings count = %d, want %d", len(findings), len(wants))
	}
	for i := range wants {
		t63A1bAssertBinding(t, findings[i], wants[i])
	}
}
