//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/audittest"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// auditRow is one audit_events row as the screen would read it.
type auditRow struct {
	ActorType  string
	ActorID    *uuid.UUID
	EventType  string
	EntityType string
	EntityID   uuid.UUID
	CompanyID  *uuid.UUID
	VacancyID  *uuid.UUID
	Metadata   map[string]any
	IP         *string
	UserAgent  *string
	IPSource   *string
}

// auditRowsWhere returns the rows matching the WHERE clause, oldest first.
func auditRowsWhere(t *testing.T, pool *pgxpool.Pool, where string, args ...any) []auditRow {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT actor_type, actor_id, event_type, entity_type, entity_id, company_id, vacancy_id, metadata, host(ip), user_agent, ip_source FROM audit_events WHERE `+where+` ORDER BY occurred_at, id`, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []auditRow{}
	for rows.Next() {
		var r auditRow
		var raw []byte
		if err := rows.Scan(&r.ActorType, &r.ActorID, &r.EventType, &r.EntityType, &r.EntityID, &r.CompanyID, &r.VacancyID, &raw, &r.IP, &r.UserAgent, &r.IPSource); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &r.Metadata); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// auditRowsOf returns the company's rows of one event type, oldest first.
func auditRowsOf(t *testing.T, pool *pgxpool.Pool, company uuid.UUID, eventType string) []auditRow {
	t.Helper()
	return auditRowsWhere(t, pool, `company_id=$1 AND event_type=$2`, company, eventType)
}

// auditCompanyCount counts every audit row of the company, whatever its type.
func auditCompanyCount(t *testing.T, pool *pgxpool.Pool, company uuid.UUID) int {
	t.Helper()
	return draftFlowCount(t, pool, `SELECT count(*) FROM audit_events WHERE company_id=$1`, company)
}

// wantAuditRow is the exact shape a test expects; every column is compared.
type wantAuditRow struct {
	actor      uuid.UUID
	eventType  string
	entityType string
	entityID   uuid.UUID
	company    uuid.UUID
	vacancy    *uuid.UUID
	metadata   map[string]any
}

func assertAuditRow(t *testing.T, got auditRow, want wantAuditRow) {
	t.Helper()
	if got.ActorType != "user" || got.ActorID == nil || *got.ActorID != want.actor {
		t.Errorf("%s actor = %s %v, want user %s", want.eventType, got.ActorType, got.ActorID, want.actor)
	}
	if got.EventType != want.eventType || got.EntityType != want.entityType || got.EntityID != want.entityID {
		t.Errorf("event/entity = %s %s %s, want %s %s %s", got.EventType, got.EntityType, got.EntityID, want.eventType, want.entityType, want.entityID)
	}
	if got.CompanyID == nil || *got.CompanyID != want.company {
		t.Errorf("%s company_id = %v, want %s", want.eventType, got.CompanyID, want.company)
	}
	if (got.VacancyID == nil) != (want.vacancy == nil) || (want.vacancy != nil && *got.VacancyID != *want.vacancy) {
		t.Errorf("%s vacancy_id = %v, want %v", want.eventType, got.VacancyID, want.vacancy)
	}
	if !reflect.DeepEqual(got.Metadata, want.metadata) {
		t.Errorf("%s metadata = %v, want %v", want.eventType, got.Metadata, want.metadata)
	}
}

// auditBlock installs a NOT VALID CHECK that refuses the listed event types for
// one company, so the audit insert of the request under test fails while every
// other write succeeds. The returned func lifts the block; cleanup lifts it too.
func auditBlock(t *testing.T, pool *pgxpool.Pool, company uuid.UUID, events ...string) (allow func()) {
	t.Helper()
	name := "audit_block_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := make([]string, len(events))
	for i, e := range events {
		quoted[i] = "'" + e + "'"
	}
	exec := func(q string) {
		t.Helper()
		if _, err := pool.Exec(context.Background(), q); err != nil {
			t.Fatal(err)
		}
	}
	allow = func() { exec(`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS ` + name) }
	t.Cleanup(allow)
	exec(fmt.Sprintf(`ALTER TABLE audit_events ADD CONSTRAINT %s CHECK (event_type NOT IN (%s) OR company_id IS DISTINCT FROM '%s'::uuid) NOT VALID`, name, strings.Join(quoted, ","), company))
	return allow
}

// auditDeleteCompany removes every audit row of a company (test cleanup only;
// the table is append-only for the application).
func auditDeleteCompany(pool *pgxpool.Pool, company uuid.UUID) error {
	return audittest.Delete(context.Background(), pool, `DELETE FROM audit_events WHERE company_id=$1`, company)
}

// auditDeleteActor removes every audit row of an actor (test cleanup only).
func auditDeleteActor(pool *pgxpool.Pool, actor uuid.UUID) error {
	return audittest.Delete(context.Background(), pool, `DELETE FROM audit_events WHERE actor_id=$1`, actor)
}
