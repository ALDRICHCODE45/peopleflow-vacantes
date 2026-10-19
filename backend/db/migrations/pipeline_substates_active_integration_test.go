//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00026ExistingRowsShapesAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 25)
	actor, recruiter, company, vacancy, cv, pid, initial, current, exit, sub := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		// Only this fixture is removed; the test database was supplied by the parent.
		for _, e := range []struct {
			q  string
			id uuid.UUID
		}{
			{`DELETE FROM participation_stage_history WHERE participation_id=$1`, pid}, {`DELETE FROM process_participations WHERE id=$1`, pid},
			{`DELETE FROM vacancy_processes WHERE id=$1`, vacancy}, {`DELETE FROM job_drafts WHERE id=$1`, vacancy},
			{`DELETE FROM companies WHERE id=$1`, company}, {`DELETE FROM candidate_cv_versions WHERE id=$1`, cv},
			{`DELETE FROM users WHERE id=$1`, actor}, {`DELETE FROM users WHERE id=$1`, recruiter},
		} {
			if _, err := pool.Exec(ctx, e.q, e.id); err != nil {
				t.Error("substate migration fixture cleanup failed")
				return
			}
		}
		gooseUpAll(t, db)
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Recruiter','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, vacancy, company, recruiter, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, vacancy, company, recruiter)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, actor, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,version) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',5)`, pid, vacancy, actor, current, cv)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id) VALUES($1,$2,$3,$4)`, uuid.New(), pid, initial, actor)
	for _, kind := range []string{"move", "discard", "recovery"} {
		q := `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind,hire,departure) VALUES($1,$2,$3,$4,$5,'recruiter',$6,$7,$8)`
		if kind == "discard" {
			exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind,reason_group,reason_code,comment,candidate_message,departure) VALUES($1,$2,$3,$4,$5,'recruiter','discard','candidate','other','Retained internal','Retained candidate',true)`, uuid.New(), pid, exit, recruiter, current)
		} else {
			exec(q, uuid.New(), pid, current, recruiter, initial, kind, kind == "move", false)
		}
	}
	// A cut-4 departure is retained too, independently of discard/recovery.
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,actor_kind,event_kind,departure) VALUES($1,$2,$3,$4,$5,'recruiter','move',true)`, uuid.New(), pid, initial, recruiter, current)
	oldSnapshot := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_build_array((SELECT to_jsonb(p)-'substate_id' FROM process_participations p WHERE id=$1),(SELECT jsonb_agg(to_jsonb(h)-'from_substate_id'-'from_substate_name'-'to_substate_id'-'to_substate_name' ORDER BY id) FROM participation_stage_history h WHERE participation_id=$1 AND event_kind<>'substate'))::text`, pid).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	checks := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname)::text FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE k.contype='c' AND c.relname IN ('process_participations','participation_stage_history')`).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	beforeChecks := checks()
	// Deployment must also accept a participation that is currently discarded,
	// not merely one whose history contains a past discard.
	exec(`UPDATE process_participations SET stage_id=$2,previous_stage_id=$3,reason_group='candidate',reason_code='unresponsive',comment='Private',candidate_message='Retained',discarded_at=now() WHERE id=$1`, pid, exit, current)
	before := oldSnapshot()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 26) // Pin this rollback independently of later additive migrations.
	if before != oldSnapshot() {
		t.Fatal("migration rewrote personal data or cut-4/5 history")
	}
	var emptySubstate bool
	if err := pool.QueryRow(ctx, `SELECT substate_id IS NULL FROM process_participations WHERE id=$1`, pid).Scan(&emptySubstate); err != nil || !emptySubstate {
		t.Fatal("existing discard acquired a substate", err)
	}
	// Restore active state for the independent substate shape/rollback matrix.
	exec(`UPDATE process_participations SET stage_id=$2,previous_stage_id=NULL,reason_group=NULL,reason_code=NULL,comment=NULL,candidate_message=NULL,discarded_at=NULL WHERE id=$1`, pid, current)
	before = oldSnapshot()
	fullSnapshot := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_build_array((SELECT to_jsonb(p) FROM process_participations p WHERE id=$1),(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM participation_stage_history h WHERE participation_id=$1))::text`, pid).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	exec(`UPDATE process_participations SET substate_id=$2 WHERE id=$1`, pid, sub)
	state := fullSnapshot()
	if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "substate data exists") {
		t.Fatal("active data rollback accepted", err)
	}
	version, e := goose.GetDBVersion(db)
	if e != nil || version != 26 || state != fullSnapshot() || !columnExists(t, pool, "process_participations", "substate_id") {
		t.Fatal("refused rollback changed data/schema/version", version, e)
	}
	exec(`UPDATE process_participations SET substate_id=NULL WHERE id=$1`, pid)
	for _, tc := range []struct {
		name, q string
		valid   bool
	}{
		{"set", `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,to_substate_id,to_substate_name) VALUES($1,$2,$3,$4,'recruiter','substate',$5,'Interview')`, true},
		{"clear", `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,from_substate_id,from_substate_name) VALUES($1,$2,$3,$4,'recruiter','substate',$5,'Interview')`, true},
		{"missing name", `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,to_substate_id) VALUES($1,$2,$3,$4,'recruiter','substate',$5)`, false},
		{"name without id", `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,to_substate_name) VALUES($1,$2,$3,$4,'recruiter','substate',$5::text)`, false},
		{"same id", `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,from_substate_id,from_substate_name,to_substate_id,to_substate_name) VALUES($1,$2,$3,$4,'recruiter','substate',$5,'Before',$5,'After')`, false},
		{"candidate actor", `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,to_substate_id,to_substate_name) VALUES($1,$2,$3,$4,'candidate','substate',$5,'Interview')`, false},
		{"hire", `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,to_substate_id,to_substate_name,hire) VALUES($1,$2,$3,$4,'recruiter','substate',$5,'Interview',true)`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			hid := uuid.New()
			_, err := pool.Exec(ctx, tc.q, hid, pid, current, recruiter, sub)
			if (err == nil) != tc.valid {
				t.Fatal(tc.valid, err)
			}
			if tc.valid {
				retained := fullSnapshot()
				if err = gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "substate data exists") {
					t.Fatal("history-only rollback accepted", err)
				}
				version, e := goose.GetDBVersion(db)
				if e != nil || version != 26 || before != oldSnapshot() || retained != fullSnapshot() {
					t.Fatal(version, e)
				}
				exec(`DELETE FROM participation_stage_history WHERE id=$1`, hid)
			}
		})
	}
	// SQL can enforce the discarded part of the invariant, not JSON stage kinds.
	if _, err := pool.Exec(ctx, `UPDATE process_participations SET substate_id=$2,stage_id=$3,previous_stage_id=$4,reason_group='candidate',reason_code='unresponsive',discarded_at=now() WHERE id=$1`, pid, sub, exit, current); err == nil {
		t.Fatal("discarded participation accepted substate")
	}
	gooseDownTo(t, db, 25)
	if got := checks(); got != beforeChecks {
		t.Fatalf("down did not restore exact CHECK definitions:\nbefore %s\nafter %s", beforeChecks, got)
	}
	if before != oldSnapshot() || columnExists(t, pool, "process_participations", "substate_id") || columnExists(t, pool, "participation_stage_history", "to_substate_name") {
		t.Fatal("down lost cut-4/5 rows or retained columns")
	}
}
