package main

import (
	"go/ast"
	"go/token"
	"strconv"
	"testing"
)

func TestTask63A1c_InterpretsFirstStaticKeyValueArgument(t *testing.T) {
	src := `package p
import sl "log/slog"
func f() {
sl.Info("authentication rejected", "token", "tok-synthetic")
}`
	fset := token.NewFileSet()
	file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "a1c.go", Source: src})
	if file == nil || len(diags) != 0 {
		t.Fatalf("expected valid typed fixture, file=%v diagnostics=%d", file != nil, len(diags))
	}
	findings := t63A1bScan(fset, file, info)
	if len(findings) != 1 {
		t.Fatalf("findings count = %d, want 1", len(findings))
	}
	finding := findings[0]
	if finding.API != "Info" || finding.Receiver != "package" || finding.AttrsIndex != 1 {
		t.Fatalf("finding = {API:%q Receiver:%q AttrsIndex:%d}, want package Info at attrs index 1", finding.API, finding.Receiver, finding.AttrsIndex)
	}

	var call *ast.CallExpr
	ast.Inspect(file, func(node ast.Node) bool {
		candidate, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := candidate.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		pos := fset.Position(sel.Sel.Pos())
		if pos.Filename == finding.Filename && pos.Line == finding.Line && pos.Column == finding.Column {
			call = candidate
		}
		return true
	})
	if call == nil {
		t.Fatal("expected AST call matching the scanned finding")
	}
	key, ok := t63A1cFirstLiteralKey(call, finding.AttrsIndex)
	if key != "token" || !ok {
		t.Errorf("first literal key = (%q, %t), want (\"token\", true)", key, ok)
	}
}

func TestTask63A1c_AcceptsEmptyStringLiteralKey(t *testing.T) {
	call := &ast.CallExpr{Args: []ast.Expr{&ast.BasicLit{Kind: token.STRING, Value: `""`}}}
	key, ok := t63A1cFirstLiteralKey(call, 0)
	if key != "" || !ok {
		t.Errorf("first literal key = (%q, %t), want (\"\", true)", key, ok)
	}
}

func TestTask63A1c_DecodesFirstLiteralKeyEscape(t *testing.T) {
	call := &ast.CallExpr{Args: []ast.Expr{&ast.BasicLit{Kind: token.STRING, Value: "\"\\x74oken\""}}}
	key, ok := t63A1cFirstLiteralKey(call, 0)
	if key != "token" || !ok {
		t.Errorf("first literal key = (%q, %t), want (\"token\", true)", key, ok)
	}
}

func TestTask63A1c_DecodesFirstRawStringLiteralKey(t *testing.T) {
	call := &ast.CallExpr{Args: []ast.Expr{&ast.BasicLit{Kind: token.STRING, Value: "`token`"}}}
	key, ok := t63A1cFirstLiteralKey(call, 0)
	if key != "token" || !ok {
		t.Errorf("first literal key = (%q, %t), want (\"token\", true)", key, ok)
	}
}

func t63A1cFirstLiteralKey(call *ast.CallExpr, attrsIndex int) (string, bool) {
	if call == nil || attrsIndex < 0 || attrsIndex >= len(call.Args) {
		return "", false
	}
	literal, ok := call.Args[attrsIndex].(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return "", false
	}
	key, err := strconv.Unquote(literal.Value)
	if err != nil {
		return "", false
	}
	return key, true
}

func TestTask63A1c_RejectsInvalidFirstLiteralKey(t *testing.T) {
	tests := []struct {
		name       string
		call       *ast.CallExpr
		attrsIndex int
	}{
		{name: "nil call"},
		{name: "empty arguments at index zero", call: &ast.CallExpr{}, attrsIndex: 0},
		{name: "negative index", call: &ast.CallExpr{Args: []ast.Expr{&ast.BasicLit{Kind: token.STRING, Value: `"key"`}}}, attrsIndex: -1},
		{name: "index equals argument length", call: &ast.CallExpr{Args: []ast.Expr{&ast.BasicLit{Kind: token.STRING, Value: `"key"`}}}, attrsIndex: 1},
		{name: "identifier instead of literal", call: &ast.CallExpr{Args: []ast.Expr{&ast.Ident{Name: "key"}}}},
		{name: "integer literal", call: &ast.CallExpr{Args: []ast.Expr{&ast.BasicLit{Kind: token.INT, Value: "1"}}}},
		{name: "malformed string literal", call: &ast.CallExpr{Args: []ast.Expr{&ast.BasicLit{Kind: token.STRING, Value: `"unterminated`}}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if key, ok := t63A1cFirstLiteralKey(tt.call, tt.attrsIndex); key != "" || ok {
				t.Errorf("first literal key = (%q, %t), want (\"\", false)", key, ok)
			}
		})
	}
}
