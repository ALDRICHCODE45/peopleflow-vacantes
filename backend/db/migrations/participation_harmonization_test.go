package migrations

import (
	"io/fs"
	"strings"
	"testing"
)

func TestParticipationHarmonizationMigrationDefinition(t *testing.T) {
	raw, err := fs.ReadFile(MigrationsFS, "00043_participation_profile_harmonization.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(raw), "-- +goose Down")
	if len(parts) != 2 {
		t.Fatal("missing Down")
	}
	for _, s := range []string{"ARRAY['location','skills','years_of_experience','seniority','education','languages']", "trim_scale((profile_snapshot->>'years_of_experience')::numeric)::text", "WHERE profile_snapshot IS NOT NULL", "'highest_completed'", "'in_progress'", "strict $.languages[*]", "strict $.skills[*]", "jsonb_array_length(jsonb_path_query_array", "= jsonb_array_length(profile_snapshot->'languages')", "jsonb_typeof(profile_snapshot->'education'->'in_progress') = 'string'"} {
		if !strings.Contains(parts[0], s) {
			t.Errorf("Up missing %s", s)
		}
	}
	for _, s := range []string{"RAISE EXCEPTION", "<> trunc(", "profile_snapshot->'seniority' <> 'null'::jsonb", "profile_snapshot->'languages' <> '[]'::jsonb", "NOT IN ('high_school','bachelor','master','phd')", "profile_snapshot->'education'->'in_progress' <> 'null'::jsonb"} {
		if !strings.Contains(parts[1], s) {
			t.Errorf("Down missing %s", s)
		}
	}
	// The guard must run under a lock that excludes concurrent writers, or a
	// snapshot committed between the check and the rewrite is silently lost.
	lock := strings.Index(parts[1], "LOCK TABLE process_participations IN SHARE ROW EXCLUSIVE MODE")
	if lock < 0 || lock > strings.Index(parts[1], "RAISE EXCEPTION") {
		t.Fatal("Down must lock process_participations before evaluating its guard")
	}
	previous, err := fs.ReadFile(MigrationsFS, "00033_apply_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	oldUp := strings.Split(string(previous), "-- +goose Down")[0]
	start := strings.Index(oldUp, "ALTER TABLE process_participations ADD CONSTRAINT")
	constraint := strings.TrimSpace(strings.Split(oldUp[start:], "-- +goose StatementEnd")[0])
	if !strings.Contains(parts[1], constraint) {
		t.Fatal("Down must restore the exact 00033 constraint")
	}
}
