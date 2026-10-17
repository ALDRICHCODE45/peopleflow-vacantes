//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00023MovementDefaultsAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 22)
	actor, recruiter, company, vacancy, version, pid, stage := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		gooseUpAll(t, db)
		for _, entry := range []struct {
			sql string
			id  uuid.UUID
		}{
			{`DELETE FROM process_coverage_milestones WHERE process_id=$1`, vacancy},
			{`DELETE FROM participation_stage_history WHERE participation_id=$1`, pid},
			{`DELETE FROM process_participations WHERE id=$1`, pid},
			{`DELETE FROM vacancy_processes WHERE id=$1`, vacancy},
			{`DELETE FROM job_drafts WHERE id=$1`, vacancy},
			{`DELETE FROM companies WHERE id=$1`, company},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, version},
			{`DELETE FROM users WHERE id=$1`, actor}, {`DELETE FROM users WHERE id=$1`, recruiter},
		} {
			if _, err := pool.Exec(ctx, entry.sql, entry.id); err != nil {
				t.Error("movement fixture cleanup failed")
				return
			}
		}
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Recruiter','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, vacancy, company, recruiter, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, vacancy, company, recruiter)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, version, actor, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, pid, vacancy, actor, stage, version)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id) VALUES($1,$2,$3,$4)`, uuid.New(), pid, stage, actor)
	gooseUpAll(t, db)
	var initial int64
	var from *uuid.UUID
	var hire, departure bool
	var kind string
	if err := pool.QueryRow(ctx, `SELECT p.version,h.from_stage_id,h.hire,h.departure,h.actor_kind FROM process_participations p JOIN participation_stage_history h ON h.participation_id=p.id WHERE p.id=$1`, pid).Scan(&initial, &from, &hire, &departure, &kind); err != nil || initial != 1 || from != nil || hire || departure || kind != "candidate" {
		t.Fatal("legacy intake changed", err)
	}
	for _, reason := range []string{"version", "history", "milestone"} {
		t.Run(reason, func(t *testing.T) {
			switch reason {
			case "version":
				exec(`UPDATE process_participations SET version=2 WHERE id=$1`, pid)
			case "history":
				exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,hire,actor_kind) VALUES($1,$2,$3,$4,$5,true,'recruiter')`, uuid.New(), pid, uuid.New(), recruiter, stage)
			case "milestone":
				exec(`INSERT INTO process_coverage_milestones(id,process_id,reached_at,covered,required) VALUES($1,$2,now(),2,2)`, uuid.New(), vacancy)
			}
			var before, after string
			snapshot := `SELECT json_build_array((SELECT row_to_json(p) FROM process_participations p WHERE id=$1),(SELECT json_agg(h ORDER BY h.id) FROM participation_stage_history h WHERE participation_id=$1),(SELECT json_agg(m ORDER BY m.id) FROM process_coverage_milestones m WHERE process_id=$2))::text`
			if err := pool.QueryRow(ctx, snapshot, pid, vacancy).Scan(&before); err != nil {
				t.Fatal(err)
			}
			err := gooseDownOnce(t, db)
			if err == nil || !strings.Contains(err.Error(), "movement data exists") {
				t.Fatal("down must refuse new data", err)
			}
			got, err := goose.GetDBVersion(db)
			if err != nil || got != 23 {
				t.Fatal("refused down changed version", got, err)
			}
			if !columnExists(t, pool, "process_participations", "version") || !columnExists(t, pool, "participation_stage_history", "actor_kind") || !columnExists(t, pool, "process_coverage_milestones", "required") {
				t.Fatal("partial down")
			}
			if err = pool.QueryRow(ctx, snapshot, pid, vacancy).Scan(&after); err != nil || before != after {
				t.Fatal("down lost movement data", err)
			}
			exec(`UPDATE process_participations SET version=1 WHERE id=$1`, pid)
			exec(`DELETE FROM participation_stage_history WHERE participation_id=$1 AND from_stage_id IS NOT NULL`, pid)
			exec(`DELETE FROM process_coverage_milestones WHERE process_id=$1`, vacancy)
		})
	}
	// Empty of NEW data: existing P2b participations and intake must survive down.
	gooseDownTo(t, db, 22)
	if columnExists(t, pool, "process_participations", "version") || columnExists(t, pool, "participation_stage_history", "from_stage_id") || columnExists(t, pool, "process_coverage_milestones", "id") {
		t.Fatal("empty movement down retained schema")
	}
	var participations, history int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM process_participations WHERE id=$1),(SELECT count(*) FROM participation_stage_history WHERE participation_id=$1)`, pid).Scan(&participations, &history); err != nil || participations != 1 || history != 1 {
		t.Fatal("down changed old P2b data", err)
	}
}
