package migrations_test

import (
	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"io/fs"
	"strings"
	"testing"
)

func TestMigration00031VacancyGeographyDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00031_vacancy_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"ADD COLUMN country_code CHAR(2) REFERENCES geo_countries(code)", "REFERENCES geo_states(country_code,code)", "REFERENCES geo_municipalities(country_code,code)", "ADD COLUMN postal_code CHAR(5)", "ADD COLUMN remote_countries CHAR(2)[]", "work_mode='remote'", "DROP COLUMN location", "vacancy_public_state_idx", "vacancy_public_municipality_idx", "USING GIN(remote_countries)", "convert_from(fields,'UTF8')::jsonb", "convert_to(pg_temp.geo_canonical(", "ORDER BY key COLLATE \"C\"", "ORDER BY ord", "'\\u0026'", "'\\u003c'", "'\\u003e'", "'\\u2028'", "'\\u2029'", "version=version+1", "ADD COLUMN location TEXT NOT NULL DEFAULT ''", "#- '{fields,remote_scope}'"} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("missing %q", fragment)
		}
	}
}
