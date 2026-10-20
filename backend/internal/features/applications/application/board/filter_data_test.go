package board_test

import (
	"encoding/json"
	"reflect"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	intake "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
)

func TestFilterDataOnlyOnBoardAndDetailNotMutations(t *testing.T) {
	item := app.Item{Profile: app.Profile{Location: &geo.ReadLocation{Country: geo.LocationReference{ID: "MX", Name: "México"}, State: &geo.LocationReference{ID: "14", Name: "Jalisco"}, Municipality: &geo.LocationReference{ID: "14039", Name: "Guadalajara"}, Label: "Guadalajara, Jalisco"}, Skills: []string{"PRIVATE SKILL"}}, ScreeningAnswers: []app.ScreeningAnswer{{QuestionID: "q", OptionID: "o"}}}
	for _, tc := range []struct {
		name  string
		value any
		want  bool
	}{
		{"board item", item, true}, {"detail", app.Detail{Item: item}, true}, {"mutation", app.Moved{Item: item}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.value)
			if err != nil {
				t.Fatal(err)
			}
			var obj map[string]any
			if err = json.Unmarshal(raw, &obj); err != nil {
				t.Fatal(err)
			}
			if tc.want {
				want := map[string]any{
					"location": map[string]any{"country": map[string]any{"id": "MX", "name": "México"}, "state": map[string]any{"id": "14", "name": "Jalisco"}, "municipality": map[string]any{"id": "14039", "name": "Guadalajara"}, "postal_code": nil, "label": "Guadalajara, Jalisco"},
					"skills":   []any{"PRIVATE SKILL"}, "years_of_experience": nil, "education_level": nil,
				}
				if !reflect.DeepEqual(obj["profile"], want) {
					t.Fatal(obj["profile"])
				}
			}
			for _, key := range []string{"profile", "screening_answers"} {
				_, present := obj[key]
				if present != tc.want {
					t.Fatalf("%s present=%v", key, present)
				}
			}
		})
	}
}

func TestScreeningFilterDataUsesOnlyChoiceAndKeepsSnapshotOrder(t *testing.T) {
	qs := []intake.Question{
		{ID: "open", Type: "open", Prompt: "Private"},
		{ID: "FIRST", Type: "single_choice", Prompt: "First?", Options: []intake.Option{{ID: "a", Label: "A"}}},
		{ID: "second", Type: "single_choice", Prompt: "Second?", Options: []intake.Option{{ID: "b", Label: "B"}}},
	}
	answers := []intake.Answer{{QuestionID: "second", OptionID: "b"}, {QuestionID: "open", Text: "PRIVATE"}, {QuestionID: "first", OptionID: "a"}}
	got := app.ChoiceAnswers(qs, answers)
	if !reflect.DeepEqual(got, []app.ScreeningAnswer{{QuestionID: "second", OptionID: "b"}, {QuestionID: "first", OptionID: "a"}}) {
		t.Fatal(got)
	}
	filters := app.ChoiceFilters(intake.Screening{Questions: qs})
	raw, err := json.Marshal(filters)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `[{"question_id":"FIRST","prompt":"First?","options":[{"id":"a","label":"A"}]},{"question_id":"second","prompt":"Second?","options":[{"id":"b","label":"B"}]}]` {
		t.Fatal(string(raw))
	}
	for _, value := range []any{app.ChoiceAnswers(nil, nil), app.ChoiceFilters(intake.Screening{})} {
		raw, err = json.Marshal(value)
		if err != nil || string(raw) != "[]" {
			t.Fatal(string(raw), err)
		}
	}
}
