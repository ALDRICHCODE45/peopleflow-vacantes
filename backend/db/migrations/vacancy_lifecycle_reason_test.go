package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestVacancyLifecycleReasonMigrationShape(t *testing.T) {
	raw, err := fs.ReadFile(MigrationsFS, "00035_vacancy_lifecycle_reason.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(raw), "-- +goose Down")
	if len(parts) != 2 {
		t.Fatal("missing down")
	}
	for _, fragment := range []string{"ADD COLUMN reason TEXT", "ADD COLUMN reason_note TEXT", "'filled', 'cancelled', 'other'", "char_length(reason_note) <= 200", "UPDATE vacancy_processes", "vacancy_public_projections", "published_at = projection.published_at"} {
		if !strings.Contains(parts[0], fragment) {
			t.Error("up missing", fragment)
		}
	}
	for _, fragment := range []string{"LOCK TABLE", "RAISE EXCEPTION", "DROP COLUMN reason", "DROP COLUMN reason_note"} {
		if !strings.Contains(parts[1], fragment) {
			t.Error("down missing", fragment)
		}
	}
}
