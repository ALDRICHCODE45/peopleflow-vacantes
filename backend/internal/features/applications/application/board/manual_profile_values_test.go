package board

import (
	"context"
	"encoding/json"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"reflect"
	"testing"
)

func TestManualProfileVocabularies(t *testing.T) {
	for _, tc := range []struct {
		input, want string
		valid       bool
	}{
		{"high_school", "high_school", true}, {"bachelor", "bachelor", true}, {"master", "master", true}, {"phd", "phd", true},
		{" BACHELOR ", "", false}, {"\tPhD\n", "", false}, {"", "", false}, {"associate", "", false},
	} {
		t.Run("education/"+tc.input, func(t *testing.T) {
			raw, _ := json.Marshal(tc.input)
			var fields manualFields
			got := manualLiteral(raw, "education", true, languages.ValidEducationLevel, &fields)
			if (len(fields) == 0) != tc.valid || (tc.valid && (got == nil || *got != tc.want)) {
				t.Fatalf("got %v fields=%v", got, fields)
			}
		})
	}
	for _, tc := range []struct {
		input string
		valid bool
	}{
		{"A1", true}, {"A2", true}, {"B1", true}, {"B2", true}, {"C1", true}, {"C2", true}, {"native", true},
		{"", false}, {"b1", false}, {" B1", false}, {"B1 ", false}, {"D1", false},
	} {
		t.Run("CEFR/"+tc.input, func(t *testing.T) {
			raw, _ := json.Marshal(tc.input)
			var fields manualFields
			got := manualLiteral(raw, "level", true, languages.ValidLanguageLevel, &fields)
			if (len(fields) == 0) != tc.valid || (tc.valid && (got == nil || *got != tc.input)) {
				t.Fatalf("got %v fields=%v", got, fields)
			}
		})
	}
}

func TestManualSkillsNormalizeAndPreserveOrder(t *testing.T) {
	candidate := validManualCandidate()
	candidate["skills"] = []string{" SQL ", "Go", " ÉXITO "}
	out, fields, err := manualValidationRequest(t, candidate).Validate(context.Background(), manualGeo{}, true)
	if err != nil || len(fields) != 0 {
		t.Fatalf("fields=%v error=%v", fields, err)
	}
	if !reflect.DeepEqual(out.Candidate.Skills, []string{"sql", "go", "éxito"}) {
		t.Fatalf("skills=%v", out.Candidate.Skills)
	}
	// Intake reports duplicates/empty entries as fields rather than silently
	// dropping them; accepted entries have the candidate profile canonical form.
	candidate["skills"] = []string{"Go", " go ", " "}
	_, fields, err = manualValidationRequest(t, candidate).Validate(context.Background(), manualGeo{}, true)
	want := []ManualFieldError{{Field: "candidate.skills[1]", Code: "duplicate"}, {Field: "candidate.skills[2]", Code: "required"}}
	if err != nil || !reflect.DeepEqual(fields, want) {
		t.Fatalf("fields=%v error=%v", fields, err)
	}
}
