package migrations_test

import (
	"io/fs"
	"strings"
	"testing"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
)

func TestMigration00042PublicRequirementsDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00042_public_requirements_profile.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"ADD COLUMN requirements_profile JSONB", "pg_temp.requirements_nul_masked(source.fields)::json", "SQLERRM", "JOIN job_drafts", "UPDATE vacancy_public_projections", "SET NOT NULL", "CHECK (public_requirements_profile_valid(requirements_profile))", "duplicate source keys", "DROP COLUMN requirements_profile", "DROP FUNCTION public_requirements_profile_valid(JSONB)"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing %q", fragment)
		}
	}
	for _, obsolete := range []string{"document->>'schema_version' IS DISTINCT FROM '2'", "RAISE EXCEPTION 'missing source requirements'"} {
		if strings.Contains(sql, obsolete) {
			t.Fatalf("backfill rejects historical envelopes preserved by 00041: %s", obsolete)
		}
	}
	if strings.Contains(sql, "DEFAULT") {
		t.Fatal("projection omissions must not silently default")
	}
	down := strings.Split(sql, "-- +goose Down")[1]
	for _, forbidden := range []string{"CASCADE", "DROP TABLE", "DELETE", "UPDATE", "job_drafts"} {
		if strings.Contains(down, forbidden) {
			t.Fatalf("unsafe Down: %s", down)
		}
	}
}
