//go:build integration

package migrations_test

import (
	"context"
	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
	"strings"
	"testing"
	"time"
)

// Each disjunct is exercised independently: another history table cannot mask
// a missing guard. Failed Down must be atomic, including goose's version row.
func TestMigration00054DownRefusesHistory(t *testing.T) {
	for _, tc := range []struct{ name, insert string }{
		{"placement_credits", `INSERT INTO placement_credits(id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode) VALUES($1,$2,$3,$1,$1,now(),$4,'with_responsible')`},
		{"vacancy_reassignments", `INSERT INTO vacancy_reassignments(id,draft_id,company_id,from_assignment_id,to_assignment_id,reason,previous_responsible,performed_by,performed_at,state_snapshot) SELECT $1,$3,$2,id,id,'workload','keep_as_collaborator',$4,now(),'{}' FROM vacancy_assignments WHERE draft_id=$3`},
		{"vacancy_commitment_changes", `INSERT INTO vacancy_commitment_changes(id,draft_id,company_id,new_date,reason,performed_by,performed_at) VALUES($1,$3,$2,'2026-12-01','client_request',$4,now())`},
		{"vacancy_team_mode_changes", `INSERT INTO vacancy_team_mode_changes(id,draft_id,company_id,from_mode,to_mode,performed_by,performed_at) VALUES($1,$3,$2,'with_responsible','shared',$4,now())`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, pool, cleanup := isolatedMigrationDB(t)
			defer cleanup()
			ctx := context.Background()
			gooseDownTo(t, db, 53)
			_, company, actor := seedPrereqs(ctx, t, pool)
			draft, history := uuid.New(), uuid.New()
			if _, err := pool.Exec(ctx, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,'{}')`, draft, company, actor); err != nil {
				t.Fatal(err)
			}
			gooseUpTo(t, db, 54)
			if _, err := pool.Exec(ctx, tc.insert, history, company, draft, actor); err != nil {
				t.Fatal(err)
			}
			snapshot := func() string {
				t.Helper()
				var raw string
				if err := pool.QueryRow(ctx, `SELECT jsonb_build_array(
      (SELECT to_jsonb(d) FROM job_drafts d WHERE id=$1),
      (SELECT to_jsonb(t) FROM vacancy_teams t WHERE draft_id=$1),
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vacancy_assignments a WHERE draft_id=$1),
      (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM vacancy_assignment_functions f WHERE draft_id=$1),
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM placement_credits c),
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM vacancy_reassignments r),
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM vacancy_commitment_changes c),
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM vacancy_team_mode_changes m))::text`, draft).Scan(&raw); err != nil {
					t.Fatal(err)
				}
				return raw
			}
			before := snapshot()
			err := gooseDownOnce(t, db)
			if err == nil || !strings.Contains(err.Error(), "cannot remove vacancy teams: placement credits or team/commitment history exists") {
				t.Fatalf("Down refusal: %v", err)
			}
			if version, err := goose.GetDBVersion(db); err != nil || version != 54 {
				t.Fatalf("version=%d: %v", version, err)
			}
			if columnExists(t, pool, "job_drafts", "principal_recruiter_id") || snapshot() != before {
				t.Fatal("rejected Down changed schema or data")
			}
		})
	}
}

func TestMigration00054VacancyTeams(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseDownTo(t, db, 53)
	actor, company, draft := uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Actor','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Company',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields,created_at) VALUES($1,$2,$3,$3,'{}',$4)`, draft, company, actor, at)
	gooseUpTo(t, db, 54)
	var mode, cause, function, fcause string
	var started, fs time.Time
	var assignment uuid.UUID
	var starter *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT t.mode,a.id,a.start_cause,a.started_at,a.started_by,f.function,f.start_cause,f.started_at FROM vacancy_teams t JOIN vacancy_assignments a ON a.draft_id=t.draft_id JOIN vacancy_assignment_functions f ON f.assignment_id=a.id WHERE t.draft_id=$1 AND t.company_id=$2 AND a.company_id=$2 AND a.user_id=$3 AND a.ended_at IS NULL AND f.ended_at IS NULL`, draft, company, actor).Scan(&mode, &assignment, &cause, &started, &starter, &function, &fcause, &fs); err != nil {
		t.Fatal(err)
	}
	if mode != "with_responsible" || cause != "backfill" || function != "responsible" || fcause != "backfill" || !started.Equal(at) || !fs.Equal(at) || starter != nil {
		t.Fatal(mode, cause, function, fcause, started, fs, starter)
	}
	if columnExists(t, pool, "job_drafts", "principal_recruiter_id") {
		t.Fatal("principal column retained")
	}
	for _, table := range []string{"vacancy_teams", "vacancy_assignments", "vacancy_assignment_functions", "vacancy_reassignments", "vacancy_team_mode_changes", "vacancy_commitment_changes", "placement_credits", "placement_credit_recipients"} {
		if !columnExists(t, pool, table, map[string]string{"vacancy_teams": "draft_id", "placement_credit_recipients": "credit_id"}[table]) {
			var exists bool
			if err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, table).Scan(&exists); err != nil || !exists {
				t.Fatal(table, err)
			}
		}
	}
	for _, tc := range []struct {
		name, q string
		args    []any
	}{
		{"active user", `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause) VALUES($1,$2,$3,$4,now(),'added')`, []any{uuid.New(), draft, company, actor}},
		{"open function", `INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause) VALUES($1,$2,$3,'collaborator',now(),'added')`, []any{uuid.New(), assignment, draft}},
		{"open responsible", `WITH a AS (INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause,ended_at,end_cause) VALUES($1,$2,$3,$4,now(),'added',now(),'left') RETURNING id) INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause) SELECT $5,id,$2,'responsible',now(),'added' FROM a`, []any{uuid.New(), draft, company, actor, uuid.New()}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			if _, err = tx.Exec(ctx, tc.q, tc.args...); err == nil || !strings.Contains(err.Error(), "23505") {
				t.Fatal("expected unique violation", err)
			}
		})
	}
	// Ended stays and closed function periods do not collide with the partial indexes.
	exec(`INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause,ended_at,end_cause) VALUES($1,$2,$3,$4,$5,'added',$5,'left')`, uuid.New(), draft, company, actor, at)
	exec(`INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause,ended_at,end_cause) VALUES($1,$2,$3,'responsible',$4,'added',$4,'tramo_ended')`, uuid.New(), assignment, draft, at)
	gooseDownTo(t, db, 53)
	var restored uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT principal_recruiter_id FROM job_drafts WHERE id=$1`, draft).Scan(&restored); err != nil || restored != actor {
		t.Fatal("round-trip principal", restored, err)
	}
	gooseUpTo(t, db, 54)
	exec(`UPDATE vacancy_teams SET mode='shared' WHERE draft_id=$1`, draft)
	exec(`UPDATE vacancy_assignment_functions SET function='member' WHERE draft_id=$1 AND ended_at IS NULL`, draft)
	if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "draft without an open responsible") {
		t.Fatal("unguarded shared down", err)
	}
	if columnExists(t, pool, "job_drafts", "principal_recruiter_id") {
		t.Fatal("rejected down changed schema")
	}
	var retained string
	if err := pool.QueryRow(ctx, `SELECT mode FROM vacancy_teams WHERE draft_id=$1`, draft).Scan(&retained); err != nil || retained != "shared" {
		t.Fatal("rejected down changed team", retained, err)
	}
}
