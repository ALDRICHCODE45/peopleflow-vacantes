//go:build integration

// Migration 00061 (`participation_snapshot_professional_title`): the profile
// snapshot constraint accepts an optional professional_title (absent, null or a
// string of at most 120 characters) without rewriting stored rows; down refuses
// while any row carries the key and otherwise restores the exact 00043 check.
package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

const snapshot00061Base = `"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]`

func TestMigration00061OptionalProfessionalTitleAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	defer gooseUpAll(t, db)
	ctx := context.Background()
	constraint := func() string {
		t.Helper()
		var def string
		if err := pool.QueryRow(ctx, `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='participation_profile_snapshot_shape'`).Scan(&def); err != nil {
			t.Fatal(err)
		}
		return def
	}
	current := constraint()
	gooseDownTo(t, db, 60)
	before := constraint()
	if before == current {
		t.Fatal("00061 did not change the constraint")
	}
	_, company, actor := seedPrereqs(ctx, t, pool)
	process := uuid.New()
	exec := func(q string, args ...any) error {
		_, err := pool.Exec(ctx, q, args...)
		return err
	}
	must := func(q string, args ...any) {
		t.Helper()
		if err := exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, process, company, actor)
	must(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, process, company, actor)
	users, cvs := []uuid.UUID{}, []uuid.UUID{}
	defer func() {
		must(`DELETE FROM process_participations WHERE process_id=$1`, process)
		for i, user := range users {
			must(`DELETE FROM candidate_cv_versions WHERE id=$1`, cvs[i])
			must(`DELETE FROM users WHERE id=$1`, user)
		}
		must(`DELETE FROM vacancy_processes WHERE id=$1`, process)
		must(`DELETE FROM job_drafts WHERE id=$1`, process)
	}()
	insert := func(snapshot string) (uuid.UUID, error) {
		t.Helper()
		id, user, cv := uuid.New(), uuid.New(), uuid.New()
		users, cvs = append(users, user), append(cvs, cv)
		must(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Snapshot candidate','candidate')`, user, uuid.NewString(), uuid.NewString()+"@example.test")
		must(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, user, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
		return id, exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,profile_snapshot) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6::jsonb)`, id, process, user, uuid.New(), cv, snapshot)
	}
	legacy, err := insert(`{` + snapshot00061Base + `}`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = insert(`{` + snapshot00061Base + `,"professional_title":null}`); err == nil {
		t.Fatal("00043 accepted the title key")
	}
	var raw string
	if err = pool.QueryRow(ctx, `SELECT profile_snapshot::text FROM process_participations WHERE id=$1`, legacy).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	gooseUpTo(t, db, 61)
	var after string
	if err = pool.QueryRow(ctx, `SELECT profile_snapshot::text FROM process_participations WHERE id=$1`, legacy).Scan(&after); err != nil || after != raw {
		t.Fatal("up rewrote a stored snapshot", err, after)
	}
	for _, tc := range []struct {
		name, title string
		ok          bool
	}{
		{"null", `,"professional_title":null`, true},
		{"string", `,"professional_title":"Backend Engineer"`, true},
		{"120 characters", `,"professional_title":"` + strings.Repeat("á", 120) + `"`, true},
		{"121 characters", `,"professional_title":"` + strings.Repeat("á", 121) + `"`, false},
		{"number", `,"professional_title":7`, false},
		{"object", `,"professional_title":{"text":"x"}`, false},
		{"unknown key", `,"current_company":"Acme"`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := insert(`{` + snapshot00061Base + tc.title + `}`); (err == nil) != tc.ok {
				t.Fatalf("accepted=%v want %v: %v", err == nil, tc.ok, err)
			}
		})
	}
	if err = goose.DownTo(db, ".", 60); err == nil || !strings.Contains(err.Error(), "00061 Down refuses") {
		t.Fatalf("down guard: %v", err)
	}
	if got := constraint(); got != current {
		t.Fatal("refused down changed the constraint")
	}
	must(`DELETE FROM process_participations WHERE process_id=$1 AND profile_snapshot ? 'professional_title'`, process)
	gooseDownTo(t, db, 60)
	if got := constraint(); got != before {
		t.Fatalf("00043 constraint not exactly restored:\n%s\n%s", got, before)
	}
}
