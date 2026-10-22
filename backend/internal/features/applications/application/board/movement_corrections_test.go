package board_test

import (
	"bytes"
	"encoding/json"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	intake "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
)

func TestUncorrectedBoardItemRetainsLegacyBytes(t *testing.T) {
	item := app.Item{CorrectedFields: []string{}, Profile: app.Profile{Skills: []string{}, Languages: []intake.SnapshotLanguage{}}, ScreeningAnswers: []app.ScreeningAnswer{}, StageID: "stage", Version: "1", ETag: `"tag"`, Candidate: app.Candidate{FullName: "Original", Kind: "organic"}, Source: "organic", CV: app.CV{Name: "CV", Source: "candidate"}}
	raw, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	// Strip ONLY E4's additive item/CV keys. Everything previously returned,
	// including field order, arrays/nulls and timestamp encoding, is byte-pinned.
	legacy := bytes.Replace(raw, []byte(`"corrected_fields":[],`), nil, 1)
	legacy = bytes.Replace(legacy, []byte(`,"source":"candidate"`), nil, 1)
	want := `{"profile":{"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]},"screening_answers":[],"substate_id":null,"id":"00000000-0000-0000-0000-000000000000","stage_id":"stage","version":"1","etag":"\"tag\"","candidate":{"id":"00000000-0000-0000-0000-000000000000","full_name":"Original","kind":"organic"},"added_by":null,"applied_at":"0001-01-01T00:00:00Z","source":"organic","cv":{"id":"00000000-0000-0000-0000-000000000000","name":"CV"},"moved_at":"0001-01-01T00:00:00Z","discard":null}`
	if string(legacy) != want {
		t.Fatalf("uncorrected legacy bytes changed\ngot: %s\nwant: %s", legacy, want)
	}
}
