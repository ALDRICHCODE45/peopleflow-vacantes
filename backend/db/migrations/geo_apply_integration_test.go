//go:build integration

package migrations_test

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestMigration00033SnapshotRewriteConstraintsAndDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 32)
	candidate, recruiter, company, vacancy, cv, pid, legacy, stage := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	legacyCV := uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, r := range []struct {
			q  string
			id uuid.UUID
		}{
			{`DELETE FROM process_participations WHERE process_id=$1`, vacancy},
			{`DELETE FROM vacancy_processes WHERE id=$1`, vacancy},
			{`DELETE FROM job_drafts WHERE id=$1`, vacancy},
			{`DELETE FROM companies WHERE id=$1`, company},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, cv},
			{`DELETE FROM candidate_cv_versions WHERE id=$1`, legacyCV},
			{`DELETE FROM users WHERE id=$1`, candidate}, {`DELETE FROM users WHERE id=$1`, legacy}, {`DELETE FROM users WHERE id=$1`, recruiter},
		} {
			if _, err := pool.Exec(ctx, r.q, r.id); err != nil {
				t.Error(err)
				return
			}
		}
		gooseUpAll(t, db)
	}()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Recruiter','recruiter'),($7,$8,$9,'Legacy','candidate')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test", legacy, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, vacancy, company, recruiter, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, vacancy, company, recruiter)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf'),($4,$5,$6,6,'application/pdf')`, cv, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""), legacyCV, legacy, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	old := `{"city":"Old city","skills":["Go","SQL","Go"],"years_of_experience":0,"education_level":"master"}`
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,profile_snapshot) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6)`, pid, vacancy, candidate, stage, cv, []byte(old))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, uuid.New(), vacancy, legacy, stage, legacyCV)
	read := func() map[string]any {
		t.Helper()
		var raw []byte
		if err := pool.QueryRow(ctx, `SELECT profile_snapshot FROM process_participations WHERE id=$1`, pid).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	var originalConstraint string
	if err := pool.QueryRow(ctx, `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='participation_profile_snapshot_shape'`).Scan(&originalConstraint); err != nil {
		t.Fatal(err)
	}
	gooseUpTo(t, db, 33)
	want := map[string]any{"location": nil, "skills": []any{"Go", "SQL", "Go"}, "years_of_experience": float64(0), "education_level": "master"}
	if !reflect.DeepEqual(read(), want) {
		t.Fatal("up lost data", read())
	}
	var isNull bool
	if err := pool.QueryRow(ctx, `SELECT profile_snapshot IS NULL FROM process_participations WHERE process_id=$1 AND candidate_id=$2`, vacancy, legacy).Scan(&isNull); err != nil || !isNull {
		t.Fatal("legacy null changed", err)
	}
	for _, tc := range []struct {
		name, location string
		valid          bool
	}{
		{"null", `null`, true},
		{"country", `{"country":"CO","state":null,"municipality":null}`, true},
		{"state", `{"country":"MX","state":"14","municipality":null}`, true},
		{"municipality", `{"country":"MX","state":"14","municipality":"14039"}`, true},
		{"missing", `{}`, false}, {"array", `[]`, false}, {"scalar", `"MX"`, false},
		{"country null", `{"country":null,"state":null,"municipality":null}`, false},
		{"country lowercase", `{"country":"mx","state":null,"municipality":null}`, false},
		{"country length", `{"country":"MEX","state":null,"municipality":null}`, false},
		{"country number", `{"country":12,"state":null,"municipality":null}`, false},
		{"missing state", `{"country":"MX","municipality":null}`, false},
		{"missing municipality", `{"country":"MX","state":null}`, false},
		{"extra postal", `{"country":"MX","state":"14","municipality":"14039","postal_code":null}`, false},
		{"state format", `{"country":"MX","state":"1","municipality":null}`, false},
		{"international state", `{"country":"CO","state":"14","municipality":null}`, false},
		{"state type", `{"country":"MX","state":["14"],"municipality":null}`, false},
		{"municipality format", `{"country":"MX","state":"14","municipality":"1403"}`, false},
		{"municipality parent", `{"country":"MX","state":null,"municipality":"14039"}`, false},
		{"municipality mismatch", `{"country":"MX","state":"09","municipality":"14039"}`, false},
		{"municipality type", `{"country":"MX","state":"14","municipality":14039}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			raw := `{"location":` + tc.location + `,"skills":[],"years_of_experience":null,"education_level":null}`
			_, err = tx.Exec(ctx, `UPDATE process_participations SET profile_snapshot=$2 WHERE id=$1`, pid, []byte(raw))
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, err)
			}
		})
	}
	for _, raw := range []string{
		`null`, `[]`, `{}`,
		`{"location":null,"skills":[],"years_of_experience":null}`, // missing root key
		`{"location":null,"skills":[],"years_of_experience":null,"education_level":null,"city":null}`,
		`{"location":null,"skills":[["Go"]],"years_of_experience":null,"education_level":null}`,
		`{"location":null,"skills":[[]],"years_of_experience":null,"education_level":null}`,
		`{"location":null,"skills":[1],"years_of_experience":null,"education_level":null}`,
		`{"location":null,"skills":null,"years_of_experience":null,"education_level":null}`,
		`{"location":null,"skills":[],"years_of_experience":-1,"education_level":null}`,
		`{"location":null,"skills":[],"years_of_experience":1.5,"education_level":null}`,
		`{"location":null,"skills":[],"years_of_experience":"1","education_level":null}`,
		`{"location":null,"skills":[],"years_of_experience":null,"education_level":"college"}`,
	} {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, `UPDATE process_participations SET profile_snapshot=$2 WHERE id=$1`, pid, []byte(raw))
		tx.Rollback(ctx)
		if err == nil {
			t.Fatal("invalid shape accepted", raw)
		}
	}
	exec(`UPDATE process_participations SET profile_snapshot=jsonb_set(profile_snapshot,'{location}','{"country":"MX","state":"14","municipality":"14039"}') WHERE id=$1`, pid)
	gooseDownTo(t, db, 32)
	delete(want, "location")
	want["city"] = nil
	if !reflect.DeepEqual(read(), want) {
		t.Fatal("down lost data", read())
	}
	var restored string
	if err := pool.QueryRow(ctx, `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='participation_profile_snapshot_shape'`).Scan(&restored); err != nil || restored != originalConstraint {
		t.Fatal("00029 constraint not exactly restored", err)
	}
	if err := pool.QueryRow(ctx, `SELECT profile_snapshot IS NULL FROM process_participations WHERE process_id=$1 AND candidate_id=$2`, vacancy, legacy).Scan(&isNull); err != nil || !isNull {
		t.Fatal("down changed SQL NULL", err)
	}
}
