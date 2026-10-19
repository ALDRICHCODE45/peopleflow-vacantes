//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00028ExistingKindsShapesAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 27)
	candidate, recruiter, company, id, cv, pid, initial, current, exit, sub := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, entry := range []struct {
			q  string
			id uuid.UUID
		}{
			{`DELETE FROM participation_stage_history WHERE participation_id=$1`, pid},
			{`DELETE FROM process_participations WHERE id=$1`, pid},
			{`DELETE FROM vacancy_processes WHERE id=$1`, id},
			{`DELETE FROM job_drafts WHERE id=$1`, id},
			{`DELETE FROM companies WHERE id=$1`, company},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, cv},
			{`DELETE FROM users WHERE id=$1`, candidate}, {`DELETE FROM users WHERE id=$1`, recruiter},
		} {
			if _, err := pool.Exec(ctx, entry.q, entry.id); err != nil {
				t.Error("column migration fixture cleanup failed")
				return
			}
		}
		gooseUpAll(t, db)
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Recruiter','recruiter')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, id, company, recruiter, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, company, recruiter)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,version,previous_stage_id,reason_group,reason_code,comment,candidate_message,discarded_at) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',6,$6,'candidate','other','Retained internal','Retained candidate',now())`, pid, id, candidate, exit, cv, current)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id) VALUES($1,$2,$3,$4)`, uuid.New(), pid, initial, candidate)
	for _, kind := range []string{"move", "recovery"} {
		exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind,hire) VALUES($1,$2,$3,$4,$5,'recruiter',$6,true)`, uuid.New(), pid, current, recruiter, initial, kind)
	}
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind,departure) VALUES($1,$2,$3,$4,$5,'recruiter','move',true)`, uuid.New(), pid, initial, recruiter, current)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind,reason_group,reason_code,comment,candidate_message,departure) VALUES($1,$2,$3,$4,$5,'recruiter','discard','candidate','other','Retained internal','Retained candidate',true)`, uuid.New(), pid, exit, recruiter, current)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,to_substate_id,to_substate_name) VALUES($1,$2,$3,$4,'recruiter','substate',$5,'Interview')`, uuid.New(), pid, current, recruiter, sub)
	snapshot := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_build_array((SELECT to_jsonb(p) FROM process_participations p WHERE id=$1),(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM participation_stage_history h WHERE participation_id=$1))::text`, pid).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	checks := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname)::text FROM pg_constraint WHERE conrelid='participation_stage_history'::regclass AND contype='c'`).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	before, oldChecks := snapshot(), checks()
	gooseUpTo(t, db, 28)
	if before != snapshot() {
		t.Fatal("up changed old rows")
	}
	for _, tc := range []struct {
		name, extra string
		valid       bool
	}{
		{"valid", "", true},
		{"candidate actor", ",actor_kind='candidate'", false},
		{"from stage", ",from_stage_id='" + initial.String() + "'", false},
		{"hire", ",hire=true", false},
		{"departure", ",departure=true", false},
		{"reason", ",reason_group='candidate',reason_code='unresponsive'", false},
		{"comment", ",comment='Private'", false},
		{"message", ",candidate_message='Message'", false},
		{"substate", ",to_substate_id='" + sub.String() + "',to_substate_name='Interview'", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			hid := uuid.New()
			_, err = tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind) VALUES($1,$2,$3,$4,'recruiter','not_applicable')`, hid, pid, current, recruiter)
			if err == nil && tc.extra != "" {
				_, err = tx.Exec(ctx, `UPDATE participation_stage_history SET event_kind='not_applicable'`+tc.extra+` WHERE id=$1`, hid)
			}
			if (err == nil) != tc.valid {
				t.Fatal(tc.valid, err)
			}
		})
	}
	markID := uuid.New()
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind) VALUES($1,$2,$3,$4,'recruiter','not_applicable')`, markID, pid, current, recruiter)
	retained := snapshot()
	if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "not applicable history exists") {
		t.Fatal(err)
	}
	version, err := goose.GetDBVersion(db)
	if err != nil || version != 28 || snapshot() != retained {
		t.Fatal(version, err)
	}
	exec(`DELETE FROM participation_stage_history WHERE id=$1`, markID)
	gooseDownTo(t, db, 27)
	if snapshot() != before || checks() != oldChecks {
		t.Fatal("down changed old rows or did not restore exact CHECKs")
	}
	if _, err = pool.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind) VALUES($1,$2,$3,$4,'recruiter','not_applicable')`, uuid.New(), pid, current, recruiter); err == nil {
		t.Fatal("down still accepts new kind")
	}
}
