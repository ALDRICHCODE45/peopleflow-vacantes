//go:build integration

package migrations_test

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

// Exercise the actual Down on both post-Up inserts and edits of backed-up rows.
// The expected old documents are encoded by Go, not by the SQL under test.
func TestVacancyHarmonizationReverseMappingNewAndEditedDrafts(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 40)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	type fixture struct {
		existing, fresh uuid.UUID
		seniority       any
		code, level     string
		expected        []byte
	}
	var fixtures []fixture
	for _, seniority := range []any{nil, "intern", "junior", "semi_senior", "senior", "lead"} {
		fixtures = append(fixtures, fixture{existing: uuid.New(), fresh: uuid.New(), seniority: seniority})
	}
	for _, code := range []string{"es", "en", "nah"} {
		levels := []string{"A2", "B1", "C1", "native"}
		if code == "nah" {
			levels = append(levels, "A1", "B2", "C2")
		}
		for _, level := range levels {
			fixtures = append(fixtures, fixture{existing: uuid.New(), fresh: uuid.New(), seniority: "semi_senior", code: code, level: level})
		}
	}
	defer func() {
		for _, f := range fixtures {
			if _, err := pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1 OR id=$2`, f.existing, f.fresh); err != nil {
				t.Error(err)
			}
		}
		gooseUpAll(t, db)
	}()
	_, original := vacancyDocument(t, nil, []any{})
	for _, f := range fixtures {
		insertDraftAt(t, pool, company, actor, f.existing, original)
	}
	gooseUpTo(t, db, 41)
	for i := range fixtures {
		f := &fixtures[i]
		items := []any{}
		if f.code != "" {
			items = append(items, vacancyRequirement(f.code, f.level))
		}
		body, err := json.Marshal(map[string]any{"fields": map[string]any{
			"title": vacancyCanonicalTitles[i%len(vacancyCanonicalTitles)], "seniority": f.seniority, "languages": items,
		}})
		if err != nil {
			t.Fatal(err)
		}
		created, err := draftinput.DecodeCreateV2(body)
		if err != nil {
			t.Fatal(err)
		}
		if err := draftinput.ValidatePersistedDraftV2(created.Fingerprint()); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, f.existing, created.Fingerprint()); err != nil {
			t.Fatal(err)
		}
		insertDraftAt(t, pool, company, actor, f.fresh, created.Fingerprint())
		decoded, err := draftjson.Decode(created.Fingerprint())
		if err != nil {
			t.Fatal(err)
		}
		fields := decoded.(map[string]any)["fields"].(map[string]any)
		for _, key := range []string{"min_years_of_experience", "min_education_level", "accepts_in_progress_education"} {
			delete(fields, key)
		}
		if f.seniority == "semi_senior" {
			fields["seniority"] = "mid"
		}
		oldItems := []any{}
		if f.code != "" {
			var oldLevel any
			switch f.level {
			case "A2":
				oldLevel = "basic"
			case "B1":
				oldLevel = "intermediate"
			case "C1":
				oldLevel = "advanced"
			case "native":
				oldLevel = "native"
			}
			var name any
			language := f.code
			if f.code == "nah" {
				language, name = "other", "Náhuatl"
			}
			oldItems = append(oldItems, vacancyLegacyLanguage(language, name, oldLevel))
		}
		fields["languages"] = oldItems
		f.expected = vacancyEncode(t, decoded)
	}
	gooseDownTo(t, db, 40)
	for _, f := range fixtures {
		for index, id := range []uuid.UUID{f.existing, f.fresh} {
			var got []byte
			var version int64
			if err := pool.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, id).Scan(&got, &version); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, f.expected) || version != int64(3-index) {
				t.Fatalf("code=%s level=%s version=%d got=%s want=%s", f.code, f.level, version, got, f.expected)
			}
		}
	}
}
