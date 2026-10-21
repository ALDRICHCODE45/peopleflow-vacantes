package migrations_test

import (
	"os"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

func TestManualHarmonizationDefinition(t *testing.T) {
	data, err := os.ReadFile("00040_manual_harmonization.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(data)
	for _, fragment := range []string{"RENAME COLUMN experience_years TO years_of_experience", "NUMERIC(3,1)", "CREATE TABLE company_candidate_educations", "DROP COLUMN education_level", "DROP COLUMN field_of_study", "RENAME COLUMN language TO code", "'native'", "RAISE NOTICE", "RAISE EXCEPTION", "trunc(years_of_experience)"} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("missing %q", fragment)
		}
	}
	for _, item := range languages.All() {
		tuple := "('" + item.Code + "','" + strings.ReplaceAll(item.Name, "'", "''") + "')"
		if !strings.Contains(sql, tuple) {
			t.Errorf("catalog tuple missing: %s", tuple)
		}
	}
}
