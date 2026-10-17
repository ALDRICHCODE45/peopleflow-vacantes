package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestDiscardMigration(t *testing.T) {
	raw, err := os.ReadFile("00024_pipeline_discard.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"previous_stage_id UUID", "reason_group TEXT", "reason_code TEXT", "candidate_message TEXT", "discarded_at TIMESTAMPTZ", "event_kind TEXT", "requirements_not_met", "profile_mismatch", "salary_expectation", "other_candidate_selected", "accepted_other_offer", "no_longer_interested", "unresponsive", "discard data exists", "UPDATE participation_stage_history", "WHEN from_stage_id IS NULL THEN 'intake' ELSE 'move'"} {
		if !strings.Contains(string(raw), fragment) {
			t.Errorf("missing %s", fragment)
		}
	}
}
