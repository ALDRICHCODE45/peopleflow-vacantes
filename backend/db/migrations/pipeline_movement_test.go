package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestMovementMigration(t *testing.T) {
	raw, err := os.ReadFile("00023_pipeline_movement.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"ADD COLUMN version BIGINT NOT NULL DEFAULT 1", "from_stage_id UUID", "hire BOOLEAN NOT NULL DEFAULT false", "departure BOOLEAN NOT NULL DEFAULT false", "actor_kind TEXT NOT NULL DEFAULT 'candidate'", "CREATE TABLE process_coverage_milestones", "REFERENCES vacancy_processes", "covered >= required", "movement data exists"} {
		if !strings.Contains(string(raw), fragment) {
			t.Errorf("missing %s", fragment)
		}
	}
}
