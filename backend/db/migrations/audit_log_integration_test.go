//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// audit-log-v1 §1 and §6: the new columns are backfilled from metadata, the
// table is append-only and the only DELETE is the flagged retention purge.
func TestMigration00056AuditLog(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseDownTo(t, db, 55)

	company, vacancy, draft := uuid.New(), uuid.New(), uuid.New()
	withMeta, bare, onDraft := uuid.New(), uuid.New(), uuid.New()
	insert := `INSERT INTO audit_events(id,actor_type,event_type,entity_type,entity_id,metadata) VALUES($1,'system',$2,$3,$4,$5)`
	for _, row := range [][]any{
		{withMeta, "VacancyTeamCreated", "vacancy", vacancy, `{"company_id":"` + company.String() + `","vacancy_id":"` + vacancy.String() + `"}`},
		{bare, "ParticipationMoved", "process_participation", uuid.New(), `{"company_id":"not-a-uuid"}`},
		{onDraft, "JobDraftSaved", "job_draft", draft, `{"company_id":"` + company.String() + `"}`},
	} {
		if _, err := pool.Exec(ctx, insert, row...); err != nil {
			t.Fatal(err)
		}
	}

	gooseUpTo(t, db, 56)

	backfill := func(id uuid.UUID) (c, v *uuid.UUID) {
		t.Helper()
		if err := pool.QueryRow(ctx, `SELECT company_id, vacancy_id FROM audit_events WHERE id=$1`, id).Scan(&c, &v); err != nil {
			t.Fatal(err)
		}
		return c, v
	}
	if c, v := backfill(withMeta); c == nil || *c != company || v == nil || *v != vacancy {
		t.Fatalf("metadata backfill: company=%v vacancy=%v", c, v)
	}
	if c, v := backfill(bare); c != nil || v != nil {
		t.Fatalf("invalid metadata must stay null: company=%v vacancy=%v", c, v)
	}
	if c, v := backfill(onDraft); c == nil || *c != company || v == nil || *v != draft {
		t.Fatalf("job_draft entity backfill: company=%v vacancy=%v", c, v)
	}

	wantAppendOnly := func(name string, err error) {
		t.Helper()
		if err == nil || !strings.Contains(err.Error(), "audit_events is append-only") {
			t.Fatalf("%s: want append-only refusal, got %v", name, err)
		}
	}
	_, err := pool.Exec(ctx, `UPDATE audit_events SET metadata='{}' WHERE id=$1`, withMeta)
	wantAppendOnly("UPDATE", err)
	_, err = pool.Exec(ctx, `DELETE FROM audit_events WHERE id=$1`, withMeta)
	wantAppendOnly("DELETE", err)
	_, err = pool.Exec(ctx, `TRUNCATE audit_events`)
	wantAppendOnly("TRUNCATE", err)

	old := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO audit_events(id,occurred_at,actor_type,event_type,entity_type,entity_id) VALUES($1, now() - interval '25 months','system','SessionStarted','user',$1)`, old); err != nil {
		t.Fatal(err)
	}
	purge := func(id uuid.UUID, flag bool) error {
		return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if flag {
				if _, err := tx.Exec(ctx, `SET LOCAL peopleflow.audit_purge = 'on'`); err != nil {
					return err
				}
			}
			_, err := tx.Exec(ctx, `DELETE FROM audit_events WHERE id=$1`, id)
			return err
		})
	}
	wantAppendOnly("old row without purge flag", purge(old, false))
	wantAppendOnly("recent row with purge flag", purge(withMeta, true))
	if err := purge(old, true); err != nil {
		t.Fatalf("flagged purge of an expired row: %v", err)
	}
	var left int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events`).Scan(&left); err != nil || left != 3 {
		t.Fatalf("rows after purge = %d (%v), want the 3 recent rows", left, err)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO audit_events(id,actor_type,event_type,entity_type,entity_id,ip_source) VALUES($1,'system','X','user',$1,'client')`, uuid.New()); err == nil || !strings.Contains(err.Error(), "audit_events_ip_source_check") {
		t.Fatalf("ip_source outside bff|peer: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO audit_events(id,actor_type,event_type,entity_type,entity_id,company_id,vacancy_id,ip,user_agent,ip_source) VALUES($1,'user','SessionStarted','user',$1,$2,NULL,'201.141.12.7','Mozilla/5.0','bff')`, uuid.New(), company); err != nil {
		t.Fatalf("insert with the new columns: %v", err)
	}

	gooseDownTo(t, db, 55)
	for _, column := range []string{"company_id", "vacancy_id", "ip", "user_agent", "ip_source"} {
		if columnExists(t, pool, "audit_events", column) {
			t.Fatalf("Down left column %s", column)
		}
	}
	if _, err := pool.Exec(ctx, `DELETE FROM audit_events WHERE id=$1`, withMeta); err != nil {
		t.Fatalf("Down must remove the append-only trigger: %v", err)
	}
}
