//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestOrgCandidateCVGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 45)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	company, actor, user, process, version, pid, cv := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{actor, user} {
		exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Migration Actor','candidate')`, id, uuid.NewString(), uuid.NewString()+"@example.test")
	}
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'CV Company',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,'{}')`, process, company, actor)
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, process, company, actor)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, version, user, strings.Repeat("a", 64))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, pid, process, user, uuid.New(), version)
	history := uuid.New()
	exec(`INSERT INTO company_candidate_history(id,company_id,candidate_kind,candidate_id,actor_id,changes) VALUES($1,$2,'organic',$3,$4,'[{"field":"phone","contact":true}]')`, history, company, user, actor)
	gooseUpTo(t, db, 46)
	var kind string
	var corrected *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT kind FROM company_candidate_history WHERE id=$1`, history).Scan(&kind); err != nil || kind != "edit" {
		t.Fatal(kind, err)
	}
	if err := pool.QueryRow(ctx, `SELECT corrected_company_cv_id FROM process_participations WHERE id=$1`, pid).Scan(&corrected); err != nil || corrected != nil {
		t.Fatal(corrected, err)
	}
	exec(`INSERT INTO company_candidate_cvs(id,company_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,6,'application/pdf','corrected.pdf')`, cv, company, strings.Repeat("b", 64))
	guard := func() {
		t.Helper()
		if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "retention decision") {
			t.Fatal(err)
		}
		if v, err := goose.GetDBVersion(db); err != nil || v != 46 {
			t.Fatal(v, err)
		}
	}
	t.Run("current reference", func(t *testing.T) {
		exec(`UPDATE process_participations SET corrected_company_cv_id=$2 WHERE id=$1`, pid, cv)
		guard()
		exec(`UPDATE process_participations SET corrected_company_cv_id=NULL WHERE id=$1`, pid)
	})
	t.Run("history alone", func(t *testing.T) {
		exec(`INSERT INTO company_candidate_history(id,company_id,candidate_kind,candidate_id,actor_id,changes,kind,participation_id,file_name) VALUES($1,$2,'organic',$3,$4,'[]','cv_corrected',$5,'corrected.pdf')`, uuid.New(), company, user, actor, pid)
		guard()
		exec(`DELETE FROM company_candidate_history WHERE kind='cv_corrected'`)
	})
	for _, q := range []string{
		`INSERT INTO company_candidate_history(id,company_id,candidate_kind,candidate_id,actor_id,changes) VALUES(gen_random_uuid(),$1,'organic',$2,$3,'[]')`,
		`INSERT INTO company_candidate_history(id,company_id,candidate_kind,candidate_id,actor_id,changes,kind) VALUES(gen_random_uuid(),$1,'organic',$2,$3,'[]','cv_corrected')`,
	} {
		if _, err := pool.Exec(ctx, q, company, user, actor); err == nil {
			t.Fatal("invalid history shape accepted")
		}
	}
	gooseDownTo(t, db, 45)
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM company_candidate_history WHERE id=$1`, history).Scan(&count); err != nil || count != 1 {
		t.Fatal("edit history lost", count, err)
	}
	gooseUpTo(t, db, 46)
	if err := pool.QueryRow(ctx, `SELECT cv_version_id FROM process_participations WHERE id=$1`, pid).Scan(&corrected); err != nil || corrected == nil || *corrected != version {
		t.Fatal("original changed", corrected, err)
	}
}
