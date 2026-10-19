package migrations_test

import (
	"io/fs"
	"strings"
	"testing"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
)

func TestMigration00025EnrichmentDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00025_public_listing_enrichment.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"ADD COLUMN skills", "ADD COLUMN screening_questions", "convert_from(", "UTF8", "job_drafts", "RAISE EXCEPTION", "UPDATE vacancy_public_projections", "DROP COLUMN skills", "DROP COLUMN screening_questions"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing %q", fragment)
		}
	}
	down := strings.Split(sql, "-- +goose Down")[1]
	for _, forbidden := range []string{"DROP TABLE", "DELETE", "UPDATE", "job_drafts", "process_participations"} {
		if strings.Contains(down, forbidden) {
			t.Fatalf("unsafe down: %s", down)
		}
	}
}
