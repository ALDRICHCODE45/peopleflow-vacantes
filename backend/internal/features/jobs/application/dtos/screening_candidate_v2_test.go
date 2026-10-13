package dtos_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
)

func candidateScreeningFixtures() []draftfields.ScreeningQuestionV2 {
	return []draftfields.ScreeningQuestionV2{
		{ID: "b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d", Type: "single_choice_evaluated", Prompt: "¿Qué palabra clave declara una función en Go?", Options: []draftfields.ScreeningOptionV2{{ID: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", Label: "func"}, {ID: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", Label: "function"}}, CorrectOptionID: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"},
		{ID: "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c", Type: "single_choice_informative", Prompt: "¿Qué modalidad de trabajo prefieres?", Options: []draftfields.ScreeningOptionV2{{ID: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", Label: "Remoto"}, {ID: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70", Label: "Híbrido"}}},
		{ID: "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d", Type: "open", Prompt: "Describe un proyecto del que estés orgulloso."},
	}
}

func TestProjectCandidateScreeningV2_ContractExamples(t *testing.T) {
	input := candidateScreeningFixtures()
	got, err := dtos.ProjectCandidateScreeningV2(input)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	// Exact JSON pins every allowed key and excludes private variants, answer
	// keys, flags, scores and null options, not merely a denylisted string.
	want := `[{"id":"b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d","type":"single_choice","prompt":"¿Qué palabra clave declara una función en Go?","options":[{"id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","label":"func"},{"id":"2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e","label":"function"}]},{"id":"c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c","type":"single_choice","prompt":"¿Qué modalidad de trabajo prefieres?","options":[{"id":"3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f","label":"Remoto"},{"id":"4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70","label":"Híbrido"}]},{"id":"d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d","type":"open","prompt":"Describe un proyecto del que estés orgulloso."}]`
	if string(encoded) != want {
		t.Fatalf("wire projection = %s, want %s", encoded, want)
	}
}

func TestProjectCandidateScreeningV2_ChoicePrivacyEquivalence(t *testing.T) {
	input := candidateScreeningFixtures()[0]
	evaluated, err := dtos.ProjectCandidateScreeningV2([]draftfields.ScreeningQuestionV2{input})
	if err != nil {
		t.Fatal(err)
	}
	input.Type = "single_choice_informative"
	input.CorrectOptionID = ""
	informative, err := dtos.ProjectCandidateScreeningV2([]draftfields.ScreeningQuestionV2{input})
	if err != nil {
		t.Fatal(err)
	}
	e, _ := json.Marshal(evaluated)
	i, _ := json.Marshal(informative)
	if string(e) != string(i) {
		t.Fatalf("candidate can distinguish evaluation: %s / %s", e, i)
	}
}

func TestProjectCandidateScreeningV2_Empty(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input []draftfields.ScreeningQuestionV2
	}{{name: "nil"}, {name: "empty", input: []draftfields.ScreeningQuestionV2{}}} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := dtos.ProjectCandidateScreeningV2(tc.input)
			if err != nil || got == nil || len(got) != 0 {
				t.Fatalf("empty projection: %#v %v", got, err)
			}
			encoded, err := json.Marshal(got)
			if err != nil || string(encoded) != "[]" {
				t.Fatalf("empty wire: %s %v", encoded, err)
			}
		})
	}
}

func TestProjectCandidateScreeningV2_NoMutationOrAliasing(t *testing.T) {
	input := candidateScreeningFixtures()
	before := candidateScreeningFixtures()
	got, err := dtos.ProjectCandidateScreeningV2(input)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(input, before) {
		t.Fatal("projection changed employer data")
	}
	got[0].ID = "changed-output"
	got[0].Options[0].Label = "changed-output"
	if !reflect.DeepEqual(input, before) {
		t.Fatal("output aliases employer data")
	}
	input[1].Options[0].Label = "changed-input"
	if got[1].Options[0].Label != "Remoto" {
		t.Fatal("employer data aliases output")
	}
}

func TestProjectCandidateScreeningV2_RejectUnknownWithoutPartialResult(t *testing.T) {
	for _, variant := range []string{"", "single_choice", "future_evaluated"} {
		t.Run("variant_"+variant, func(t *testing.T) {
			input := candidateScreeningFixtures()
			input[1].Type = variant
			before := candidateScreeningFixtures()
			before[1].Type = variant
			got, err := dtos.ProjectCandidateScreeningV2(input)
			if !errors.Is(err, dtos.ErrCandidateScreeningType) || got != nil {
				t.Fatalf("rejection: %#v %v", got, err)
			}
			if !reflect.DeepEqual(input, before) {
				t.Fatal("rejection mutated input")
			}
		})
	}
}
