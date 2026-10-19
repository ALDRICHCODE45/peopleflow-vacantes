package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestCandidateCVMigration(t *testing.T) {
	data, err := os.ReadFile("00021_create_candidate_cvs.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"CREATE TABLE candidate_cv_versions", "CREATE TABLE candidate_cv_library", "removed_at", "storage_key", "REFERENCES users", "5242880"} {
		if !strings.Contains(string(data), fragment) {
			t.Fatalf("missing %s", fragment)
		}
	}
}
