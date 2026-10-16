package migrations_test

import (
	"io/fs"
	"strings"
	"testing"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
)

func TestMigration00017DeliveryDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00017_create_job_draft_delivery_configs.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"-- +goose Up", "CREATE TABLE job_draft_delivery_configs", "UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE", "BIGINT NOT NULL", "job_draft_delivery_version_positive CHECK (version > 0)", "cutoff_stage_id UUID", "target_quantity INTEGER", "CHECK (target_quantity BETWEEN 1 AND 999)", "commitment_date DATE", "-- +goose Down", "DROP TABLE job_draft_delivery_configs;"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing %q", fragment)
		}
	}
	for _, fragment := range []string{"UPDATE ", "INSERT ", "ALTER TABLE ", "cutoff_stage_id UUID NOT NULL", "target_quantity INTEGER NOT NULL", "commitment_date DATE NOT NULL"} {
		if strings.Contains(sql, fragment) {
			t.Fatalf("unexpected %q", fragment)
		}
	}
}
