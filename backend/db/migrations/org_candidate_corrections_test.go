package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestOrgCandidateCorrectionsMigrationDefinition(t *testing.T) {
	raw, err := fs.ReadFile(MigrationsFS, "00045_org_candidate_corrections.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(raw), "-- +goose Down")
	if len(parts) != 2 {
		t.Fatal("missing Down")
	}
	for _, fragment := range []string{"CREATE TABLE company_candidate_corrections", "PRIMARY KEY (company_id,user_id)", "version BIGINT NOT NULL DEFAULT 1", "corrections JSONB", "REFERENCES users(id)"} {
		if !strings.Contains(parts[0], fragment) {
			t.Errorf("missing %s", fragment)
		}
	}
	for _, fragment := range []string{"LOCK TABLE", "company_candidate_history", "candidate_kind='organic'", "RAISE EXCEPTION", "retention decision"} {
		if !strings.Contains(parts[1], fragment) {
			t.Errorf("unguarded Down: %s", fragment)
		}
	}
}
