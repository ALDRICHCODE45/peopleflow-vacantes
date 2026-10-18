//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00024ExistingMovementCatalogAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 23)
	actor, recruiter, company, vacancy, cv, pid, initial, current, exit := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		gooseUpAll(t, db)
		for _, entry := range []struct {
			query string
			id    uuid.UUID
		}{
			{`DELETE FROM participation_stage_history WHERE participation_id=$1`, pid},
			{`DELETE FROM process_participations WHERE id=$1`, pid},
			{`DELETE FROM vacancy_processes WHERE id=$1`, vacancy},
			{`DELETE FROM job_drafts WHERE id=$1`, vacancy},
			{`DELETE FROM companies WHERE id=$1`, company},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, cv},
			{`DELETE FROM users WHERE id=$1`, actor}, {`DELETE FROM users WHERE id=$1`, recruiter},
		} {
			if _, err := pool.Exec(ctx, entry.query, entry.id); err != nil {
				t.Error("discard migration fixture cleanup failed")
				return
			}
		}
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Recruiter','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, vacancy, company, recruiter, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, vacancy, company, recruiter)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, actor, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,version) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',2)`, pid, vacancy, actor, current, cv)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at) VALUES($1,$2,$3,$4,now()-interval '1 hour')`, uuid.New(), pid, initial, actor)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind) VALUES($1,$2,$3,$4,$5,'recruiter')`, uuid.New(), pid, current, recruiter, initial)
	// Compare original cut-4 columns, not the newly additive fields.
	oldSnapshot := func() string {
		t.Helper()
		var s string
		if err := pool.QueryRow(ctx, `SELECT json_build_array((SELECT json_build_array(id,stage_id,version,candidate_id,cv_version_id,questions_snapshot,answers_snapshot,source,created_at) FROM process_participations WHERE id=$1),(SELECT json_agg(json_build_array(id,stage_id,from_stage_id,actor_id,actor_kind,hire,departure,created_at) ORDER BY created_at,id) FROM participation_stage_history WHERE participation_id=$1))::text`, pid).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := oldSnapshot()
	gooseUpAll(t, db)
	// Pin the guarded rollback independently of later additive migrations.
	gooseDownTo(t, db, 24)
	if before != oldSnapshot() {
		t.Fatal("up changed cut-4 personal data or movement history")
	}
	var kinds string
	if err := pool.QueryRow(ctx, `SELECT string_agg(event_kind,',' ORDER BY created_at,id) FROM participation_stage_history WHERE participation_id=$1`, pid).Scan(&kinds); err != nil || kinds != "intake,move" {
		t.Fatal(kinds, err)
	}
	for _, group := range []string{"recruiter", "candidate", "unknown", ""} {
		for _, code := range []string{"requirements_not_met", "profile_mismatch", "salary_expectation", "other_candidate_selected", "accepted_other_offer", "no_longer_interested", "unresponsive", "other", "unknown", ""} {
			t.Run(group+"/"+code, func(t *testing.T) {
				valid := (group == "recruiter" && (code == "requirements_not_met" || code == "profile_mismatch" || code == "salary_expectation" || code == "other_candidate_selected" || code == "other")) || (group == "candidate" && (code == "accepted_other_offer" || code == "no_longer_interested" || code == "unresponsive" || code == "other"))
				_, err := pool.Exec(ctx, `UPDATE process_participations SET stage_id=$2,previous_stage_id=$3,reason_group=$4,reason_code=$5,comment='explanation',discarded_at=now() WHERE id=$1`, pid, exit, current, group, code)
				if (err == nil) != valid {
					t.Fatalf("participation pair valid=%v: %v", valid, err)
				}
				_, err = pool.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind,reason_group,reason_code,comment) VALUES($1,$2,$3,$4,$5,'recruiter','discard',$6,$7,'explanation')`, uuid.New(), pid, exit, recruiter, current, group, code)
				if (err == nil) != valid {
					t.Fatalf("history pair valid=%v: %v", valid, err)
				}
				exec(`UPDATE process_participations SET stage_id=$2,previous_stage_id=NULL,reason_group=NULL,reason_code=NULL,comment=NULL,discarded_at=NULL WHERE id=$1`, pid, current)
				exec(`DELETE FROM participation_stage_history WHERE participation_id=$1 AND event_kind='discard'`, pid)
			})
		}
	}
	for _, reason := range []string{"current discard", "discard history only", "recovery history only"} {
		t.Run(reason, func(t *testing.T) {
			switch reason {
			case "current discard":
				exec(`UPDATE process_participations SET stage_id=$2,previous_stage_id=$3,reason_group='candidate',reason_code='other',comment='Internal',candidate_message='Candidate',discarded_at=now() WHERE id=$1`, pid, exit, current)
			case "discard history only":
				exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind,reason_group,reason_code) VALUES($1,$2,$3,$4,$5,'recruiter','discard','candidate','unresponsive')`, uuid.New(), pid, exit, recruiter, current)
			case "recovery history only":
				exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind) VALUES($1,$2,$3,$4,$5,'recruiter','recovery')`, uuid.New(), pid, current, recruiter, exit)
			}
			snapshot := func() string {
				t.Helper()
				var s string
				if err := pool.QueryRow(ctx, `SELECT json_build_array((SELECT row_to_json(p) FROM process_participations p WHERE id=$1),(SELECT json_agg(h ORDER BY id) FROM participation_stage_history h WHERE participation_id=$1))::text`, pid).Scan(&s); err != nil {
					t.Fatal(err)
				}
				return s
			}
			state := snapshot()
			err := gooseDownOnce(t, db)
			if err == nil || !strings.Contains(err.Error(), "discard data exists") {
				t.Fatal("down erased retained data", err)
			}
			version, err := goose.GetDBVersion(db)
			if err != nil || version != 24 || state != snapshot() || !columnExists(t, pool, "process_participations", "candidate_message") || !columnExists(t, pool, "participation_stage_history", "event_kind") {
				t.Fatal("refused down changed data/schema/version", version, err)
			}
			exec(`UPDATE process_participations SET stage_id=$2,previous_stage_id=NULL,reason_group=NULL,reason_code=NULL,comment=NULL,candidate_message=NULL,discarded_at=NULL WHERE id=$1`, pid, current)
			exec(`DELETE FROM participation_stage_history WHERE participation_id=$1 AND event_kind IN ('discard','recovery')`, pid)
		})
	}
	gooseDownTo(t, db, 23)
	if before != oldSnapshot() || columnExists(t, pool, "process_participations", "discarded_at") || columnExists(t, pool, "participation_stage_history", "event_kind") {
		t.Fatal("empty-of-discard down failed to preserve existing cut-4 rows")
	}
}
