//go:build integration

package migrations_test

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// Earlier migration suites use partial historical envelopes intentionally. Run
// the real 00041 rewrite on their shapes before adding post-41 partial fixtures;
// 00042 must migrate the entire populated database, not just current API drafts.
func TestMigration00042PublicRequirementsHistoricalFixtureDatabase(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 40)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	ids := []uuid.UUID{}
	wants := []string{}
	empty := `{"languages":[],"min_years_of_experience":null,"min_education_level":null,"accepts_in_progress_education":false}`
	mapped := `{"languages":[{"code":"en","min_level":"C1"}],"min_years_of_experience":null,"min_education_level":null,"accepts_in_progress_education":false}`
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
	seed := func(raw, want string) {
		t.Helper()
		id := uuid.New()
		ids = append(ids, id)
		wants = append(wants, want)
		insertDraftAt(t, pool, company, actor, id, []byte(raw))
		exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, company, actor)
		// At versions 40/41 this column does not yet exist.
		exec(`INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version,skills,screening_questions) VALUES($1,$2,'Historical','','remote','full_time','indefinite','technology_systems','{}',now(),1,'{}',0)`, id, company)
	}
	// Bare object and schema markers deliberately preserved by 00031/00041.
	for _, raw := range []string{`{}`, `{"schema_version":1}`, `{"schema_version":2}`, `{"schema_version":2,"fields":{}}`, `{"fields":{"title":"partial"}}`, `{"schema_version":1,"fields":null}`} {
		seed(raw, empty)
	}
	// 00025's skills/questions-only envelope and 00031's partial location shapes.
	seed(`{"schema_version":2,"fields":{"skills":["SQL","Go"],"screening_questions":[]}}`, empty)
	seed(`{"schema_version":2,"fields":{"location":"México","work_mode":"remote","title":"\u0000 ~geo_nul_0! \\u0000 \u2028\u2029"}}`, empty)
	// Same schema-1/2 and canonical-string matrix as the 00041 historical test.
	for _, schema := range []int64{1, 2} {
		for _, title := range vacancyCanonicalTitles {
			root, _ := vacancyDocument(t, "mid", []any{vacancyLegacyLanguage("en", nil, "advanced")})
			root["schema_version"] = schema
			root["fields"].(map[string]any)["title"] = title
			seed(string(vacancyEncode(t, root)), mapped)
		}
	}
	gooseUpTo(t, db, 41)
	// Post-41 historical sources may lack any individual requirement key. An
	// incomplete profile is entirely empty, never a partially inferred minimum.
	complete := map[string]any{"languages": []any{map[string]any{"code": "en", "min_level": "B2"}}, "min_years_of_experience": "2", "min_education_level": "bachelor", "accepts_in_progress_education": true}
	for _, missing := range []string{"languages", "min_years_of_experience", "min_education_level", "accepts_in_progress_education"} {
		fields := map[string]any{}
		for k, v := range complete {
			if k != missing {
				fields[k] = v
			}
		}
		raw, err := json.Marshal(map[string]any{"schema_version": 2, "fields": fields})
		if err != nil {
			t.Fatal(err)
		}
		seed(string(raw), empty)
	}
	seed(`{"schema_version":2,"fields":{"languages":[{"language":"en","custom_name":null,"level":"advanced"}],"min_years_of_experience":"2","min_education_level":"bachelor","accepts_in_progress_education":true}}`, empty)
	seed(`{"schema_version":2,"fields":{"languages":[{"language":"es","custom_name":null,"level":"native"}]}}`, empty)
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
		if err := json.Unmarshal([]byte(wants[i]), &want); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("fixture %d: got %s want %s", i, raw, wants[i])
		}
	}
	if snapshot() != before {
		t.Fatal("backfill altered historical source or unrelated projection state")
	}
	gooseDownTo(t, db, 41)
	if snapshot() != before {
		t.Fatal("Down altered historical source or unrelated projection state")
	}
	gooseUpTo(t, db, 42)
}
