package board_test

import (
	"errors"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/google/uuid"
)

func TestMovementRules(t *testing.T) {
	stages := []app.Stage{{ID: "a", Kind: "new"}, {ID: "b", Kind: "screening"}, {ID: "c", Kind: "custom"}, {ID: "d", Kind: "placement"}}
	for _, tc := range []struct {
		name, from, to           string
		confirm, hire, departure bool
		want                     error
	}{
		{"next", "a", "b", false, false, false, nil},
		{"custom next", "b", "c", false, false, false, nil},
		{"skip", "a", "c", false, false, false, app.ErrStageSkip},
		{"back any", "c", "a", false, false, false, nil},
		{"hire", "c", "d", false, true, false, nil},
		{"exit unconfirmed", "d", "a", false, false, false, app.ErrPlacementExit},
		{"exit confirmed", "d", "a", true, false, true, nil},
		{"same", "b", "b", false, false, false, app.ErrValidation},
		{"unknown", "a", "unknown", false, false, false, app.ErrValidation},
		{"discarded", "a", "discarded", false, false, false, app.ErrValidation},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, d, err := app.ValidateMove(stages, tc.from, app.Move{ToStageID: tc.to, ConfirmPlacementExit: tc.confirm})
			if !errors.Is(err, tc.want) || h != tc.hire || d != tc.departure {
				t.Fatalf("got %v %v %v", h, d, err)
			}
		})
	}
}
func TestMoveStrictDecode(t *testing.T) {
	id := uuid.NewString()
	for _, tc := range []struct {
		name, body string
		valid      bool
	}{
		{"minimal", `{"to_stage_id":"` + id + `"}`, true},
		{"confirmed", `{"to_stage_id":"` + id + `","confirm_placement_exit":true}`, true},
		{"unknown", `{"to_stage_id":"` + id + `","actor":"x"}`, false},
		{"duplicate", `{"to_stage_id":"` + id + `","to_stage_id":"` + id + `"}`, false},
		{"null flag", `{"to_stage_id":"` + id + `","confirm_placement_exit":null}`, false},
		{"wrong flag", `{"to_stage_id":"` + id + `","confirm_placement_exit":"true"}`, false},
		{"missing", `{}`, false}, {"bad uuid", `{"to_stage_id":"bad"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := app.DecodeMove([]byte(tc.body), draftjson.Decode)
			if (err == nil) != tc.valid {
				t.Fatal(err)
			}
		})
	}
}

// Config resources share the strong-tag comparator; draft r2 has a stricter
// scheme parser. A foreign strong tag conflicts, not a malformed-header error.
func TestParticipationETagResourceSeparation(t *testing.T) {
	id := uuid.New()
	participation := app.ETag(id, 1)
	draft, err := draftversion.FormatETagV2(id.String(), 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, tag string }{
		{"pipeline", pipelineconfig.ETag(id, 1)},
		{"substates", substatecatalog.ETag(id, 1)},
		{"delivery", deliveryconfig.ETag(id, 1)},
		{"management", vacancymanagement.ETag(id, 1)},
		{"draft", draft},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := app.CheckIfMatch(participation, tc.tag, true); !errors.Is(err, app.ErrVersionConflict) {
				t.Fatalf("participation accepted foreign %s tag: %v", tc.name, err)
			}
			if tc.name == "draft" {
				if _, err := draftversion.ParseIfMatchV2(participation, true); !errors.Is(err, draftversion.ErrInvalidRequest) {
					t.Fatal(err)
				}
			} else if err := pipelineconfig.CheckIfMatch(tc.tag, participation, true); !errors.Is(err, drafts.ErrVersionConflict) {
				t.Fatalf("%s accepted participation tag: %v", tc.name, err)
			}
		})
	}
}

func TestParticipationETag(t *testing.T) {
	id := uuid.New()
	tag := app.ETag(id, 1)
	if tag == app.ETag(id, 2) || tag == app.ETag(uuid.New(), 1) {
		t.Fatal("tag identity/version collision")
	}
	for _, tc := range []struct {
		name, value string
		present     bool
		want        error
	}{
		{"valid", tag, true, nil}, {"missing", "", false, app.ErrPreconditionRequired}, {"empty", "", true, app.ErrInvalidRequest}, {"weak", "W/" + tag, true, app.ErrInvalidRequest}, {"list", tag + "," + tag, true, app.ErrInvalidRequest}, {"wildcard", "*", true, app.ErrInvalidRequest}, {"unquoted", "bad", true, app.ErrInvalidRequest}, {"foreign", `"foreign"`, true, app.ErrVersionConflict}, {"stale", app.ETag(id, 2), true, app.ErrVersionConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := app.CheckIfMatch(tag, tc.value, tc.present); !errors.Is(err, tc.want) {
				t.Fatal(err)
			}
		})
	}
}
