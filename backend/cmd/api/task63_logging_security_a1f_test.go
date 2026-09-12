package main

import (
	"go/ast"
	"go/token"
	"strings"
	"testing"
)

func TestTask63A1f_ClassifiesForbiddenDirectLiteralKeys(t *testing.T) {
	src := `package p
import sl "log/slog"
func f() {
sl.Info("key taxonomy",
"error", nil, "err", nil, " \x45RR ", nil, "\x74oken", nil, "access_token", nil, "refresh_token", nil, "authorization", nil, "body", nil, "request_body", nil, "cv_key", nil, "object_key", nil, "email", nil, "name", nil, ` + "`FULL_NAME`" + `, nil, "dsn", nil, "database_url", nil,
"request_id", nil, "method", nil, "path", nil, "status", nil, "duration", nil, "code_class", nil, "event", nil, "action", nil, "reason", nil, "classification", nil)
}`
	fset := token.NewFileSet()
	file, diags, info := t63A1bParseWithTypes(fset, t63A1Fixture{Name: "a1f.go", Source: src})
	if file == nil || len(diags) != 0 {
		t.Fatalf("expected valid typed fixture, file=%v diagnostics=%d", file != nil, len(diags))
	}
	findings := t63A1bScan(fset, file, info)
	if len(findings) != 1 {
		t.Fatalf("findings count = %d, want 1", len(findings))
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
		if pos.Filename == findings[0].Filename && pos.Line == findings[0].Line && pos.Column == findings[0].Column {
			call = candidate
		}
		return true
	})
	if call == nil {
		t.Fatal("expected AST call matching the scanned finding")
	}

	var forbidden, safe []string
	for i := findings[0].AttrsIndex; i < len(call.Args); i += 2 {
		key, ok := t63A1cFirstLiteralKey(call, i)
		if !ok {
			t.Fatalf("argument %d did not decode as a literal key", i)
		}
		normalized := t63A1fNormalizeLiteralKey(key)
		if t63A1fForbiddenLiteralKey(key) {
			forbidden = append(forbidden, normalized)
		} else {
			safe = append(safe, normalized)
		}
	}
	wantForbidden := []string{"error", "err", "err", "token", "access_token", "refresh_token", "authorization", "body", "request_body", "cv_key", "object_key", "email", "name", "full_name", "dsn", "database_url"}
	wantSafe := []string{"request_id", "method", "path", "status", "duration", "code_class", "event", "action", "reason", "classification"}
	if strings.Join(forbidden, ",") != strings.Join(wantForbidden, ",") || strings.Join(safe, ",") != strings.Join(wantSafe, ",") {
		t.Errorf("forbidden=%q safe=%q, want forbidden=%q safe=%q", forbidden, safe, wantForbidden, wantSafe)
	}
}

func t63A1fNormalizeLiteralKey(key string) string {
	key = strings.TrimSpace(key)
	var normalized strings.Builder
	normalized.Grow(len(key))
	for i := 0; i < len(key); i++ {
		char := key[i]
		if char >= 'A' && char <= 'Z' {
			char += 'a' - 'A'
		}
		normalized.WriteByte(char)
	}
	return normalized.String()
}

func t63A1fForbiddenLiteralKey(key string) bool {
	switch t63A1fNormalizeLiteralKey(key) {
	case "error", "err", "token", "access_token", "refresh_token", "authorization",
		"body", "request_body", "cv_key", "object_key", "email", "name", "full_name",
		"dsn", "database_url":
		return true
	}
	return false
}
