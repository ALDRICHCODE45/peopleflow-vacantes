package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestGeoProfilesMigration(t *testing.T) {
	raw, err := os.ReadFile("00032_profile_company_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	up, down, ok := strings.Cut(string(raw), "-- +goose Down")
	if !ok {
		t.Fatal("missing down")
	}
	for _, token := range []string{"ALTER TABLE candidate_profiles", "ALTER TABLE companies", "DROP INDEX candidate_profiles_city_idx", "DROP COLUMN city", "DROP COLUMN country", "REFERENCES geo_countries", "REFERENCES geo_states", "REFERENCES geo_municipalities", "REFERENCES geo_postal_codes", "candidate_profiles_location_consistency", "companies_location_consistency"} {
		if !strings.Contains(up, token) {
			t.Errorf("up missing %s", token)
		}
	}
	for _, token := range []string{"ADD COLUMN city TEXT", "ADD COLUMN country TEXT", "CREATE INDEX candidate_profiles_city_idx"} {
		if !strings.Contains(down, token) {
			t.Errorf("down missing %s", token)
		}
	}
	if strings.Contains(up, "UPDATE candidate_profiles") || strings.Contains(up, "UPDATE companies") {
		t.Fatal("no backfill authorized")
	}
}
