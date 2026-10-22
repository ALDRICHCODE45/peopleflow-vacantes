package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestOrgCandidateEditsMigrationDefinition(t *testing.T) {
	raw, err := fs.ReadFile(MigrationsFS, "00044_org_candidate_edits.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(raw), "-- +goose Down")
	if len(parts) != 2 {
		t.Fatal("missing Down")
	}
	for _, fragment := range []string{"ADD COLUMN version BIGINT NOT NULL DEFAULT 1", "updated_at=created_at", "updated_by=created_by", "CREATE TABLE company_candidate_history", "company_id", "candidate_kind", "candidate_id", "actor_id", "changes JSONB", "at DESC,id DESC"} {
		if !strings.Contains(parts[0], fragment) {
			t.Errorf("missing %q", fragment)
		}
	}
	for _, fragment := range []string{"LOCK TABLE", "RAISE EXCEPTION", "version <> 1", "SELECT 1 FROM company_candidate_history"} {
		if !strings.Contains(parts[1], fragment) {
			t.Errorf("unguarded Down: %q", fragment)
		}
	}
}
