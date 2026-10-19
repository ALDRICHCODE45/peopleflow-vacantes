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

func TestMigration00025BackfillDownAndUndecodableSource(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 24)
	recruiter, company, id := uuid.New(), uuid.New(), uuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	// No schema downgrade can remove source/private state; fixture cleanup restores
	// the latest version before the next test uses this dedicated database.
	defer func() {
		exec(`DELETE FROM vacancy_public_projections WHERE id=$1`, id)
		exec(`DELETE FROM vacancy_processes WHERE id=$1`, id)
		exec(`DELETE FROM job_drafts WHERE id=$1`, id)
		exec(`DELETE FROM companies WHERE id=$1`, company)
		exec(`DELETE FROM users WHERE id=$1`, recruiter)
		gooseUpAll(t, db)
	}()
	draft, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"skills":["SQL","Go","e\u0301","界"],"screening_questions":[{"id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","type":"open","prompt":"Why?"},{"id":"2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e","type":"open","prompt":"When?"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	canonical := draft.Fingerprint()
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Recruiter','recruiter')`, recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, id, company, recruiter, canonical)
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, company, recruiter)
	exec(`INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,location,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version) VALUES($1,$2,'Offer','Public description','México','remote','full_time','indefinite','technology_systems','{"predefined":[],"custom":[]}',now(),1)`, id, company)
	snapshot := func() string {
		t.Helper()
		var out string
		if err := pool.QueryRow(ctx, `SELECT jsonb_build_array((SELECT to_jsonb(p)-'skills'-'screening_questions' FROM vacancy_public_projections p WHERE id=$1),(SELECT to_jsonb(d) FROM job_drafts d WHERE id=$1),(SELECT to_jsonb(v) FROM vacancy_processes v WHERE id=$1))::text`, id).Scan(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := snapshot()
	gooseUpTo(t, db, 25)
	// Pin the backfill/down assertions to this migration, not a later schema.
	gooseDownTo(t, db, 25)
	var skills []string
	var count int
	if err := pool.QueryRow(ctx, `SELECT skills,screening_questions FROM vacancy_public_projections WHERE id=$1`, id).Scan(&skills, &count); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(skills, []string{"SQL", "Go", "e\u0301", "界"}) || count != 2 || snapshot() != before {
		t.Fatal("backfill lost ordering/count or changed original state", skills, count)
	}
	gooseDownTo(t, db, 24)
	if columnExists(t, pool, "vacancy_public_projections", "skills") || columnExists(t, pool, "vacancy_public_projections", "screening_questions") || snapshot() != before {
		t.Fatal("down changed original projection or source state")
	}
	var decoded map[string]any
	if err := json.Unmarshal(canonical, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		raw  []byte
	}{
		{"malformed", []byte(`not JSON`)}, {"invalid utf8", []byte{0xff}}, {"missing", []byte(`{"schema_version":2,"fields":{}}`)},
		{"wrong version", []byte(strings.Replace(string(canonical), `"schema_version":2`, `"schema_version":1`, 1))},
		{"null skills", []byte(`{"schema_version":2,"fields":{"skills":null,"screening_questions":[]}}`)},
		{"wrong skill type", []byte(`{"schema_version":2,"fields":{"skills":[42],"screening_questions":[]}}`)},
		{"null questionnaire", []byte(`{"schema_version":2,"fields":{"skills":[],"screening_questions":null}}`)},
		{"wrong question type", []byte(`{"schema_version":2,"fields":{"skills":[],"screening_questions":["question"]}}`)},
		{"duplicate keys", []byte(`{"schema_version":2,"fields":{"skills":["first"],"skills":["last"],"screening_questions":[]}}`)},
		{"lone surrogate", []byte(`{"schema_version":2,"fields":{"skills":["\ud800"],"screening_questions":[]}}`)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exec(`UPDATE job_drafts SET fields=$2 WHERE id=$1`, id, tc.raw)
			state := snapshot()
			if err := goose.Up(db, "."); err == nil || !strings.Contains(err.Error(), "00025 cannot decode projection source") {
				t.Fatal("corrupt source was guessed rather than rejected", err)
			}
			version, err := goose.GetDBVersion(db)
			if err != nil || version != 24 || snapshot() != state || columnExists(t, pool, "vacancy_public_projections", "skills") {
				t.Fatal("failed migration changed schema/data/version", version, err)
			}
		})
	}
	empty, err := draftinput.DecodeCreateV2([]byte(`{"fields":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE job_drafts SET fields=$2 WHERE id=$1`, id, empty.Fingerprint())
	gooseUpAll(t, db)
	if err := pool.QueryRow(ctx, `SELECT skills,screening_questions FROM vacancy_public_projections WHERE id=$1`, id).Scan(&skills, &count); err != nil {
		t.Fatal(err)
	}
	if skills == nil || len(skills) != 0 || count != 0 {
		t.Fatal("empty collections were not backfilled as empty/zero")
	}
}
