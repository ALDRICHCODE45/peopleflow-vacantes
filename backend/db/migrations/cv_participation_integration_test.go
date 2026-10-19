//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00021CVDownRefusesDataAndSucceedsEmpty(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	ctx := context.Background()
	candidate, version := uuid.New(), uuid.New()
	// Always restore the full schema, then remove only this test's fixtures.
	defer func() {
		gooseUpAll(t, db)
		if _, err := pool.Exec(ctx, `DELETE FROM candidate_cv_versions WHERE id=$1`, version); err != nil {
			t.Error("CV cleanup failed")
		}
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, candidate); err != nil {
			t.Error("candidate cleanup failed")
		}
	}()
	gooseDownTo(t, db, 21)
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, version, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")); err != nil {
		t.Fatal(err)
	}
	// Even a retained version with no live library label must prevent rollback.
	err := gooseDownOnce(t, db)
	if err == nil || !strings.Contains(err.Error(), "candidate CV data exists") {
		t.Fatal("CV down did not explicitly refuse retained data")
	}
	got, err := goose.GetDBVersion(db)
	if err != nil || got != 21 {
		t.Fatal("refused down changed migration version", got)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM candidate_cv_versions WHERE id=$1`, version).Scan(&count); err != nil || count != 1 {
		t.Fatal("refused down lost CV data")
	}
	if !columnExists(t, pool, "candidate_cv_library", "id") {
		t.Fatal("refused down partially dropped library")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM candidate_cv_versions WHERE id=$1`, version); err != nil {
		t.Fatal(err)
	}
	gooseDownTo(t, db, 20)
	if columnExists(t, pool, "candidate_cv_versions", "id") || columnExists(t, pool, "candidate_cv_library", "id") || !columnExists(t, pool, "vacancy_public_projections", "id") {
		t.Fatal("empty CV down removed wrong schema")
	}
}

func TestMigration00022ParticipationDownRefusesDataAndSucceedsEmpty(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	// Exercise this migration, not whichever migration happens to be latest.
	gooseDownTo(t, db, 22)
	ctx := context.Background()
	actor, recruiter, company, vacancy, version, participation, key := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(t *testing.T, query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal("fixture SQL failed", err)
		}
	}
	defer func() {
		gooseUpAll(t, db)
		for _, entry := range []struct {
			sql string
			id  uuid.UUID
		}{
			{`DELETE FROM participation_stage_history WHERE participation_id=$1`, participation},
			{`DELETE FROM participation_idempotency WHERE process_id=$1`, vacancy},
			{`DELETE FROM process_participations WHERE process_id=$1`, vacancy},
			{`DELETE FROM vacancy_processes WHERE id=$1`, vacancy},
			{`DELETE FROM job_drafts WHERE id=$1`, vacancy},
			{`DELETE FROM companies WHERE id=$1`, company},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, version},
			{`DELETE FROM users WHERE id=$1`, actor},
			{`DELETE FROM users WHERE id=$1`, recruiter},
		} {
			if _, err := pool.Exec(ctx, entry.sql, entry.id); err != nil {
				t.Error("participation fixture cleanup failed")
				return
			}
		}
	}()
	exec(t, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Recruiter','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(t, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(t, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, vacancy, company, recruiter, []byte(`{}`))
	exec(t, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, vacancy, company, recruiter)
	exec(t, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, version, actor, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	for _, data := range []string{"participation", "idempotency_only"} {
		t.Run(data, func(t *testing.T) {
			if data == "participation" {
				exec(t, `INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, participation, vacancy, actor, uuid.New(), version)
				exec(t, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id) VALUES($1,$2,$3,$4)`, uuid.New(), participation, uuid.New(), actor)
			} else {
				exec(t, `INSERT INTO participation_idempotency(candidate_id,process_id,idem_key,fingerprint,fingerprint_algorithm,response_body) VALUES($1,$2,$3,$4,'go-json-v1+sha256',$5)`, actor, vacancy, key, make([]byte, 32), []byte(`{}`))
			}
			err := gooseDownOnce(t, db)
			if err == nil || !strings.Contains(err.Error(), "participation data exists") {
				t.Fatal("participation down did not explicitly refuse data")
			}
			got, err := goose.GetDBVersion(db)
			if err != nil || got != 22 {
				t.Fatal("refused down changed migration version", got)
			}
			var participations, history, idem int
			if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM process_participations WHERE id=$1),(SELECT count(*) FROM participation_stage_history WHERE participation_id=$1),(SELECT count(*) FROM participation_idempotency WHERE process_id=$2)`, participation, vacancy).Scan(&participations, &history, &idem); err != nil {
				t.Fatal(err)
			}
			if (data == "participation" && (participations != 1 || history != 1 || idem != 0)) || (data == "idempotency_only" && (participations != 0 || history != 0 || idem != 1)) {
				t.Fatal("refused down changed participation/history/idempotency data")
			}
			exec(t, `DELETE FROM participation_stage_history WHERE participation_id=$1`, participation)
			exec(t, `DELETE FROM process_participations WHERE id=$1`, participation)
			exec(t, `DELETE FROM participation_idempotency WHERE process_id=$1`, vacancy)
		})
	}
	gooseDownTo(t, db, 21)
	if columnExists(t, pool, "process_participations", "id") || columnExists(t, pool, "participation_stage_history", "id") || columnExists(t, pool, "participation_idempotency", "candidate_id") || !columnExists(t, pool, "candidate_cv_versions", "id") {
		t.Fatal("empty participation down removed wrong schema")
	}
}
