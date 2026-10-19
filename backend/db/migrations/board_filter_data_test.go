package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestBoardFilterDataMigration(t *testing.T) {
	raw, err := os.ReadFile("00029_board_filter_data.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(raw), "-- +goose Down")
	if len(parts) != 2 {
		t.Fatal("missing down")
	}
	for _, want := range []string{"ADD COLUMN profile_snapshot JSONB", "CHECK", "jsonb_typeof", "city", "skills", "years_of_experience", "education_level", "high_school", "bachelor", "master", "phd"} {
		if !strings.Contains(parts[0], want) {
			t.Errorf("missing %s", want)
		}
	}
	// Lax JSONPath auto-unwraps nested skills arrays and violates the shape.
	if !strings.Contains(parts[0], `jsonb_path_exists(profile_snapshot, 'strict $.skills[*] ? (@.type() != "string")')`) {
		t.Fatal("skills element check must use strict JSONPath to reject nested arrays")
	}
	if strings.Contains(parts[0], "UPDATE process_participations") || strings.Contains(parts[0], "DEFAULT") {
		t.Fatal("legacy profiles must remain SQL NULL")
	}
	if !strings.Contains(parts[1], "profile_snapshot IS NOT NULL") || !strings.Contains(parts[1], "RAISE EXCEPTION") {
		t.Fatal("down must refuse retained snapshots")
	}
}
