package migrations

import (
	"os"
	"strings"
	"testing"
)

// Every old CHECK branch must survive verbatim; only the new event is added.
func TestColumnEditingMigrationPreservesOldChecks(t *testing.T) {
	old, err := os.ReadFile("00026_pipeline_substates_active.sql")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("00028_pipeline_column_editing.sql")
	if err != nil {
		t.Fatal(err)
	}
	up := strings.Split(string(raw), "-- +goose Down")[0]
	down := strings.Split(string(raw), "-- +goose Down")[1]
	for _, line := range strings.Split(strings.Split(string(old), "-- +goose Down")[0], "\n") {
		if strings.Contains(line, "(event_kind=") || strings.Contains(line, "OR (event_kind IN (") || strings.Contains(line, "(from_stage_id IS") || strings.Contains(line, "OR (from_stage_id IS") {
			if !strings.Contains(up, strings.TrimSpace(line)) || !strings.Contains(down, strings.TrimSpace(line)) {
				t.Errorf("old branch lost: %s", line)
			}
		}
	}
	for _, s := range []string{"'not_applicable'", "not applicable history exists", "actor_kind='recruiter'", "DROP CONSTRAINT participation_history_event_kind", "DROP CONSTRAINT participation_history_event_shape", "DROP CONSTRAINT participation_history_movement_shape"} {
		if !strings.Contains(string(raw), s) {
			t.Errorf("missing %s", s)
		}
	}
}
