package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestActiveSubstateMigrationDefinition(t *testing.T) {
	raw, err := os.ReadFile("00026_pipeline_substates_active.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"substate_id UUID", "from_substate_name TEXT", "to_substate_name TEXT", "'substate'", "substate data exists", "participation_history_movement_shape", "participation_history_event_shape", "participation_substate_shape"} {
		if !strings.Contains(string(raw), fragment) {
			t.Errorf("missing %s", fragment)
		}
	}
}
