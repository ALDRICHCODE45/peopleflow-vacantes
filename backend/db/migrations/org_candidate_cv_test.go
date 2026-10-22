package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestOrgCandidateCVMigrationDefinition(t *testing.T) {
	raw, err := fs.ReadFile(MigrationsFS, "00046_org_candidate_cv.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(raw), "-- +goose Down")
	if len(parts) != 2 {
		t.Fatal("missing Down")
	}
	for _, v := range []string{"corrected_company_cv_id", "cv_corrected", "participation_id", "file_name"} {
		if !strings.Contains(parts[0], v) {
			t.Error(v)
		}
	}
	for _, v := range []string{"LOCK TABLE", "RAISE EXCEPTION", "retention decision", "cv_corrected"} {
		if !strings.Contains(parts[1], v) {
			t.Error(v)
		}
	}
}
