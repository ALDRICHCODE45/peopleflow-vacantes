package migrations_test

import (
	"io/fs"
	"strings"
	"testing"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
)

func TestMigration00018ManagementDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00018_create_job_draft_management_configs.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"-- +goose Up", "CREATE TABLE job_draft_management_configs", "UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE", "BIGINT NOT NULL", "CHECK (version > 0)", "request_date DATE", "hiring_headcount INTEGER", "CHECK (hiring_headcount BETWEEN 1 AND 999)", "-- +goose Down", "DROP TABLE job_draft_management_configs;"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing %q", fragment)
		}
	}
	for _, fragment := range []string{"UPDATE ", "INSERT ", "ALTER TABLE ", "request_date DATE NOT NULL", "hiring_headcount INTEGER NOT NULL"} {
		if strings.Contains(sql, fragment) {
			t.Fatalf("unexpected %q", fragment)
		}
	}
}
