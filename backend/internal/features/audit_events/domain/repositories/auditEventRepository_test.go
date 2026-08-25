package repositories

import (
	"context"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/jackc/pgx/v5"
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

// TestAuditEventRepository_PortExposesAppendOnly pins the append-only port
// surface (design D4 + the audit_events spec "Append-Only Port" requirement)
// with reflection: exactly one method, Append(ctx context.Context, tx pgx.Tx,
// event entities.AuditEvent) error, and no Update / Delete / Read / List /
// Backfill method — the enforcement is the absence of surface (no caller can
// mutate or read an appended event through the port). The pgx.Tx parameter
// pins the tx-scoped co-write contract: Append runs inside a caller-owned
// transaction and MUST NOT begin/commit one of its own.
func TestAuditEventRepository_PortExposesAppendOnly(t *testing.T) {
	portType := reflect.TypeOf((*AuditEventRepository)(nil)).Elem()

	if n := portType.NumMethod(); n != 1 {
		t.Fatalf("AuditEventRepository must expose exactly one method, got %d", n)
	}
	m := portType.Method(0)
	if m.Name != "Append" {
		t.Fatalf("the single port method must be Append, got %q", m.Name)
	}

	ctxType := reflect.TypeOf((*context.Context)(nil)).Elem()
	txType := reflect.TypeOf((*pgx.Tx)(nil)).Elem()
	eventType := reflect.TypeOf((*entities.AuditEvent)(nil)).Elem()
	errType := reflect.TypeOf((*error)(nil)).Elem()

	sig := m.Type
	if sig.NumIn() != 3 {
		t.Fatalf("Append must take (ctx, tx, event): got %d inputs", sig.NumIn())
	}
	if sig.In(0) != ctxType {
		t.Errorf("Append param 0: want context.Context, got %v", sig.In(0))
	}
	if sig.In(1) != txType {
		t.Errorf("Append param 1: want pgx.Tx (caller-owned transaction), got %v", sig.In(1))
	}
	if sig.In(2) != eventType {
		t.Errorf("Append param 2: want entities.AuditEvent, got %v", sig.In(2))
	}
	if sig.NumOut() != 1 || sig.Out(0) != errType {
		t.Errorf("Append must return exactly error, got %v", sig)
	}

	for _, forbidden := range []string{"Update", "Delete", "Read", "List", "Backfill"} {
		if _, ok := portType.MethodByName(forbidden); ok {
			t.Errorf("AuditEventRepository must not expose a %s method (append-only)", forbidden)
		}
	}
}
