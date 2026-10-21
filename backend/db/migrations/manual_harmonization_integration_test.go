//go:build integration

package migrations_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func TestManualHarmonizationBackfillChecksAndGuardedDown(t *testing.T) {
	if testing.Short() {
		t.Skip("migration database test")
	}
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 39)
	actor, company, candidate := uuid.New(), uuid.New(), uuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Migration Recruiter','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Migration Company',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO geo_countries VALUES('XZ','Test','Test') ON CONFLICT DO NOTHING`)
	exec(`INSERT INTO company_candidates(id,company_id,created_by,full_name,email,email_normalized,country_code,education_level,field_of_study,experience_years) VALUES($1,$2,$3,'Manual Candidate','manual@example.test','manual@example.test','XZ','bachelor','Computación',7)`, candidate, company, actor)
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM company_candidate_languages WHERE company_candidate_id=$1`, candidate)
		_, _ = pool.Exec(ctx, `DELETE FROM company_candidates WHERE id=$1`, candidate)
		_, _ = pool.Exec(ctx, `DELETE FROM companies WHERE id=$1`, company)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, actor)
		gooseUpAll(t, db)
	}()
	exec(`INSERT INTO company_candidate_languages VALUES($1,'Español','B1'),($1,'Spanish','C1'),($1,'INGLÉS','B2'),($1,'FrEnCh','A2'),($1,'ALEMAN','C2'),($1,'Unknown language','A1')`, candidate)
	var before string
	if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(l) ORDER BY language)::text FROM company_candidate_languages l WHERE company_candidate_id=$1`, candidate).Scan(&before); err != nil {
		t.Fatal(err)
	}
	cfg := pool.Config().ConnConfig.Copy()
	var notices []string
	cfg.OnNotice = func(_ *pgconn.PgConn, n *pgconn.Notice) { notices = append(notices, n.Message) }
	noticeDB := stdlib.OpenDB(*cfg)
	defer noticeDB.Close()
	gooseUpTo(t, noticeDB, 40)
	for _, want := range []string{"1 unmatched language rows deleted", "1 collapsed duplicate language rows"} {
		if !strings.Contains(strings.Join(notices, "\n"), want) {
			t.Errorf("missing notice %q: %v", want, notices)
		}
	}
	var years, level, field, status, codes string
	if err := pool.QueryRow(ctx, `SELECT c.years_of_experience::text,e.level,e.field,e.status FROM company_candidates c JOIN company_candidate_educations e ON e.company_candidate_id=c.id WHERE c.id=$1`, candidate).Scan(&years, &level, &field, &status); err != nil {
		t.Fatal(err)
	}
	if years != "7.0" || level != "bachelor" || field != "Computación" || status != "completed" {
		t.Fatal(years, level, field, status)
	}
	if err := pool.QueryRow(ctx, `SELECT string_agg(code||':'||level,',' ORDER BY code) FROM company_candidate_languages WHERE company_candidate_id=$1`, candidate).Scan(&codes); err != nil {
		t.Fatal(err)
	}
	if codes != "de:C2,en:B2,es:C1,fr:A2" {
		t.Fatal(codes)
	}
	for _, tc := range []struct{ name, sql string }{
		{"negative years", `UPDATE company_candidates SET years_of_experience=-0.1 WHERE id=$1`},
		{"excess years", `UPDATE company_candidates SET years_of_experience=60.1 WHERE id=$1`},
		{"seniority", `UPDATE company_candidates SET seniority='mid' WHERE id=$1`},
		{"level", `UPDATE company_candidate_educations SET level='other' WHERE company_candidate_id=$1`},
		{"status", `UPDATE company_candidate_educations SET status='finished' WHERE company_candidate_id=$1`},
		{"empty institution", `UPDATE company_candidate_educations SET institution='' WHERE company_candidate_id=$1`},
		{"long field", `UPDATE company_candidate_educations SET field=repeat('á',121) WHERE company_candidate_id=$1`},
		{"early year", `UPDATE company_candidate_educations SET start_year=1949 WHERE company_candidate_id=$1`},
		{"late year", `UPDATE company_candidate_educations SET end_year=2101 WHERE company_candidate_id=$1`},
		{"reversed years", `UPDATE company_candidate_educations SET start_year=2020,end_year=2019 WHERE company_candidate_id=$1`},
		{"ongoing end", `UPDATE company_candidate_educations SET status='in_progress',end_year=2020 WHERE company_candidate_id=$1`},
		{"language", `UPDATE company_candidate_languages SET level='B3' WHERE company_candidate_id=$1`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pool.Exec(ctx, tc.sql, candidate)
			var pgerr *pgconn.PgError
			if !errors.As(err, &pgerr) || pgerr.Code != "23514" {
				t.Fatalf("want CHECK violation, got %v", err)
			}
		})
	}
	for _, tc := range []struct{ name, set, reset string }{
		{"fraction", `UPDATE company_candidates SET years_of_experience=7.5 WHERE id=$1`, `UPDATE company_candidates SET years_of_experience=7 WHERE id=$1`},
		{"seniority", `UPDATE company_candidates SET seniority='junior' WHERE id=$1`, `UPDATE company_candidates SET seniority=NULL WHERE id=$1`},
		{"native", `UPDATE company_candidate_languages SET level='native' WHERE company_candidate_id=$1 AND code='es'`, `UPDATE company_candidate_languages SET level='C1' WHERE company_candidate_id=$1 AND code='es'`},
		{"new level", `UPDATE company_candidate_educations SET level='tsu' WHERE company_candidate_id=$1`, `UPDATE company_candidate_educations SET level='bachelor' WHERE company_candidate_id=$1`},
		{"status", `UPDATE company_candidate_educations SET status='in_progress' WHERE company_candidate_id=$1`, `UPDATE company_candidate_educations SET status='completed' WHERE company_candidate_id=$1`},
		{"institution", `UPDATE company_candidate_educations SET institution='UNAM' WHERE company_candidate_id=$1`, `UPDATE company_candidate_educations SET institution=NULL WHERE company_candidate_id=$1`},
		{"dates", `UPDATE company_candidate_educations SET start_year=2000 WHERE company_candidate_id=$1`, `UPDATE company_candidate_educations SET start_year=NULL WHERE company_candidate_id=$1`},
		{"multiple", `INSERT INTO company_candidate_educations(company_candidate_id,position,level,status) VALUES($1,1,'master','completed')`, `DELETE FROM company_candidate_educations WHERE company_candidate_id=$1 AND position=1`},
		{"missing education", `DELETE FROM company_candidate_educations WHERE company_candidate_id=$1`, `INSERT INTO company_candidate_educations(company_candidate_id,position,level,field,status) VALUES($1,0,'bachelor','Computación','completed')`},
	} {
		t.Run("guard "+tc.name, func(t *testing.T) {
			exec(tc.set, candidate)
			if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "cannot round-trip") {
				t.Fatalf("guard: %v", err)
			}
			if version, err := goose.GetDBVersion(db); err != nil || version != 40 {
				t.Fatal(version, err)
			}
			exec(tc.reset, candidate)
		})
	}
	gooseDownTo(t, db, 39)
	var after string
	if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(l) ORDER BY language)::text FROM company_candidate_languages l WHERE company_candidate_id=$1`, candidate).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("clean Down lost original languages: %s -> %s", before, after)
	}
	var oldYears int
	if err := pool.QueryRow(ctx, `SELECT experience_years,education_level,field_of_study FROM company_candidates WHERE id=$1`, candidate).Scan(&oldYears, &level, &field); err != nil {
		t.Fatal(err)
	}
	if oldYears != 7 || level != "bachelor" || field != "Computación" {
		t.Fatal(oldYears, level, field)
	}
}
