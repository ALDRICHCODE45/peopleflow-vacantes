package migrations_test

import (
	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"io/fs"
	"strings"
	"testing"
)

func TestMigration00020PublicProjectionDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00020_create_vacancy_public_projections.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"CREATE TABLE vacancy_public_projections", "REFERENCES vacancy_processes (id) ON DELETE CASCADE", "description JSONB", "benefits JSONB NOT NULL", "compensation JSONB", "source_draft_version BIGINT NOT NULL", "tsvector GENERATED ALWAYS AS", "to_tsvector('spanish', coalesce(title, ''))", "'A'", "to_tsvector('spanish', coalesce(description_plain, ''))", "'B'", "USING GIN (search_vector)", "DROP TABLE vacancy_public_projections;"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing %q", fragment)
		}
	}
	for _, fragment := range []string{"UPDATE ", "INSERT ", "ALTER TABLE ", "requester", "headcount", "screening", "public_visible"} {
		if strings.Contains(sql, fragment) {
			t.Fatalf("unexpected %q", fragment)
		}
	}
}
