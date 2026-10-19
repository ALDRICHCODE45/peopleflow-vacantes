//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00029ExistingRowsShapeAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 28)
	candidate, recruiter, company, vacancy, cv, pid, stage := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, row := range []struct {
			q  string
			id uuid.UUID
		}{
			{`DELETE FROM process_participations WHERE id=$1`, pid},
			{`DELETE FROM vacancy_processes WHERE id=$1`, vacancy},
			{`DELETE FROM job_drafts WHERE id=$1`, vacancy},
			{`DELETE FROM companies WHERE id=$1`, company},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, cv},
			{`DELETE FROM users WHERE id=$1`, candidate}, {`DELETE FROM users WHERE id=$1`, recruiter},
		} {
			if _, err := pool.Exec(ctx, row.q, row.id); err != nil {
				t.Error("filter migration fixture cleanup failed")
				return
			}
		}
		gooseUpAll(t, db)
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Recruiter','recruiter')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, vacancy, company, recruiter, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, vacancy, company, recruiter)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, pid, vacancy, candidate, stage, cv)
	snapshot := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT (to_jsonb(p)-'profile_snapshot')::text FROM process_participations p WHERE id=$1`, pid).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	before := snapshot()
	gooseUpTo(t, db, 29)
	var legacy bool
	if err := pool.QueryRow(ctx, `SELECT profile_snapshot IS NULL FROM process_participations WHERE id=$1`, pid).Scan(&legacy); err != nil || !legacy || snapshot() != before {
		t.Fatal("up changed legacy participation", err)
	}
	for _, tc := range []struct {
		name, value string
		valid       bool
	}{
		{"empty data", `{"city":null,"skills":[],"years_of_experience":null,"education_level":null}`, true},
		{"full data", `{"city":"City","skills":["Go","SQL"],"years_of_experience":0,"education_level":"high_school"}`, true},
		{"bachelor", `{"city":null,"skills":[],"years_of_experience":1,"education_level":"bachelor"}`, true},
		{"master", `{"city":null,"skills":[],"years_of_experience":3,"education_level":"master"}`, true},
		{"phd", `{"city":null,"skills":[],"years_of_experience":5,"education_level":"phd"}`, true},
		{"json null", `null`, false}, {"array", `[]`, false}, {"scalar", `1`, false}, {"missing", `{}`, false},
		{"extra", `{"city":null,"skills":[],"years_of_experience":null,"education_level":null,"salary":1}`, false},
		{"city type", `{"city":1,"skills":[],"years_of_experience":null,"education_level":null}`, false},
		{"skills null", `{"city":null,"skills":null,"years_of_experience":null,"education_level":null}`, false},
		{"skill number", `{"city":null,"skills":[1],"years_of_experience":null,"education_level":null}`, false},
		{"skill null", `{"city":null,"skills":[null],"years_of_experience":null,"education_level":null}`, false},
		{"skill object", `{"city":null,"skills":[{}],"years_of_experience":null,"education_level":null}`, false},
		{"skill nested array", `{"city":null,"skills":[["Go"]],"years_of_experience":null,"education_level":null}`, false},
		{"skill empty nested array", `{"city":null,"skills":[[]],"years_of_experience":null,"education_level":null}`, false},
		{"skill mixed nested array", `{"city":null,"skills":["Go",["SQL"]],"years_of_experience":null,"education_level":null}`, false},
		{"skill deeply nested array", `{"city":null,"skills":[[["Go"]]],"years_of_experience":null,"education_level":null}`, false},
		{"negative years", `{"city":null,"skills":[],"years_of_experience":-1,"education_level":null}`, false},
		{"fraction years", `{"city":null,"skills":[],"years_of_experience":1.5,"education_level":null}`, false},
		{"years string", `{"city":null,"skills":[],"years_of_experience":"1","education_level":null}`, false},
		{"years bool", `{"city":null,"skills":[],"years_of_experience":true,"education_level":null}`, false},
		{"unknown education", `{"city":null,"skills":[],"years_of_experience":null,"education_level":"college"}`, false},
		{"education type", `{"city":null,"skills":[],"years_of_experience":null,"education_level":1}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			_, err = tx.Exec(ctx, `UPDATE process_participations SET profile_snapshot=$2 WHERE id=$1`, pid, []byte(tc.value))
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, accepted=%v", tc.valid, err == nil)
			}
		})
	}
	retained := `{"city":null,"skills":[],"years_of_experience":null,"education_level":null}`
	exec(`UPDATE process_participations SET profile_snapshot=$2 WHERE id=$1`, pid, []byte(retained))
	if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "profile snapshots exist") {
		t.Fatal("down must refuse retained snapshot")
	}
	version, err := goose.GetDBVersion(db)
	if err != nil || version != 29 {
		t.Fatal(version, err)
	}
	var exists bool
	if err = pool.QueryRow(ctx, `SELECT profile_snapshot=$2::jsonb FROM process_participations WHERE id=$1`, pid, retained).Scan(&exists); err != nil || !exists || snapshot() != before {
		t.Fatal("refused down changed data", err)
	}
	exec(`UPDATE process_participations SET profile_snapshot=NULL WHERE id=$1`, pid)
	gooseDownTo(t, db, 28)
	if columnExists(t, pool, "process_participations", "profile_snapshot") || snapshot() != before {
		t.Fatal("down removed legacy data or retained column")
	}
}
