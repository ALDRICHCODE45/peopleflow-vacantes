//go:build integration

package migrations_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
)

func TestManualIntakeStorageUpChecksPreservationAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 35)
	actor, user, company, process, cv, organic, history := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	manual, manualCV, participation, manualHistory := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	country, err := pool.Exec(ctx, `INSERT INTO geo_countries VALUES('XZ','Test','Test') ON CONFLICT DO NOTHING`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		gooseUpAll(t, db)
		for _, q := range []struct {
			sql string
			id  uuid.UUID
		}{
			{`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT p.id FROM process_participations p JOIN vacancy_processes v ON v.id=p.process_id WHERE v.company_id=$1)`, company},
			{`DELETE FROM process_participations WHERE process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`, company},
			{`DELETE FROM company_candidate_cvs WHERE company_id=$1`, company},
			{`DELETE FROM company_candidate_languages WHERE company_candidate_id=$1`, manual},
			{`DELETE FROM company_candidates WHERE id=$1`, manual},
			{`DELETE FROM vacancy_processes WHERE company_id=$1`, company},
			{`DELETE FROM job_drafts WHERE company_id=$1`, company},
			{`DELETE FROM companies WHERE id=$1`, company},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, cv},
			{`DELETE FROM users WHERE id=$1`, user},
			{`DELETE FROM users WHERE id=$1`, actor},
		} {
			if _, err := pool.Exec(ctx, q.sql, q.id); err != nil {
				t.Error("fixture cleanup", err)
			}
		}
		if country.RowsAffected() == 1 {
			if _, err := pool.Exec(ctx, `DELETE FROM geo_countries WHERE code='XZ'`); err != nil {
				t.Error(err)
			}
		}
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Recruiter','recruiter'),($4,$5,$6,'Candidate','candidate')`, actor, uuid.NewString(), uuid.NewString()+"@example.test", user, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Manual Test',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,'{}')`, process, company, actor)
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, process, company, actor)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, user, strings.Repeat("a", 64))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, organic, process, user, uuid.New(), cv)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id) VALUES($1,$2,$3,$4)`, history, organic, uuid.New(), user)
	var before, historyBefore string
	if err := pool.QueryRow(ctx, `SELECT to_jsonb(p)::text FROM process_participations p WHERE id=$1`, organic).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT to_jsonb(h)::text FROM participation_stage_history h WHERE id=$1`, history).Scan(&historyBefore); err != nil {
		t.Fatal(err)
	}
	gooseUpTo(t, db, 38)
	var after, historyAfter string
	if err := pool.QueryRow(ctx, `SELECT (to_jsonb(p)-'company_candidate_id'-'company_candidate_cv_id'-'added_by')::text FROM process_participations p WHERE id=$1`, organic).Scan(&after); err != nil || before != after {
		t.Fatal("organic row changed", err)
	}
	if err := pool.QueryRow(ctx, `SELECT to_jsonb(h)::text FROM participation_stage_history h WHERE id=$1`, history).Scan(&historyAfter); err != nil || historyBefore != historyAfter {
		t.Fatal("organic history changed", err)
	}
	exec(`INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,education_level,country_code,created_by) VALUES($1,$2,'Manual Candidate',' Person@Example.test ','person@example.test','bachelor','XZ',$3)`, manual, company, actor)
	exec(`INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,1,'application/pdf','cv.pdf')`, manualCV, company, manual, strings.Repeat("b", 64))
	exec(`INSERT INTO process_participations(id,process_id,company_candidate_id,stage_id,company_candidate_cv_id,questions_snapshot,answers_snapshot,source,added_by) VALUES($1,$2,$3,$4,$5,'[]','[]','manual',$6)`, participation, process, manual, uuid.New(), manualCV, actor)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind) VALUES($1,$2,$3,$4,'recruiter','intake')`, manualHistory, participation, uuid.New(), actor)
	// Reusing an organic account: manual source on the user, CV owned by the company only.
	reuseProcess, reuseCV, reuse := uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,'{}')`, reuseProcess, company, actor)
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, reuseProcess, company, actor)
	exec(`INSERT INTO company_candidate_cvs(id,company_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,1,'application/pdf','cv.pdf')`, reuseCV, company, strings.Repeat("c", 64))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,company_candidate_cv_id,questions_snapshot,answers_snapshot,source,added_by) VALUES($1,$2,$3,$4,$5,'[]','[]','manual',$6)`, reuse, reuseProcess, user, uuid.New(), reuseCV, actor)

	for _, tc := range []struct {
		name, query, code string
		id                uuid.UUID
	}{
		{"intake cannot hire", `UPDATE participation_stage_history SET hire=true WHERE id=$1`, "23514", manualHistory},
		{"intake cannot depart", `UPDATE participation_stage_history SET departure=true WHERE id=$1`, "23514", manualHistory},
		{"move requires from stage", `UPDATE participation_stage_history SET event_kind='move' WHERE id=$1`, "23514", manualHistory},
		{"unknown actor kind", `UPDATE participation_stage_history SET actor_kind='system' WHERE id=$1`, "23514", manualHistory},
		{"reuse organic identity for manual intake", `UPDATE process_participations SET source='manual',cv_version_id=NULL,company_candidate_cv_id='` + manualCV.String() + `',added_by='` + actor.String() + `' WHERE id=$1`, "", organic},
		{"manual cannot become organic", `UPDATE process_participations SET source='organic' WHERE id=$1`, "23514", participation},
		{"unknown manual CV", `UPDATE process_participations SET company_candidate_cv_id='00000000-0000-0000-0000-000000000000' WHERE id=$1`, "23503", participation},
		{"CV requires company", `UPDATE company_candidate_cvs SET company_id=NULL WHERE id=$1`, "23502", manualCV},
		{"CV requires owner", `UPDATE company_candidate_cvs SET company_candidate_id='00000000-0000-0000-0000-000000000000' WHERE id=$1`, "23503", manualCV},
		{"duplicate storage key", `INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) SELECT gen_random_uuid(),company_id,company_candidate_id,storage_key,size,content_type,file_name FROM company_candidate_cvs WHERE id=$1`, "23505", manualCV},
		{"both identities", `UPDATE process_participations SET candidate_id='` + user.String() + `' WHERE id=$1`, "23514", participation},
		{"no identity", `UPDATE process_participations SET company_candidate_id=NULL WHERE id=$1`, "23514", participation},
		{"organic requires CV", `UPDATE process_participations SET cv_version_id=NULL WHERE id=$1`, "23514", organic},
		{"organic forbids recruiter", `UPDATE process_participations SET added_by='` + actor.String() + `' WHERE id=$1`, "23514", organic},
		{"manual requires CV", `UPDATE process_participations SET company_candidate_cv_id=NULL WHERE id=$1`, "23514", participation},
		{"manual requires recruiter", `UPDATE process_participations SET added_by=NULL WHERE id=$1`, "23514", participation},
		{"manual forbids library CV", `UPDATE process_participations SET cv_version_id='` + cv.String() + `' WHERE id=$1`, "23514", participation},
		{"unknown source", `UPDATE process_participations SET source='import' WHERE id=$1`, "23514", participation},
		{"duplicate participation", `INSERT INTO process_participations(id,process_id,stage_id,questions_snapshot,answers_snapshot,source,company_candidate_id,company_candidate_cv_id,added_by) SELECT gen_random_uuid(),process_id,stage_id,questions_snapshot,answers_snapshot,source,company_candidate_id,company_candidate_cv_id,added_by FROM process_participations WHERE id=$1`, "23505", participation},
		{"unknown company", `UPDATE company_candidates SET company_id='00000000-0000-0000-0000-000000000000' WHERE id=$1`, "23503", manual},
		{"unknown creator", `UPDATE company_candidates SET created_by='00000000-0000-0000-0000-000000000000' WHERE id=$1`, "23503", manual},
		{"unknown recruiter", `UPDATE process_participations SET added_by='00000000-0000-0000-0000-000000000000' WHERE id=$1`, "23503", participation},
		{"invalid education", `UPDATE company_candidates SET education_level='other' WHERE id=$1`, "23514", manual},
		{"experience below minimum", `UPDATE company_candidates SET experience_years=-1 WHERE id=$1`, "23514", manual},
		{"experience above maximum", `UPDATE company_candidates SET experience_years=61 WHERE id=$1`, "23514", manual},
		{"missing contact", `UPDATE company_candidates SET email=NULL,email_normalized=NULL WHERE id=$1`, "23514", manual},
		{"missing normalization", `UPDATE company_candidates SET email_normalized=NULL WHERE id=$1`, "23514", manual},
		{"wrong normalization", `UPDATE company_candidates SET email_normalized='Person@example.test' WHERE id=$1`, "23514", manual},
		{"international minimum", `UPDATE company_candidates SET phone='+12345678' WHERE id=$1`, "", manual},
		{"international maximum", `UPDATE company_candidates SET phone='+123456789012345' WHERE id=$1`, "", manual},
		{"international too short", `UPDATE company_candidates SET phone='+1234567' WHERE id=$1`, "23514", manual},
		{"international too long", `UPDATE company_candidates SET phone='+1234567890123456' WHERE id=$1`, "23514", manual},
		{"MX too long", `UPDATE company_candidates SET phone='+5255123456789' WHERE id=$1`, "23514", manual},
		{"invalid phone", `UPDATE company_candidates SET phone='+52551234567' WHERE id=$1`, "23514", manual},
		{"missing MX subdivisions", `UPDATE company_candidates SET country_code='MX' WHERE id=$1`, "23514", manual},
		{"international subdivisions", `UPDATE company_candidates SET state_code='14' WHERE id=$1`, "23514", manual},
		{"unknown country", `UPDATE company_candidates SET country_code='00' WHERE id=$1`, "23503", manual},
		{"zero CV size", `UPDATE company_candidate_cvs SET size=0 WHERE id=$1`, "23514", manualCV},
		{"CV above maximum", `UPDATE company_candidate_cvs SET size=5242881 WHERE id=$1`, "23514", manualCV},
		{"CV content type", `UPDATE company_candidate_cvs SET content_type='text/plain' WHERE id=$1`, "23514", manualCV},
		{"CV storage key", `UPDATE company_candidate_cvs SET storage_key='../file' WHERE id=$1`, "23514", manualCV},
		{"CEFR", `INSERT INTO company_candidate_languages VALUES($1,'en','native')`, "23514", manual},
		{"experience minimum", `UPDATE company_candidates SET experience_years=0 WHERE id=$1`, "", manual},
		{"experience maximum", `UPDATE company_candidates SET experience_years=60 WHERE id=$1`, "", manual},
		{"phone only", `UPDATE company_candidates SET email=NULL,email_normalized=NULL,phone='+525512345678' WHERE id=$1`, "", manual},
		{"CV maximum", `UPDATE company_candidate_cvs SET size=5242880 WHERE id=$1`, "", manualCV},
		{"DOCX", `UPDATE company_candidate_cvs SET content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document' WHERE id=$1`, "", manualCV},
		{"CEFR allowed", `INSERT INTO company_candidate_languages VALUES($1,'en','C2')`, "", manual},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			_, err = tx.Exec(ctx, tc.query, tc.id)
			if tc.code == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				var pgerr *pgconn.PgError
				if !errors.As(err, &pgerr) || pgerr.Code != tc.code {
					t.Fatalf("want SQLSTATE %s; got %v", tc.code, err)
				}
			}
		})
	}

	t.Run("MX geography and CV ownership", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		for _, q := range []string{
			`INSERT INTO geo_countries VALUES('MX','México','Mexico') ON CONFLICT DO NOTHING`,
			`INSERT INTO geo_states VALUES('MX','14','Jalisco','Jal.'),('MX','15','México','Mex.') ON CONFLICT DO NOTHING`,
			`INSERT INTO geo_municipalities VALUES('MX','14','14039','Guadalajara'),('MX','14','14040','Hostotipaquillo') ON CONFLICT DO NOTHING`,
			`INSERT INTO geo_postal_codes VALUES('MX','44100','14039') ON CONFLICT DO NOTHING`,
		} {
			if _, err := tx.Exec(ctx, q); err != nil {
				t.Fatal(err)
			}
		}
		for _, tc := range []struct {
			name, values, code string
		}{
			{"MX without postal", `'MX','14','14039',NULL`, ""},
			{"MX coherent postal", `'MX','14','14039','44100'`, ""},
			{"missing state", `'MX',NULL,'14039',NULL`, "23514"},
			{"missing municipality", `'MX','14',NULL,NULL`, "23514"},
			{"mismatched state", `'MX','15','14039',NULL`, "23514"},
			{"unknown state", `'MX','99','99001',NULL`, "23503"},
			{"unknown municipality", `'MX','14','14999',NULL`, "23503"},
			{"postal mismatch", `'MX','14','14040','44100'`, "23503"},
			{"postal format", `'MX','14','14039','4410'`, "23514"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				sp, err := tx.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer sp.Rollback(ctx)
				_, err = sp.Exec(ctx, `UPDATE company_candidates SET (country_code,state_code,municipality_code,postal_code)=(`+tc.values+`) WHERE id=$1`, manual)
				var pgerr *pgconn.PgError
				if tc.code == "" && err != nil || tc.code != "" && (!errors.As(err, &pgerr) || pgerr.Code != tc.code) {
					t.Fatalf("want SQLSTATE %q, got %v", tc.code, err)
				}
			})
		}
		other := uuid.New()
		if _, err := tx.Exec(ctx, `INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,education_level,country_code,created_by) SELECT $2,company_id,full_name,email,email_normalized,education_level,country_code,created_by FROM company_candidates WHERE id=$1`, manual, other); err != nil {
			t.Fatal("same contacts are allowed for confirmed distinct people", err)
		}
		_, err = tx.Exec(ctx, `UPDATE process_participations SET company_candidate_id=$2 WHERE id=$1`, participation, other)
		var pgerr *pgconn.PgError
		if !errors.As(err, &pgerr) || pgerr.Code != "23503" {
			t.Fatal("CV ownership mismatch allowed", err)
		}
	})

	assertGuard := func(version int64, message string) {
		t.Helper()
		if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), message) {
			t.Fatal("Down did not refuse", err)
		}
		if got, err := goose.GetDBVersion(db); err != nil || got != version {
			t.Fatal("guard changed schema version", got, err)
		}
	}
	assertGuard(38, "manual participation data exists")
	var retained int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM participation_stage_history WHERE id=$1`, manualHistory).Scan(&retained); err != nil || retained != 1 {
		t.Fatal("refused Down lost manual history", err)
	}
	exec(`DELETE FROM participation_stage_history WHERE participation_id=$1`, participation)
	exec(`DELETE FROM process_participations WHERE id=$1`, participation)
	exec(`DELETE FROM process_participations WHERE id=$1`, reuse)
	gooseDownTo(t, db, 37)
	assertGuard(37, "manual CV data exists")
	exec(`DELETE FROM company_candidate_cvs WHERE id=$1 OR id=$2`, manualCV, reuseCV)
	gooseDownTo(t, db, 36)
	assertGuard(36, "manual candidate data exists")
	exec(`DELETE FROM company_candidates WHERE id=$1`, manual)
	gooseDownTo(t, db, 35)
	if columnExists(t, pool, "process_participations", "company_candidate_id") || columnExists(t, pool, "company_candidates", "id") || columnExists(t, pool, "company_candidate_cvs", "id") {
		t.Fatal("Down retained manual schema")
	}
	if err := pool.QueryRow(ctx, `SELECT to_jsonb(p)::text FROM process_participations p WHERE id=$1`, organic).Scan(&after); err != nil || before != after {
		t.Fatal("Down changed organic row", err)
	}
}
