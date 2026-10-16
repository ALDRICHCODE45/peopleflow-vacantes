package migrations_test

import (
	"io/fs"
	"strings"
	"testing"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
)

func TestMigration00016SubstateCatalogDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00016_create_job_draft_substate_catalogs.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"-- +goose Up", "CREATE TABLE job_draft_substate_catalogs", "UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE", "BIGINT NOT NULL", "job_draft_substate_version_positive CHECK (version > 0)", "catalog BYTEA NOT NULL", "-- +goose Down", "DROP TABLE job_draft_substate_catalogs;"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing %q", fragment)
		}
	}
	if strings.Contains(sql, "UPDATE ") || strings.Contains(sql, "INSERT ") || strings.Contains(sql, "ALTER TABLE ") {
		t.Fatal("migration must be additive, without rewriting existing data")
	}
}
