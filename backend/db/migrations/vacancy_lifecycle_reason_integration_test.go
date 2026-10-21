//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMigration00035BackfillChecksAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 34)
	actor, company, id := uuid.New(), uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM companies WHERE id=$1`, company)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, actor)
		gooseUpAll(t, db)
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Actor','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Company',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, id, company, actor, []byte(`{}`))
	first := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'closed',$3,$4)`, id, company, first.Add(24*time.Hour), actor)
	exec(`INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version,skills,screening_questions) VALUES($1,$2,'Title','','remote','full_time','indefinite','technology','[]',$3,1,'{}',0)`, id, company, first)
	event := uuid.New()
	exec(`INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,process,actor_id,actor_name,created_at) VALUES($1,$2,2,'close','continue',$3,'Actor',now())`, event, id, actor)
	gooseUpTo(t, db, 35)
	var at time.Time
	var legacyNull bool
	if err := pool.QueryRow(ctx, `SELECT published_at,(SELECT reason IS NULL AND reason_note IS NULL FROM vacancy_lifecycle_events WHERE id=$2) FROM vacancy_processes WHERE id=$1`, id, event).Scan(&at, &legacyNull); err != nil || !at.Equal(first) || !legacyNull {
		t.Fatal("backfill/legacy reason", at, legacyNull, err)
	}
	for _, tc := range []struct {
		name   string
		reason any
		note   any
		valid  bool
	}{
		{"legacy", nil, nil, true},
		{"filled", "filled", nil, true},
		{"cancelled", "cancelled", nil, true},
		{"other", "other", "Explanation", true},
		{"200 code points", "other", strings.Repeat("界", 200), true},
		{"unknown", "unknown", nil, false},
		{"note without reason", nil, "note", false},
		{"filled note", "filled", "note", false},
		{"cancelled note", "cancelled", "note", false},
		{"missing note", "other", nil, false},
		{"empty note", "other", "", false},
		{"blank note", "other", " \t\n ", false},
		{"201 code points", "other", strings.Repeat("界", 201), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			_, err = tx.Exec(ctx, `UPDATE vacancy_lifecycle_events SET reason=$2,reason_note=$3 WHERE id=$1`, event, tc.reason, tc.note)
			if (err == nil) != tc.valid {
				t.Fatal(tc.valid, err)
			}
		})
	}
	if _, err := pool.Exec(ctx, `INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,actor_id,actor_name,created_at,reason) VALUES($1,$2,3,'pause',$3,'Actor',now(),'filled')`, uuid.New(), id, actor); err == nil {
		t.Fatal("non-close reason allowed")
	}
	exec(`UPDATE vacancy_lifecycle_events SET reason='other',reason_note='Explanation' WHERE id=$1`, event)
	if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "recorded reasons exist") {
		t.Fatal("unguarded down", err)
	}
	if !columnExists(t, pool, "vacancy_lifecycle_events", "reason") || !columnExists(t, pool, "vacancy_lifecycle_events", "reason_note") {
		t.Fatal("partial down")
	}
	exec(`UPDATE vacancy_lifecycle_events SET reason=NULL,reason_note=NULL WHERE id=$1`, event)
	gooseDownTo(t, db, 34)
	if columnExists(t, pool, "vacancy_lifecycle_events", "reason") || columnExists(t, pool, "vacancy_lifecycle_events", "reason_note") {
		t.Fatal("down retained columns")
	}
	if err := pool.QueryRow(ctx, `SELECT published_at FROM vacancy_processes WHERE id=$1`, id).Scan(&at); err != nil || !at.Equal(first) {
		t.Fatal("down lost repaired first publication", at, err)
	}
}
