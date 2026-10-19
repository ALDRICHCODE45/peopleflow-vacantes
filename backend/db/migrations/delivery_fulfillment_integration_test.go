//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00027ExistingRowsAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 26)
	actor, recruiter, company, id, cv, pid, stage, next := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		gooseUpAll(t, db)
		for _, entry := range []struct {
			q  string
			id uuid.UUID
		}{
			{`DELETE FROM process_delivery_fulfillments WHERE process_id=$1`, id},
			{`DELETE FROM participation_stage_history WHERE participation_id=$1`, pid},
			{`DELETE FROM process_participations WHERE id=$1`, pid},
			{`DELETE FROM vacancy_processes WHERE id=$1`, id},
			{`DELETE FROM job_drafts WHERE id=$1`, id},
			{`DELETE FROM companies WHERE id=$1`, company},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, cv},
			{`DELETE FROM users WHERE id=$1`, actor}, {`DELETE FROM users WHERE id=$1`, recruiter},
		} {
			if _, err := pool.Exec(ctx, entry.q, entry.id); err != nil {
				t.Error("fulfillment migration fixture cleanup failed")
				return
			}
		}
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Recruiter','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, id, company, recruiter, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, company, recruiter)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, actor, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,version) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',2)`, pid, id, actor, next, cv)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id) VALUES($1,$2,$3,$4)`, uuid.New(), pid, stage, actor)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind) VALUES($1,$2,$3,$4,$5,'recruiter','move')`, uuid.New(), pid, next, recruiter, stage)
	snapshot := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_build_array((SELECT to_jsonb(p) FROM process_participations p WHERE id=$1),(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM participation_stage_history h WHERE participation_id=$1))::text`, pid).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	before := snapshot()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 27)
	if snapshot() != before {
		t.Fatal("migration changed existing participation/history")
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM process_delivery_fulfillments`).Scan(&rows); err != nil || rows != 0 {
		t.Fatal("unexpected backfill", rows, err)
	}
	var index string
	if err := pool.QueryRow(ctx, `SELECT indexdef FROM pg_indexes WHERE indexname='participation_history_first_entry_idx'`).Scan(&index); err != nil || !strings.Contains(index, "participation_id, stage_id, created_at") || !strings.Contains(index, "recovery") {
		t.Fatal(index, err)
	}
	candidates := `[{"participation_id":"` + pid.String() + `","candidate":{"id":"` + actor.String() + `","full_name":"Candidate"},"reached_at":"2026-01-02T12:00:00Z"}]`
	insert := `INSERT INTO process_delivery_fulfillments(process_id,fulfilled_at,result,business_days_delta,target,delivered,cutoff_stage_id,cutoff_stage_name,commitment_date,candidates) VALUES($1,'2026-01-02T12:00:00Z','on_time',0,1,1,$2,'Screening','2026-01-02',$3)`
	exec(insert, id, next, candidates)
	if _, err := pool.Exec(ctx, insert, id, next, candidates); err == nil {
		t.Fatal("duplicate fulfillment accepted")
	}
	var frozen string
	if err := pool.QueryRow(ctx, `SELECT to_jsonb(f)::text FROM process_delivery_fulfillments f WHERE process_id=$1`, id).Scan(&frozen); err != nil {
		t.Fatal(err)
	}
	if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "fulfillment data exists") {
		t.Fatal("down erased snapshot", err)
	}
	version, err := goose.GetDBVersion(db)
	if err != nil || version != 27 || before != snapshot() {
		t.Fatal(version, err)
	}
	var after string
	if err = pool.QueryRow(ctx, `SELECT to_jsonb(f)::text FROM process_delivery_fulfillments f WHERE process_id=$1`, id).Scan(&after); err != nil || frozen != after {
		t.Fatal("refused down changed snapshot", err)
	}
	exec(`DELETE FROM process_delivery_fulfillments WHERE process_id=$1`, id)
	gooseDownTo(t, db, 26)
	if columnExists(t, pool, "process_delivery_fulfillments", "process_id") || snapshot() != before {
		t.Fatal("empty down lost old rows or kept fulfillment table")
	}
	var exists bool
	if err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='participation_history_first_entry_idx')`).Scan(&exists); err != nil || exists {
		t.Fatal(exists, err)
	}
}
