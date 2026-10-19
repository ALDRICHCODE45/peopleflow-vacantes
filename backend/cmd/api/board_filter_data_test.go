package main

import (
	"encoding/json"
	"strings"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
)

func TestBoardFilterDataUsesSafeCurrentScreeningProjector(t *testing.T) {
	for _, tc := range []struct {
		name, fields string
		want         int
	}{
		{"empty", `{"fields":{}}`, 0},
		{"only open", `{"fields":{"screening_questions":[{"id":"11111111-1111-4111-8111-111111111111","type":"open","prompt":"Why?"}]}}`, 0},
		{"evaluated choice", `{"fields":{"screening_questions":[{"id":"11111111-1111-4111-8111-111111111111","type":"single_choice_evaluated","prompt":"Available?","options":[{"id":"22222222-2222-4222-8222-222222222222","label":"Yes"},{"id":"33333333-3333-4333-8333-333333333333","label":"No"}],"correct_option_id":"22222222-2222-4222-8222-222222222222"}]}}`, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fields, err := draftinput.DecodeCreateV2([]byte(tc.fields))
			if err != nil {
				t.Fatal(err)
			}
			form, err := (movementContext{}).Screening(fields.Fingerprint())
			if err != nil {
				t.Fatal(err)
			}
			filters := board.ChoiceFilters(form)
			raw, err := json.Marshal(filters)
			if err != nil || len(filters) != tc.want {
				t.Fatal("wrong current screening filters", err)
			}
			for _, forbidden := range []string{"correct_option_id", "evaluated", "type", "score"} {
				if strings.Contains(string(raw), forbidden) {
					t.Fatalf("private field leaked: %s", forbidden)
				}
			}
			if tc.want == 0 && string(raw) != "[]" {
				t.Fatal("empty catalog must be []")
			}
		})
	}
}
