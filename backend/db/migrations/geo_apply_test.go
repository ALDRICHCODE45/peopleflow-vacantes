package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestGeoApplyMigrationShapeAndRewrites(t *testing.T) {
	raw, err := fs.ReadFile(MigrationsFS, "00033_apply_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(raw), "-- +goose Down")
	if len(parts) != 2 {
		t.Fatal("missing down")
	}
	for _, part := range parts {
		for _, want := range []string{"DROP CONSTRAINT participation_profile_snapshot_shape", "ADD CONSTRAINT participation_profile_snapshot_shape", "COALESCE(", "WHERE profile_snapshot IS NOT NULL", `'strict $.skills[*] ? (@.type() != "string")'`} {
			if !strings.Contains(part, want) {
				t.Errorf("missing %s", want)
			}
		}
	}
	for _, want := range []string{"ARRAY['location','skills','years_of_experience','education_level']", "ARRAY['country','state','municipality']", "^[A-Z]{2}$", "^[0-9]{2}$", "^[0-9]{5}$", "= 'MX'", "left(profile_snapshot->'location'->>'municipality', 2)", "(profile_snapshot - 'city') || jsonb_build_object('location', NULL)"} {
		if !strings.Contains(parts[0], want) {
			t.Errorf("missing %s", want)
		}
	}
	if !strings.Contains(parts[1], "(profile_snapshot - 'location') || jsonb_build_object('city', NULL)") {
		t.Fatal("down must restore null city")
	}
}
