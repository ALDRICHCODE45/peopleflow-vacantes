//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestPsychometricInvitationMigrationGuardedDown(t *testing.T) {
	if testing.Short() {
		t.Skip("isolated migration database")
	}
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	var absent bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('psychometric_invitations') IS NULL`).Scan(&absent); err != nil || absent {
		t.Fatal("migration must create invitations", absent, err)
	}
	gooseDownTo(t, db, 49)
	if err := pool.QueryRow(ctx, `SELECT to_regclass('psychometric_invitations') IS NULL`).Scan(&absent); err != nil || !absent {
		t.Fatal(absent, err)
	}
	gooseUpAll(t, db)
	// Exercise 00050 specifically, independently of later empty migrations.
	gooseDownTo(t, db, 50)
	_, company, actor := seedPrereqs(ctx, t, pool)
	id, pid, cv, iid := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	insertDraftAt(t, pool, company, actor, id, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, company, actor)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, actor, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, pid, id, actor, uuid.New(), cv)
	insert := `INSERT INTO psychometric_invitations(id,participation_id,test,content_version,scoring_version,total_count,origin,created_by,created_at,expires_at,purge_after) VALUES($1,$2,'ipip60-mx','psychometrics.content.v1','psychometrics.scoring.v1',63,'manual',$3,now(),now()+interval '7 days',now()+interval '7 days 12 months')`
	exec(insert, iid, pid, actor)
	if _, err := pool.Exec(ctx, insert, uuid.New(), pid, actor); err == nil {
		t.Fatal("duplicate live slot accepted")
	}
	exec(`UPDATE psychometric_invitations SET finished_at=created_at WHERE id=$1`, iid)
	second := uuid.New()
	exec(insert, second, pid, actor)
	if _, err := pool.Exec(ctx, `UPDATE psychometric_invitations SET finished_at=created_at WHERE id=$1`, second); err == nil {
		t.Fatal("duplicate finished invitation accepted")
	}
	exec(`UPDATE psychometric_invitations SET token_hash=decode(repeat('ab',32),'hex') WHERE id=$1`, iid)
	if _, err := pool.Exec(ctx, `UPDATE psychometric_invitations SET token_hash=decode(repeat('ab',32),'hex') WHERE id=$1`, second); err == nil {
		t.Fatal("duplicate token accepted")
	}
	if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "psychometric invitation data exist; rollback requires an explicit retention decision") {
		t.Fatal(err)
	}
	if v, err := goose.GetDBVersion(db); err != nil || v != 50 {
		t.Fatal(v, err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM psychometric_invitations`).Scan(&n); err != nil || n != 2 {
		t.Fatal(n, err)
	}
	// Only disposable fixtures are removed; never the shared draft_test database.
	exec(`DELETE FROM process_participations WHERE id=$1`, pid)
	gooseDownTo(t, db, 49)
}
