//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00034BackfillChecksAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 33)
	actor, company, id := uuid.New(), uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		// Parent supplies an isolated DB. Remove only this test's fixtures and
		// restore the latest schema before another migration test can use it.
		_, _ = pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM companies WHERE id=$1`, company)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, actor)
		gooseUpAll(t, db)
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Lifecycle actor','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Lifecycle company',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, id, company, actor, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, company, actor)
	snapshot := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_build_array(id,company_id,status,published_at,published_by)::text FROM vacancy_processes WHERE id=$1`, id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	before := snapshot()
	gooseUpTo(t, db, 34)
	var status, process string
	var version int64
	var nullTimes bool
	if err := pool.QueryRow(ctx, `SELECT status,process_status,lifecycle_version,paused_at IS NULL AND closed_at IS NULL AND process_finished_at IS NULL FROM vacancy_processes WHERE id=$1`, id).Scan(&status, &process, &version, &nullTimes); err != nil {
		t.Fatal(err)
	}
	if before != snapshot() || status != "published" || process != "active" || version != 1 || !nullTimes {
		t.Fatalf("backfill=%s %s %d %v", status, process, version, nullTimes)
	}
	for _, tc := range []struct {
		name, status, process string
		version               int64
		valid                 bool
	}{
		{"published active", "published", "active", 1, true}, {"paused active", "paused", "active", 2, true}, {"closed active", "closed", "active", 3, true}, {"closed finished", "closed", "finished", 4, true},
		{"finished published", "published", "finished", 1, false}, {"finished paused", "paused", "finished", 1, false}, {"draft forbidden", "draft", "active", 1, false}, {"unknown process", "closed", "other", 1, false}, {"zero version", "published", "active", 0, false}, {"negative version", "published", "active", -1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			_, err = tx.Exec(ctx, `UPDATE vacancy_processes SET status=$2,process_status=$3,lifecycle_version=$4 WHERE id=$1`, id, tc.status, tc.process, tc.version)
			if (err == nil) != tc.valid {
				t.Fatal(tc.valid, err)
			}
		})
	}
	for _, tc := range []struct {
		name, action string
		choice       any
		version      int64
		valid        bool
	}{
		{"pause", "pause", nil, 2, true}, {"resume", "resume", nil, 2, true}, {"close continue", "close", "continue", 2, true}, {"close finish", "close", "finish", 2, true}, {"finish", "finish_process", nil, 2, true}, {"reopen", "reopen", nil, 2, true},
		{"unknown", "publish", nil, 2, false}, {"missing choice", "close", nil, 2, false}, {"invalid choice", "close", "active", 2, false}, {"unexpected choice", "pause", "continue", 2, false}, {"initial version", "pause", nil, 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			_, err = tx.Exec(ctx, `INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,process,actor_id,actor_name,created_at) VALUES($1,$2,$3,$4,$5,$6,'Actor',now())`, uuid.New(), id, tc.version, tc.action, tc.choice, actor)
			if (err == nil) != tc.valid {
				t.Fatal(tc.valid, err)
			}
		})
	}
	refuse := func() {
		t.Helper()
		err := gooseDownOnce(t, db)
		if err == nil || !strings.Contains(err.Error(), "non-published/active state or lifecycle history exists") {
			t.Fatal("down should refuse", err)
		}
		v, err := goose.GetDBVersion(db)
		if err != nil || v != 34 {
			t.Fatal(v, err)
		}
		if !columnExists(t, pool, "vacancy_processes", "lifecycle_version") || !columnExists(t, pool, "vacancy_lifecycle_events", "id") {
			t.Fatal("partial down")
		}
	}
	exec(`UPDATE vacancy_processes SET status='paused' WHERE id=$1`, id)
	refuse()
	exec(`UPDATE vacancy_processes SET status='closed',process_status='finished' WHERE id=$1`, id)
	refuse()
	exec(`UPDATE vacancy_processes SET status='published',process_status='active' WHERE id=$1`, id)
	eventID := uuid.New()
	exec(`INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,actor_id,actor_name,created_at) VALUES($1,$2,2,'pause',$3,'Actor',now())`, eventID, id, actor)
	refuse()
	// Duplicate versions and dangling parent/actor references must be rejected.
	for _, q := range []string{
		`INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,actor_id,actor_name,created_at) VALUES($1,$2,2,'resume',$3,'Actor',now())`,
		`INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,actor_id,actor_name,created_at) VALUES($1,$1,3,'resume',$3,'Actor',now())`,
	} {
		if _, err := pool.Exec(ctx, q, uuid.New(), id, actor); err == nil {
			t.Fatal("missing unique/foreign key")
		}
	}
	exec(`DELETE FROM vacancy_lifecycle_events WHERE id=$1`, eventID)
	gooseDownTo(t, db, 33)
	if snapshot() != before || columnExists(t, pool, "vacancy_processes", "lifecycle_version") || columnExists(t, pool, "vacancy_lifecycle_events", "id") {
		t.Fatal("down changed original rows or kept lifecycle")
	}
	if _, err := pool.Exec(ctx, `UPDATE vacancy_processes SET status='paused' WHERE id=$1`, id); err == nil {
		t.Fatal("down did not restore publication CHECK")
	}
}
