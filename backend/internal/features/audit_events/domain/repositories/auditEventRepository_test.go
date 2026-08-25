package repositories

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// auditEventsQueryFile is the single sqlc source file for the audit_events
// slice. The path is relative to this package's directory
// (backend/internal/features/audit_events/domain/repositories).
const auditEventsQueryFile = "../../../../../db/queries/audit_events.sql"

// statementAnnotationRe matches sqlc's statement annotations
// (`-- name: <Name> :mode`).
var statementAnnotationRe = regexp.MustCompile(`(?m)^-- name:\s+(\S+)\s+(\S+)\s*$`)

// appendOnlyKeywordRe matches SELECT / UPDATE / DELETE as standalone SQL
// keywords anywhere in the statement bodies.
var appendOnlyKeywordRe = regexp.MustCompile(`\b(SELECT|UPDATE|DELETE)\b`)

// TestAuditEvents_QueryFileIsAppendOnly pins the append-only contract at the
// sqlc source level: exactly one statement, named InsertAuditEvent with
// :exec, and zero SELECT / UPDATE / DELETE anywhere in the SQL bodies. A
// future read/update/delete surface must be a deliberate new slice — the
// append-only invariant is enforced here by the absence of any other
// statement.
func TestAuditEvents_QueryFileIsAppendOnly(t *testing.T) {
	content, err := os.ReadFile(auditEventsQueryFile)
	if err != nil {
		t.Fatalf("read audit_events query file: %v", err)
	}
	src := string(content)

	// Exactly one sqlc statement annotation.
	annotations := statementAnnotationRe.FindAllStringSubmatch(src, -1)
	if len(annotations) != 1 {
		t.Fatalf("expected exactly one sqlc statement, got %d", len(annotations))
	}
	name, mode := annotations[0][1], annotations[0][2]
	if name != "InsertAuditEvent" {
		t.Errorf("statement name: want %q, got %q", "InsertAuditEvent", name)
	}
	if mode != ":exec" {
		t.Errorf("statement mode: want %q, got %q", ":exec", mode)
	}

	// Strip comment lines so the doc comments cannot mask a real statement:
	// the append-only guard inspects only executable SQL.
	var body strings.Builder
	for _, line := range strings.Split(src, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		body.WriteString(trimmed)
		body.WriteString("\n")
	}
	upper := strings.ToUpper(body.String())

	if match := appendOnlyKeywordRe.FindString(upper); match != "" {
		t.Errorf("query file must not contain %s (append-only); body:\n%s", match, body.String())
	}
	if !strings.Contains(upper, "INSERT INTO AUDIT_EVENTS") {
		t.Errorf("expected the single statement to be INSERT INTO audit_events; body:\n%s", body.String())
	}
}
