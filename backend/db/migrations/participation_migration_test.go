package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestProcessParticipationMigration(t *testing.T) {
	data, err := os.ReadFile("00022_create_process_participations.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"CREATE TABLE process_participations", "UNIQUE (process_id, candidate_id)", "REFERENCES candidate_cv_versions", "CREATE TABLE participation_stage_history", "CREATE TABLE participation_idempotency", "questions_snapshot", "answers_snapshot"} {
		if !strings.Contains(string(data), fragment) {
			t.Fatalf("missing %s", fragment)
		}
	}
	if strings.Contains(string(data), "ALTER TABLE applications") {
		t.Fatal("legacy table changed")
	}
}
