package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestManualIntakeMigrationDefinitions(t *testing.T) {
	for file, fragments := range map[string][]string{
		"00036_company_candidates.sql":    {"CREATE TABLE company_candidates", "email_normalized", "REFERENCES geo_postal_codes", "'high_school','bachelor','master','phd'", "experience_years BETWEEN 0 AND 60", "(company_id, email_normalized)", "(company_id, phone)"},
		"00037_company_candidate_cvs.sql": {"CREATE TABLE company_candidate_cvs", "REFERENCES company_candidates", "size BETWEEN 1 AND 5242880", "storage_key TEXT NOT NULL UNIQUE", "file_name TEXT NOT NULL"},
		"00038_manual_participations.sql": {"ALTER COLUMN candidate_id DROP NOT NULL", "ALTER COLUMN cv_version_id DROP NOT NULL", "UNIQUE (process_id, company_candidate_id)", "candidate_id IS NULL", "company_candidate_id IS NULL", "source IN ('organic','manual')", "added_by IS NOT NULL", "event_kind='intake' AND from_stage_id IS NULL AND actor_kind='recruiter'"},
	} {
		t.Run(file, func(t *testing.T) {
			raw, err := fs.ReadFile(MigrationsFS, file)
			if err != nil {
				t.Fatal(err)
			}
			parts := strings.Split(string(raw), "-- +goose Down")
			if len(parts) != 2 {
				t.Fatal("missing Down")
			}
			for _, fragment := range fragments {
				if !strings.Contains(parts[0], fragment) {
					t.Errorf("missing %q", fragment)
				}
			}
			if strings.Contains(parts[0], "UPDATE ") || strings.Contains(parts[0], "DELETE ") {
				t.Fatal("existing data must remain untouched")
			}
			for _, fragment := range []string{"LOCK TABLE", "RAISE EXCEPTION"} {
				if !strings.Contains(parts[1], fragment) {
					t.Errorf("unguarded Down: missing %s", fragment)
				}
			}
		})
	}
}
