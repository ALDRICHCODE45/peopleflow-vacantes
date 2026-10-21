package migrations_test

import (
	"encoding/json"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"io/fs"
	"strings"
	"testing"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

var vacancyCanonicalTitles = []string{"~geo_nul_0! ~geo_nul_1! \x00 <>& \u2028\u2029 retained", "literal \\u0000 and quote \" and slash \\"}

func TestVacancyHarmonizationCanonicalTitleFixtures(t *testing.T) {
	for _, title := range vacancyCanonicalTitles {
		body, _ := json.Marshal(map[string]any{"fields": map[string]any{"title": title}})
		created, err := draftinput.DecodeCreateV2(body)
		if err != nil {
			t.Fatal(err)
		}
		root, _ := draftjson.Decode(created.Fingerprint())
		if got := root.(map[string]any)["fields"].(map[string]any)["title"]; got != title {
			t.Errorf("fixture title is not canonical: %q becomes %q", title, got)
		}
	}
}

func TestVacancyHarmonizationDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00041_vacancy_harmonization.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{
		"LOCK TABLE job_drafts, vacancy_public_projections IN ACCESS EXCLUSIVE MODE",
		"version=version+1, updated_at=now()",
		"parsed := convert_from(masked,'UTF8')::jsonb;",
		"seen_count=nul_count", "cursor_pos := cursor_pos+2", "ORDER BY key COLLATE \"C\"",
		"vacancy_public_projections_seniority_check", "'semi_senior'", "'manager'", "'director'",
		"'min_years_of_experience'", "'min_education_level'", "'accepts_in_progress_education'",
		"LIMIT 20", "overflow", "RAISE EXCEPTION '00041 rollback refused",
		"vacancy_draft_0041_backup", "normalize(", "'A2'", "'B1'", "'C1'",
		"pg_temp.vacancy_reverse(document BYTEA)", "ELSE pg_temp.vacancy_reverse(d.fields)",
	} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("missing %q", fragment)
		}
	}
	for _, item := range languages.All() {
		tuple := "('" + item.Code + "','" + strings.ReplaceAll(item.Name, "'", "''") + "')"
		if !strings.Contains(sql, tuple) {
			t.Errorf("missing frozen catalog tuple %s", tuple)
		}
	}
	for _, forbidden := range []string{"UPDATE jobs ", "UPDATE job_draft_idempotency", "UPDATE job_draft_save_idempotency"} {
		if strings.Contains(sql, forbidden) {
			t.Errorf("rewrites legacy/frozen data: %s", forbidden)
		}
	}
	// Reuse the 00031 encoder byte-for-byte (including HTML and separator escapes).
	old, err := fs.ReadFile(migrations.MigrationsFS, "00031_vacancy_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	encoder := func(source, name string) string {
		_, rest, ok := strings.Cut(source, "CREATE OR REPLACE FUNCTION pg_temp."+name)
		if !ok {
			t.Fatalf("missing %s", name)
		}
		body, _, _ := strings.Cut(rest, "END $$;")
		return strings.ReplaceAll(body, name, "canonical")
	}
	for _, direction := range strings.Split(sql, "-- +goose Down") {
		if encoder(string(old), "geo_canonical") != encoder(direction, "vacancy_canonical") {
			t.Fatal("canonical encoder diverges from 00031")
		}
	}
	for _, guard := range []string{"parsed := convert_from(masked,'UTF8')::jsonb;", "seen_count=nul_count", "cursor_pos := cursor_pos+2", "replace(pg_temp.vacancy_canonical(parsed),marker"} {
		if strings.Count(sql, guard) != 2 {
			t.Errorf("both directions must use 00031 scanner: %s", guard)
		}
	}
}
