//go:build integration

package migrations_test

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00043SnapshotRewriteChecksAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 42)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	process := uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	insertDraftAt(t, pool, company, actor, process, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, process, company, actor)
	ids, users, cvs := []uuid.UUID{}, []uuid.UUID{}, []uuid.UUID{}
	defer func() {
		exec(`DELETE FROM process_participations WHERE process_id=$1`, process)
		for i, user := range users {
			exec(`DELETE FROM candidate_cv_versions WHERE id=$1`, cvs[i])
			exec(`DELETE FROM users WHERE id=$1`, user)
		}
		exec(`DELETE FROM vacancy_processes WHERE id=$1`, process)
		exec(`DELETE FROM job_drafts WHERE id=$1`, process)
		gooseUpAll(t, db)
	}()
	legacy := []string{
		`{"location":null,"skills":[],"years_of_experience":null,"education_level":null}`,
		`{"location":{"country":"MX","state":"14","municipality":"14039"},"skills":["Go","literal \\u0000","line\u2028separator"],"years_of_experience":3,"education_level":"bachelor"}`,
		`{"location":null,"skills":[],"years_of_experience":3.00,"education_level":"master"}`,
		`{"location":null,"skills":[],"years_of_experience":100,"education_level":"high_school"}`,
		`{"location":null,"skills":[],"years_of_experience":0,"education_level":"phd"}`,
	}
	for i := 0; i <= len(legacy); i++ {
		id, user, cv := uuid.New(), uuid.New(), uuid.New()
		ids, users, cvs = append(ids, id), append(users, user), append(cvs, cv)
		exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Snapshot candidate','candidate')`, user, uuid.NewString(), uuid.NewString()+"@example.test")
		exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, user, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
		var profile any
		if i < len(legacy) {
			profile = legacy[i]
		}
		exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,profile_snapshot) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6::jsonb)`, id, process, user, uuid.New(), cv, profile)
	}
	unrelated := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(p)-'profile_snapshot' ORDER BY id)::text FROM process_participations p WHERE process_id=$1`, process).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	read := func(id uuid.UUID) any {
		t.Helper()
		var raw []byte
		if err := pool.QueryRow(ctx, `SELECT profile_snapshot FROM process_participations WHERE id=$1`, id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		if raw == nil {
			return nil
		}
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	before := unrelated()
	gooseUpTo(t, db, 43)
	for i, raw := range legacy {
		var old map[string]any
		if err := json.Unmarshal([]byte(raw), &old); err != nil {
			t.Fatal(err)
		}
		years := []any{nil, "3", "3", "100", "0"}[i]
		want := map[string]any{"location": old["location"], "skills": old["skills"], "years_of_experience": years, "seniority": nil, "education": map[string]any{"highest_completed": old["education_level"], "in_progress": nil}, "languages": []any{}}
		if got := read(ids[i]); !reflect.DeepEqual(got, want) {
			t.Fatalf("rewrite %d: got %#v want %#v", i, got, want)
		}
	}
	if read(ids[len(legacy)]) != nil || unrelated() != before {
		t.Fatal("Up changed null or unrelated fields")
	}
	base := `{"location":null,"skills":[],"years_of_experience":"3","seniority":null,"education":{"highest_completed":"bachelor","in_progress":null},"languages":[]}`
	for _, bad := range []string{
		`null`, `{}`, `[]`, legacy[0],
		strings.Replace(base, `"3"`, `3`, 1),
		strings.Replace(base, `"3"`, `"1.55"`, 1),
		strings.Replace(base, `"3"`, `"-1"`, 1),
		strings.Replace(base, `"seniority":null`, `"seniority":"mid"`, 1),
		strings.Replace(base, `"in_progress":null`, `"in_progress":true`, 1),
		strings.Replace(base, `"in_progress":null`, `"in_progress":false`, 1),
		strings.Replace(base, `"in_progress":null`, `"in_progress":"other"`, 1),
		strings.Replace(base, `,"in_progress":null`, ``, 1),
		strings.Replace(base, `"highest_completed":"bachelor",`, ``, 1),
		strings.Replace(base, `"in_progress":null`, `"in_progress":null,"extra":true`, 1),
		strings.Replace(base, `"3"`, `"01"`, 1),
		strings.Replace(base, `"3"`, `"1.0x"`, 1),
		strings.Replace(base, `"highest_completed":"bachelor"`, `"highest_completed":"other"`, 1),
		strings.Replace(base, `"languages":[]`, `"languages":[{"code":"en","level":"basic"}]`, 1),
		strings.Replace(base, `"languages":[]`, `"languages":[{"code":"en","level":"B2","extra":true}]`, 1),
		strings.Replace(base, `"languages":[]`, `"languages":[{"code":"en"}]`, 1),
		strings.Replace(base, `"languages":[]`, `"languages":[{"level":"B2"}]`, 1),
		strings.Replace(base, `"languages":[]`, `"languages":[{"code":"EN","level":"B2"}]`, 1),
		strings.Replace(base, `"languages":[]`, `"languages":[{"code":"en","level":null}]`, 1),
		strings.Replace(base, `"languages":[]`, `"languages":[{"code":"en","level":"B2"},{"code":"es"}]`, 1),
		strings.Replace(base, `"skills":[]`, `"skills":[["nested"]]`, 1),
		// Actual escaped NUL cannot be stored in JSONB; literal backslash-u0000
		// above is legitimate and must survive both directions unchanged.
		strings.Replace(base, `"skills":[]`, `"skills":["\u0000"]`, 1),
	} {
		if _, err := pool.Exec(ctx, `UPDATE process_participations SET profile_snapshot=$2::jsonb WHERE id=$1`, ids[0], bad); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
	for _, changed := range []string{
		strings.Replace(base, `"3"`, `"1.5"`, 1),
		strings.Replace(base, `"seniority":null`, `"seniority":"junior"`, 1),
		strings.Replace(base, `"in_progress":null`, `"in_progress":"master"`, 1),
		strings.Replace(base, `"bachelor"`, `"tsu"`, 1),
		strings.Replace(base, `"bachelor"`, `"secondary"`, 1),
		strings.Replace(base, `"bachelor"`, `"technical"`, 1),
		strings.Replace(base, `"bachelor"`, `"specialty"`, 1),
		strings.Replace(base, `"languages":[]`, `"languages":[{"code":"en","level":"native"}]`, 1),
	} {
		exec(`UPDATE process_participations SET profile_snapshot=$2::jsonb WHERE id=$1`, ids[0], changed)
		frozen := read(ids[0])
		if err := goose.DownTo(db, ".", 42); err == nil || !strings.Contains(err.Error(), "00043 Down refuses") {
			t.Fatal("unsafe Down", err)
		}
		version, err := goose.GetDBVersion(db)
		if err != nil || version != 43 || !reflect.DeepEqual(read(ids[0]), frozen) || unrelated() != before {
			t.Fatal("failed Down was not atomic", err)
		}
	}
	// Restore the null-valued source row before round-tripping every historical shape.
	exec(`UPDATE process_participations SET profile_snapshot=$2::jsonb WHERE id=$1`, ids[0], `{"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]}`)
	gooseDownTo(t, db, 42)
	for i, raw := range legacy {
		var want any
		if err := json.Unmarshal([]byte(raw), &want); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(read(ids[i]), want) {
			t.Fatalf("Down did not preserve legacy row %d", i)
		}
	}
	if read(ids[len(legacy)]) != nil || unrelated() != before {
		t.Fatal("Down changed null or unrelated fields")
	}
	gooseUpTo(t, db, 43)
}

// A writer that commits a non-representable snapshot while Down is running must
// make Down refuse, never have its data silently rewritten (review R4-rollback-race).
func TestMigration00043DownLocksBeforeGuard(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	process, id, user, cv := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	insertDraftAt(t, pool, company, actor, process, []byte(`{}`))
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, process, company, actor)
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Race candidate','candidate')`, user, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, user, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
	representable := `{"location":null,"skills":[],"years_of_experience":"3","seniority":null,"education":{"highest_completed":"bachelor","in_progress":null},"languages":[]}`
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,profile_snapshot) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6::jsonb)`, id, process, user, uuid.New(), cv, representable)
	defer func() {
		gooseUpAll(t, db)
		exec(`DELETE FROM process_participations WHERE id=$1`, id)
		exec(`DELETE FROM candidate_cv_versions WHERE id=$1`, cv)
		exec(`DELETE FROM users WHERE id=$1`, user)
		exec(`DELETE FROM vacancy_processes WHERE id=$1`, process)
		exec(`DELETE FROM job_drafts WHERE id=$1`, process)
	}()

	writer, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback(ctx)
	if _, err = writer.Exec(ctx, `UPDATE process_participations SET profile_snapshot=jsonb_set(profile_snapshot,'{seniority}','"junior"') WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	down := make(chan error, 1)
	go func() { down <- goose.DownTo(db, ".", 42) }()
	// Wait until Down is blocked on the writer's lock, then commit the write.
	for i := 0; ; i++ {
		var waiting bool
		if err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if i == 200 {
			t.Fatal("Down never waited for the concurrent writer")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err = writer.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-down; err == nil || !strings.Contains(err.Error(), "00043 Down refuses") {
		t.Fatal("Down rewrote a concurrently committed snapshot", err)
	}
	var seniority string
	if err = pool.QueryRow(ctx, `SELECT profile_snapshot->>'seniority' FROM process_participations WHERE id=$1`, id).Scan(&seniority); err != nil || seniority != "junior" {
		t.Fatal("committed snapshot was lost", seniority, err)
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 43 {
		t.Fatal("refused Down changed the version", version, err)
	}
}
