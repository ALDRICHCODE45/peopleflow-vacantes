package main

import (
	"go/ast"
	"go/token"
	"testing"
)

func TestTask63A1d_IteratesEveryStaticKeyPosition(t *testing.T) {
	src := `package p
import sl "log/slog"
func f() {
sl.Info("authentication rejected", "token", "tok-synthetic", "user_id", 42, "reason", true)
}`
	fset := token.NewFileSet()
	file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "a1d.go", Source: src})
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

	wantIndexes := []int{1, 3, 5}
	wantKeys := []string{"token", "user_id", "reason"}
	gotIndexes := []int{}
	gotKeys := []string{}
	for index := finding.AttrsIndex; index < len(call.Args); index += 2 {
		key, ok := t63A1cFirstLiteralKey(call, index)
		if !ok {
			t.Fatalf("argument %d was not a direct string-literal key", index)
		}
		gotIndexes = append(gotIndexes, index)
		gotKeys = append(gotKeys, key)
	}
	if len(gotIndexes) != len(wantIndexes) {
		t.Fatalf("visited %d arguments, want %d key positions", len(gotIndexes), len(wantIndexes))
	}
	for i := range wantIndexes {
		if gotIndexes[i] != wantIndexes[i] {
			t.Errorf("visited argument %d = %d, want key position %d", i, gotIndexes[i], wantIndexes[i])
		}
		if gotIndexes[i] == finding.MsgIndex || gotIndexes[i]%2 == 0 {
			t.Errorf("visited argument %d = %d, want a key position rather than the message or a value", i, gotIndexes[i])
		}
		if gotKeys[i] != wantKeys[i] {
			t.Errorf("decoded key %d = %q, want %q", i, gotKeys[i], wantKeys[i])
		}
	}
}
