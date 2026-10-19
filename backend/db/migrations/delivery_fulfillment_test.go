package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestMigration00027FulfillmentDefinition(t *testing.T) {
	raw, err := os.ReadFile("00027_delivery_fulfillment.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"CREATE TABLE process_delivery_fulfillments", "process_id UUID PRIMARY KEY", "REFERENCES vacancy_processes(id)", "fulfilled_at TIMESTAMPTZ NOT NULL", "business_days_delta INTEGER NOT NULL", "cutoff_stage_name TEXT NOT NULL", "commitment_date DATE NOT NULL", "candidates JSONB NOT NULL", "target BETWEEN 1 AND 999", "'on_time','late'", "participation_stage_history(participation_id,stage_id,created_at)", "event_kind IN ('intake','move','recovery')", "fulfillment data exists"} {
		if !strings.Contains(string(raw), fragment) {
			t.Errorf("missing %s", fragment)
		}
	}
}
