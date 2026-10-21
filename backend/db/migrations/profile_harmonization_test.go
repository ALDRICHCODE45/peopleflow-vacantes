package migrations_test

import (
	"os"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

func TestProfileHarmonizationDefinition(t *testing.T) {
	b, err := os.ReadFile("00039_profile_harmonization.sql")
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, fragment := range []string{"-- +goose Up", "-- +goose Down", "NUMERIC(3,1)", "CREATE TABLE candidate_educations", "DROP COLUMN education_level", "DROP COLUMN field_of_study", "RAISE NOTICE", "RAISE EXCEPTION", "trunc(years_of_experience)", "in_progress", "collapsed duplicate", "unmatched"} {
		if !strings.Contains(s, fragment) {
			t.Errorf("missing %q", fragment)
		}
	}
	for _, item := range languages.All() {
		tuple := "('" + item.Code + "','" + strings.ReplaceAll(item.Name, "'", "''") + "')"
		if !strings.Contains(s, tuple) {
			t.Errorf("missing catalog tuple %s", tuple)
		}
	}
}
