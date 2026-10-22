//go:build integration

package migrations_test

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestMigration00042PublicRequirementsBackfillChecksAndDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 41)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	ids := []uuid.UUID{}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, id := range ids {
			exec(`DELETE FROM job_drafts WHERE id=$1`, id)
		}
		gooseUpAll(t, db)
	}()
	profiles := []string{
		`{"languages":[],"min_years_of_experience":null,"min_education_level":null,"accepts_in_progress_education":false}`,
		`{"languages":[{"code":"nah","min_level":"native"},{"code":"en","min_level":"B2"}],"min_years_of_experience":"1.5","min_education_level":"bachelor","accepts_in_progress_education":true}`,
	}
	canonical := [][]byte{}
	for _, profile := range profiles {
		var fields map[string]any
		if err := json.Unmarshal([]byte(profile), &fields); err != nil {
			t.Fatal(err)
		}
		// A valid canonical draft can contain escaped NUL and line separators outside requirements.
		fields["title"] = "Title\x00\u2028\u2029"
		body, err := json.Marshal(map[string]any{"fields": fields})
		if err != nil {
			t.Fatal(err)
		}
		draft, err := draftinput.DecodeCreateV2(body)
		if err != nil {
			t.Fatal(err)
		}
		id := uuid.New()
		ids = append(ids, id)
		canonical = append(canonical, draft.Fingerprint())
		insertDraftAt(t, pool, company, actor, id, draft.Fingerprint())
		exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, company, actor)
		// Schema 41 intentionally has no requirements_profile; 42 must derive it, not default it.
		exec(`INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version,skills,screening_questions) VALUES($1,$2,'Title','','remote','full_time','indefinite','technology_systems','{}',now(),1,'{}',0)`, id, company)
	}
	snapshot := func() string {
		t.Helper()
		var out string
		if err := pool.QueryRow(ctx, `SELECT jsonb_agg(jsonb_build_array(to_jsonb(p)-'requirements_profile',to_jsonb(d)) ORDER BY p.id)::text FROM vacancy_public_projections p JOIN job_drafts d USING(id) WHERE p.id=ANY($1)`, ids).Scan(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := snapshot()
	gooseUpTo(t, db, 42)
	for i, id := range ids {
		var raw []byte
		if err := pool.QueryRow(ctx, `SELECT requirements_profile FROM vacancy_public_projections WHERE id=$1`, id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var got, want any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(profiles[i]), &want); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got=%s want=%s", raw, profiles[i])
		}
	}
	if snapshot() != before {
		t.Fatal("backfill changed source or unrelated projection columns")
	}
	for _, bad := range []string{
		`null`, `[]`, `{}`, strings.Replace(profiles[0], `"languages":[]`, `"languages":null`, 1),
		strings.Replace(profiles[0], `"min_years_of_experience":null`, `"min_years_of_experience":"60.1"`, 1),
		strings.Replace(profiles[0], `"min_years_of_experience":null`, `"min_years_of_experience":1`, 1),
		strings.Replace(profiles[0], `"min_education_level":null`, `"min_education_level":"unknown"`, 1),
		strings.Replace(profiles[0], `false`, `null`, 1),
		strings.Replace(profiles[0], `[]`, `[{"code":"en","min_level":"basic"}]`, 1),
		strings.Replace(profiles[0], `[]`, `[{"code":"en","min_level":"B2","extra":true}]`, 1),
		strings.Replace(profiles[0], `[]`, `[{"code":"en","min_level":"B2"},{"code":"en","min_level":"C1"}]`, 1),
	} {
		if _, err := pool.Exec(ctx, `UPDATE vacancy_public_projections SET requirements_profile=$2::jsonb WHERE id=$1`, ids[0], bad); err == nil {
			t.Fatalf("accepted invalid profile %s", bad)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE vacancy_public_projections SET requirements_profile=NULL WHERE id=$1`, ids[0]); err == nil {
		t.Fatal("accepted SQL NULL")
	}
	gooseDownTo(t, db, 41)
	if columnExists(t, pool, "vacancy_public_projections", "requirements_profile") || snapshot() != before {
		t.Fatal("Down changed source or retained column")
	}
	var functionExists bool
	if err := pool.QueryRow(ctx, `SELECT to_regprocedure('public_requirements_profile_valid(jsonb)') IS NOT NULL`).Scan(&functionExists); err != nil || functionExists {
		t.Fatal("Down retained helper", err)
	}
	for _, bad := range [][]byte{
		[]byte(`not JSON`), {0xff}, []byte(`[]`),
		[]byte(strings.Replace(string(canonical[0]), `"languages":[]`, `"languages":[],"languages":[]`, 1)),
		[]byte(strings.Replace(string(canonical[0]), `"languages":[]`, `"languages":[{"code":"en","min_level":"invalid"}]`, 1)),
		[]byte(strings.Replace(string(canonical[0]), `"min_years_of_experience":null`, `"min_years_of_experience":"61"`, 1)),
	} {
		exec(`UPDATE job_drafts SET fields=$2 WHERE id=$1`, ids[0], bad)
		state := snapshot()
		if err := goose.UpTo(db, ".", 42); err == nil || !strings.Contains(err.Error(), "00042 cannot decode projection source") {
			t.Fatal("invalid source not rejected safely", err)
		}
		version, err := goose.GetDBVersion(db)
		if err != nil || version != 41 || snapshot() != state || columnExists(t, pool, "vacancy_public_projections", "requirements_profile") {
			t.Fatal("failed Up was not atomic", err)
		}
	}
	exec(`UPDATE job_drafts SET fields=$2 WHERE id=$1`, ids[0], canonical[0])
	gooseUpTo(t, db, 42)
}
