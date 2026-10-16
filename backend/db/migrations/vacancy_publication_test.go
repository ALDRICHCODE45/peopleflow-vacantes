package migrations_test

import (
	"io/fs"
	"strings"
	"testing"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
)

func TestMigration00019PublicationDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00019_create_vacancy_processes.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"-- +goose Up", "CREATE TABLE vacancy_processes", "id UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE", "company_id UUID NOT NULL REFERENCES companies (id)", "CHECK (status IN ('published'))", "published_at TIMESTAMPTZ NOT NULL", "published_by UUID NOT NULL REFERENCES users (id)", "-- +goose Down", "DROP TABLE vacancy_processes;"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing %q", fragment)
		}
	}
	for _, fragment := range []string{"UPDATE ", "INSERT ", "ALTER TABLE ", "jobs (", "applications ("} {
		if strings.Contains(sql, fragment) {
			t.Fatalf("unexpected %q", fragment)
		}
	}
}
