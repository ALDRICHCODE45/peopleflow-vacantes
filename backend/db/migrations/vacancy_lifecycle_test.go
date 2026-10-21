package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestVacancyLifecycleMigrationShape(t *testing.T) {
	raw, err := fs.ReadFile(MigrationsFS, "00034_vacancy_lifecycle.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(raw), "-- +goose Down")
	if len(parts) != 2 {
		t.Fatal("missing down")
	}
	for _, want := range []string{"DROP CONSTRAINT vacancy_process_status", "'published', 'paused', 'closed'", "process_status TEXT NOT NULL DEFAULT 'active'", "process_status <> 'finished' OR status = 'closed'", "lifecycle_version BIGINT NOT NULL DEFAULT 1", "lifecycle_version > 0", "paused_at TIMESTAMPTZ", "closed_at TIMESTAMPTZ", "process_finished_at TIMESTAMPTZ", "CREATE TABLE vacancy_lifecycle_events", "actor_name TEXT NOT NULL", "REFERENCES vacancy_processes (id)", "UNIQUE (process_id, lifecycle_version)"} {
		if !strings.Contains(parts[0], want) {
			t.Errorf("up missing %s", want)
		}
	}
	for _, want := range []string{"RAISE EXCEPTION", "status <> 'published' OR process_status <> 'active'", "EXISTS (SELECT 1 FROM vacancy_lifecycle_events)", "DROP TABLE vacancy_lifecycle_events", "CHECK (status IN ('published'))"} {
		if !strings.Contains(parts[1], want) {
			t.Errorf("down missing %s", want)
		}
	}
}
