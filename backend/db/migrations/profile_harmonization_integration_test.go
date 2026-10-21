//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"
)

func TestProfileHarmonizationBackfillChecksAndGuardedDown(t *testing.T) {
	if testing.Short() {
		t.Skip("migration database test")
	}
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 38)
	user := uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Migration Test','candidate')`, user, uuid.NewString(), uuid.NewString()+"@example.test")
	defer func() {
		// Restore a legacy-compatible fixture even if a guard assertion fails.
		_, _ = pool.Exec(ctx, `DELETE FROM candidate_educations WHERE user_id=$1`, user)
		_, _ = pool.Exec(ctx, `DELETE FROM candidate_languages WHERE user_id=$1`, user)
		_, _ = pool.Exec(ctx, `DELETE FROM candidate_profiles WHERE user_id=$1`, user)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, user)
		gooseUpAll(t, db)
	}()
	exec(`INSERT INTO candidate_profiles(user_id,years_of_experience,education_level,field_of_study) VALUES($1,7,'bachelor','Computación')`, user)
	exec(`INSERT INTO candidate_languages(user_id,language,level) VALUES($1,'Español','B1'),($1,'Spanish','C1'),($1,'INGLÉS','B2'),($1,'FrEnCh','A2'),($1,'ALEMAN','C2'),($1,'Unknown language','A1')`, user)
	var before string
	if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(l) ORDER BY language)::text FROM candidate_languages l WHERE user_id=$1`, user).Scan(&before); err != nil {
		t.Fatal(err)
	}
	cfg := pool.Config().ConnConfig.Copy()
	var notices []string
	cfg.OnNotice = func(_ *pgconn.PgConn, n *pgconn.Notice) { notices = append(notices, n.Message) }
	noticeDB := stdlib.OpenDB(*cfg)
	defer noticeDB.Close()
	gooseUpTo(t, noticeDB, 39)
	joined := strings.Join(notices, "\n")
	for _, want := range []string{"1 unmatched language rows deleted", "1 collapsed duplicate language rows"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing notice %q in %s", want, joined)
		}
	}
	var years, level, field, status string
	if err := pool.QueryRow(ctx, `SELECT p.years_of_experience::text,e.level,e.field,e.status FROM candidate_profiles p JOIN candidate_educations e USING(user_id) WHERE p.user_id=$1`, user).Scan(&years, &level, &field, &status); err != nil {
		t.Fatal(err)
	}
	if years != "7.0" || level != "bachelor" || field != "Computación" || status != "completed" {
		t.Fatalf("backfill: %s %s %s %s", years, level, field, status)
	}
	var languages string
	if err := pool.QueryRow(ctx, `SELECT string_agg(code||':'||level,',' ORDER BY code) FROM candidate_languages WHERE user_id=$1`, user).Scan(&languages); err != nil {
		t.Fatal(err)
	}
	if languages != "de:C2,en:B2,es:C1,fr:A2" {
		t.Fatal(languages)
	}
	for _, tc := range []struct{ name, sql string }{
		{"negative years", `UPDATE candidate_profiles SET years_of_experience=-0.1 WHERE user_id=$1`},
		{"too many years", `UPDATE candidate_profiles SET years_of_experience=60.1 WHERE user_id=$1`},
		{"seniority", `UPDATE candidate_profiles SET seniority='mid' WHERE user_id=$1`},
		{"level", `UPDATE candidate_educations SET level='other' WHERE user_id=$1`},
		{"status", `UPDATE candidate_educations SET status='finished' WHERE user_id=$1`},
		{"empty institution", `UPDATE candidate_educations SET institution='' WHERE user_id=$1`},
		{"long field", `UPDATE candidate_educations SET field=repeat('á',121) WHERE user_id=$1`},
		{"early year", `UPDATE candidate_educations SET start_year=1949 WHERE user_id=$1`},
		{"late year", `UPDATE candidate_educations SET end_year=2101 WHERE user_id=$1`},
		{"reversed dates", `UPDATE candidate_educations SET start_year=2020,end_year=2019 WHERE user_id=$1`},
		{"ongoing end", `UPDATE candidate_educations SET status='in_progress',end_year=2020 WHERE user_id=$1`},
		{"language level", `UPDATE candidate_languages SET level='B3' WHERE user_id=$1`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pool.Exec(ctx, tc.sql, user)
			if err == nil {
				t.Fatal("expected CHECK violation")
			}
		})
	}
	for _, tc := range []struct{ name, set, reset string }{
		{"fraction", `UPDATE candidate_profiles SET years_of_experience=7.5 WHERE user_id=$1`, `UPDATE candidate_profiles SET years_of_experience=7 WHERE user_id=$1`},
		{"seniority", `UPDATE candidate_profiles SET seniority='junior' WHERE user_id=$1`, `UPDATE candidate_profiles SET seniority=NULL WHERE user_id=$1`},
		{"native", `UPDATE candidate_languages SET level='native' WHERE user_id=$1 AND code='es'`, `UPDATE candidate_languages SET level='C1' WHERE user_id=$1 AND code='es'`},
		{"new level", `UPDATE candidate_educations SET level='tsu' WHERE user_id=$1`, `UPDATE candidate_educations SET level='bachelor' WHERE user_id=$1`},
		{"in progress", `UPDATE candidate_educations SET status='in_progress' WHERE user_id=$1`, `UPDATE candidate_educations SET status='completed' WHERE user_id=$1`},
		{"institution", `UPDATE candidate_educations SET institution='UNAM' WHERE user_id=$1`, `UPDATE candidate_educations SET institution=NULL WHERE user_id=$1`},
		{"dates", `UPDATE candidate_educations SET start_year=2000 WHERE user_id=$1`, `UPDATE candidate_educations SET start_year=NULL WHERE user_id=$1`},
		{"multiple", `INSERT INTO candidate_educations(user_id,position,level,status) VALUES($1,1,'master','completed')`, `DELETE FROM candidate_educations WHERE user_id=$1 AND position=1`},
	} {
		t.Run("guard "+tc.name, func(t *testing.T) {
			exec(tc.set, user)
			if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "cannot round-trip") {
				t.Fatalf("guard: %v", err)
			}
			exec(tc.reset, user)
		})
	}
	gooseDownTo(t, db, 38)
	var after string
	if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(l) ORDER BY language)::text FROM candidate_languages l WHERE user_id=$1`, user).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("languages changed on clean Down: %s -> %s", before, after)
	}
	var oldYears int
	if err := pool.QueryRow(ctx, `SELECT years_of_experience,education_level,field_of_study FROM candidate_profiles WHERE user_id=$1`, user).Scan(&oldYears, &level, &field); err != nil {
		t.Fatal(err)
	}
	if oldYears != 7 || level != "bachelor" || field != "Computación" {
		t.Fatal("profile changed on Down")
	}
}
