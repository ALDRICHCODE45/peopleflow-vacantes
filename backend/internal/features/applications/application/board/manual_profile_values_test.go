package board

import (
	"context"
	"reflect"
	"testing"
)

func TestManualProfileVocabularies(t *testing.T) {
	for _, tc := range []struct {
		input, want string
		valid       bool
	}{
		{"high_school", "high_school", true}, {"bachelor", "bachelor", true}, {"master", "master", true}, {"phd", "phd", true},
		{" BACHELOR ", "bachelor", true}, {"\tPhD\n", "phd", true}, {"", "", false}, {"associate", "", false},
	} {
		t.Run("education/"+tc.input, func(t *testing.T) {
			got, ok := manualEducationLevel(tc.input)
			if got != tc.want || ok != tc.valid {
				t.Fatalf("got %q,%v want %q,%v", got, ok, tc.want, tc.valid)
			}
		})
	}
	for _, tc := range []struct {
		input string
		valid bool
	}{
		{"A1", true}, {"A2", true}, {"B1", true}, {"B2", true}, {"C1", true}, {"C2", true},
		{"", false}, {"b1", false}, {" B1", false}, {"B1 ", false}, {"D1", false},
	} {
		t.Run("CEFR/"+tc.input, func(t *testing.T) {
			got, ok := manualCEFRLevel(tc.input)
			if ok != tc.valid || (ok && got != tc.input) {
				t.Fatalf("got %q,%v", got, ok)
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
