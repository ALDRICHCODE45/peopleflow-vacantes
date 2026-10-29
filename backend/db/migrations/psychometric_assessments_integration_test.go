//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestPsychometricAssessmentMigrationGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseDownTo(t, db, 50)
	gooseUpTo(t, db, 51)
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
	exec(`INSERT INTO psychometric_invitations(id,participation_id,test,content_version,scoring_version,total_count,origin,created_at,expires_at,purge_after) VALUES($1,$2,'ipip60-mx','psychometrics.content.v1','psychometrics.scoring.v1',63,'auto',now(),now()+interval '7 days',now()+interval '12 months')`, iid, pid)
	cases := []struct{ table, insert string }{
		{"psychometric_consents", `INSERT INTO psychometric_consents VALUES($1,'1',repeat('a',64),now())`},
		{"psychometric_answers", `INSERT INTO psychometric_answers VALUES($1,1,3,0,now())`},
		{"psychometric_answer_events", `INSERT INTO psychometric_answer_events VALUES($1,gen_random_uuid(),1,'put',3,0,now(),1)`},
		{"psychometric_results", `INSERT INTO psychometric_results VALUES($1,'psychometrics.content.v1','psychometrics.scoring.v1',now(),'{}')`},
	}
	for _, tc := range cases {
		t.Run(tc.table, func(t *testing.T) {
			exec(tc.insert, iid)
			if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "psychometric assessment data exist; rollback requires an explicit retention decision") {
				t.Fatal(err)
			}
			if version, err := goose.GetDBVersion(db); err != nil || version != 51 {
				t.Fatal(version, err)
			}
			var n int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+tc.table+` WHERE invitation_id=$1`, iid).Scan(&n); err != nil || n != 1 {
				t.Fatal(n, err)
			}
			exec(`DELETE FROM `+tc.table+` WHERE invitation_id=$1`, iid)
		})
	}
	exec(`INSERT INTO psychometric_answer_events VALUES($1,$2,1,'put',3,0,now(),1)`, iid, uuid.Nil)
	for _, q := range []string{
		`INSERT INTO psychometric_answer_events VALUES($1,'00000000-0000-0000-0000-000000000000',2,'put',4,0,now(),2)`,
		`INSERT INTO psychometric_answer_events VALUES($1,gen_random_uuid(),2,'put',4,0,now(),1)`,
		`INSERT INTO psychometric_answers VALUES($1,64,3,0,now())`,
		`INSERT INTO psychometric_answers VALUES($1,1,6,0,now())`,
	} {
		if _, err := pool.Exec(ctx, q, iid); err == nil {
			t.Fatal("invalid assessment row accepted")
		}
	}
	exec(`DELETE FROM psychometric_answer_events WHERE invitation_id=$1`, iid)
	gooseDownTo(t, db, 50)
	for _, table := range []string{"psychometric_consents", "psychometric_answers", "psychometric_answer_events", "psychometric_results", "psychometric_comparisons"} {
		var absent bool
		if err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NULL`, table).Scan(&absent); err != nil || !absent {
			t.Fatal(table, absent, err)
		}
	}
}
