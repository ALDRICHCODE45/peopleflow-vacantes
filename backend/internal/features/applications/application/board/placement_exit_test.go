package board_test

import (
	"errors"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

func TestPlacementExitDecodeAndMoveValidation(t *testing.T) {
	a, b := uuid.NewString(), uuid.NewString()
	stages := []app.Stage{{ID: a, Kind: "new"}, {ID: b, Kind: "placement"}}
	for _, tc := range []struct {
		name, field string
		decodeErr   error
	}{
		{"missing", "", nil},
		{"mistake", `,"placement_exit_reason":"moved_by_mistake"`, nil},
		{"left", `,"placement_exit_reason":"candidate_left"`, nil},
		{"empty", `,"placement_exit_reason":""`, app.ErrInvalidRequest},
		{"unknown", `,"placement_exit_reason":"other"`, app.ErrInvalidRequest},
		{"null", `,"placement_exit_reason":null`, app.ErrInvalidRequest},
		{"boolean", `,"placement_exit_reason":true`, app.ErrInvalidRequest},
		{"legacy", `,"confirm_placement_exit":true`, app.ErrInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			move, err := app.DecodeMove([]byte(`{"to_stage_id":"`+a+`"`+tc.field+`}`), draftjson.Decode)
			if !errors.Is(err, tc.decodeErr) {
				t.Fatalf("move decode %v want %v", err, tc.decodeErr)
			}
			reason := `"reason":{"group":"candidate","key":"unresponsive"}`
			_, err = app.DecodeDiscard([]byte(`{`+reason+tc.field+`}`), draftjson.Decode)
			if !errors.Is(err, tc.decodeErr) {
				t.Fatalf("discard decode %v want %v", err, tc.decodeErr)
			}
			if tc.decodeErr != nil {
				return
			}
			_, departure, err := app.ValidateMove(stages, b, move)
			if tc.field == "" {
				if !errors.Is(err, app.ErrPlacementExit) {
					t.Fatal(err)
				}
			} else {
				if err != nil || !departure {
					t.Fatal(departure, err)
				}
				move.ToStageID = b
				if _, _, err := app.ValidateMove(stages, a, move); !errors.Is(err, app.ErrInvalidRequest) {
					t.Fatal("reason on non-exit", err)
				}
			}
		})
	}
}
