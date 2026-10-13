package draftfields

import (
	"errors"
	"fmt"
	"maps"
	"reflect"
	"strings"
	"testing"
)

// The expectations in this file were authored before the screening v2 validator
// was implemented. They describe the S3/S4 contract: one present-value API over
// an already-decoded []any of strict typed question objects, three variants
// with exact key sets, UUIDv4 identifiers preserved verbatim, bounded
// prompts/options/labels, nil output on every error, no input mutation and no
// mutable alias.
//
// Missing keys and unknown/forbidden keys are structural errors reported with
// ErrScreeningV2MissingKey and ErrScreeningV2UnknownKey; every other value
// failure reuses the existing collection sentinels. The upstream strict JSON
// decoder owns malformed JSON, duplicate JSON keys and source UTF-8.

// Canonical UUIDv4 literals used across the matrix. Version nibble 4 and RFC
// variant 8-b are valid; none of these is looked up in any catalog.
const (
	screeningV2QuestionID      = "b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
	screeningV2QuestionIDUpper = "B0F1C2D3-4E5F-4A6B-8C7D-9E0F1A2B3C4D"
	screeningV2QuestionIDMixed = "b0f1c2d3-4e5f-4A6b-8C7d-9e0f1a2b3c4d"

	screeningV2OptionIDA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
	screeningV2OptionIDB = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"
	screeningV2OptionIDC = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f"
	screeningV2OptionIDD = "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70"
)

// screeningV2QuestionIDAt returns a distinct valid UUIDv4 for index i.
func screeningV2QuestionIDAt(i int) string {
	return fmt.Sprintf("%08x-4e5f-4a6b-8c7d-9e0f1a2b3c4d", i)
}

// screeningV2OptionIDAt returns a distinct valid UUIDv4 for index i.
func screeningV2OptionIDAt(i int) string {
	return fmt.Sprintf("%08x-5e6f-4a7b-8c9d-0e1f2a3b4c5d", i)
}

// screeningV2OptionMap builds one strict option object.
func screeningV2OptionMap(id, label string) map[string]any {
	return map[string]any{"id": id, "label": label}
}

// screeningV2Options builds a strict options array from id/label pairs.
func screeningV2Options(pairs ...[2]string) []any {
	out := make([]any, len(pairs))
	for i, pair := range pairs {
		out[i] = screeningV2OptionMap(pair[0], pair[1])
	}
	return out
}

// screeningV2OpenMap builds one strict open question.
func screeningV2OpenMap(id, prompt string) map[string]any {
	return map[string]any{
		screeningV2KeyID:     id,
		screeningV2KeyType:   screeningV2TypeOpen,
		screeningV2KeyPrompt: prompt,
	}
}

// screeningV2InformativeMap builds one strict single_choice_informative
// question.
func screeningV2InformativeMap(id, prompt string, options []any) map[string]any {
	return map[string]any{
		screeningV2KeyID:      id,
		screeningV2KeyType:    screeningV2TypeSingleChoiceInformative,
		screeningV2KeyPrompt:  prompt,
		screeningV2KeyOptions: options,
	}
}

// screeningV2EvaluatedMap builds one strict single_choice_evaluated question.
func screeningV2EvaluatedMap(id, prompt string, options []any, correct string) map[string]any {
	return map[string]any{
		screeningV2KeyID:              id,
		screeningV2KeyType:            screeningV2TypeSingleChoiceEvaluated,
		screeningV2KeyPrompt:          prompt,
		screeningV2KeyOptions:         options,
		screeningV2KeyCorrectOptionID: correct,
	}
}

// screeningV2NumberedOptions builds count distinct valid options.
func screeningV2NumberedOptions(count int) []any {
	out := make([]any, count)
	for i := range out {
		out[i] = screeningV2OptionMap(screeningV2OptionIDAt(i), fmt.Sprintf("Option %02d", i))
	}
	return out
}

// screeningV2NumberedQuestions builds count distinct valid open questions.
func screeningV2NumberedQuestions(count int) []any {
	out := make([]any, count)
	for i := range out {
		out[i] = screeningV2OpenMap(screeningV2QuestionIDAt(i), fmt.Sprintf("Prompt %03d", i))
	}
	return out
}

// requireScreeningV2Error asserts the exact sentinel and a nil slice output.
func requireScreeningV2Error(t *testing.T, got []ScreeningQuestionV2, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
	if got != nil {
		t.Errorf("output = %+v, want nil on error", got)
	}
}

// mustScreeningV2 asserts a successful, non-nil result.
func mustScreeningV2(t *testing.T, raw any) []ScreeningQuestionV2 {
	t.Helper()
	got, err := ValidateScreeningQuestionsV2(raw)
	if err != nil {
		t.Fatalf("ValidateScreeningQuestionsV2(%v): %v", raw, err)
	}
	if got == nil {
		t.Fatalf("ValidateScreeningQuestionsV2(%v) = nil, want a slice", raw)
	}
	return got
}

// assertNonNilEmptyScreeningV2Slice asserts a fresh non-nil empty slice.
func assertNonNilEmptyScreeningV2Slice(t *testing.T, got []ScreeningQuestionV2) {
	t.Helper()
	if got == nil {
		t.Fatal("output = nil, want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("len(output) = %d, want 0", len(got))
	}
}

func TestValidateScreeningQuestionsV2_RejectsNullRoot(t *testing.T) {
	t.Run("nil interface", func(t *testing.T) {
		got, err := ValidateScreeningQuestionsV2(nil)
		requireScreeningV2Error(t, got, err, ErrCollectionNilRoot)
	})

	t.Run("typed nil slice", func(t *testing.T) {
		var typedNil []any
		got, err := ValidateScreeningQuestionsV2(typedNil)
		requireScreeningV2Error(t, got, err, ErrCollectionNilRoot)
	})
}

func TestValidateScreeningQuestionsV2_RejectsNonArrayRoot(t *testing.T) {
	values := map[string]any{
		"string":   screeningV2QuestionID,
		"int":      1,
		"float64":  1.0,
		"bool":     true,
		"map":      screeningV2OpenMap(screeningV2QuestionID, "Prompt"),
		"strings":  []string{"Prompt"},
		"struct":   struct{}{},
		"question": []ScreeningQuestionV2{{ID: screeningV2QuestionID}},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateScreeningQuestionsV2(value)
			requireScreeningV2Error(t, got, err, ErrCollectionNotArray)
		})
	}
}

func TestValidateScreeningQuestionsV2_EmptyReturnsFreshNonNilSlice(t *testing.T) {
	first := mustScreeningV2(t, []any{})
	assertNonNilEmptyScreeningV2Slice(t, first)

	second := mustScreeningV2(t, []any{})
	assertNonNilEmptyScreeningV2Slice(t, second)

	first = append(first, ScreeningQuestionV2{ID: screeningV2QuestionID})
	if len(second) != 0 {
		t.Errorf("second result aliased first: %+v", second)
	}
}

func TestValidateScreeningQuestionsV2_QuestionBoundary(t *testing.T) {
	t.Run("100 accepted", func(t *testing.T) {
		got := mustScreeningV2(t, screeningV2NumberedQuestions(100))
		if len(got) != 100 {
			t.Errorf("len(output) = %d, want 100", len(got))
		}
	})

	t.Run("101 rejected", func(t *testing.T) {
		got, err := ValidateScreeningQuestionsV2(screeningV2NumberedQuestions(101))
		requireScreeningV2Error(t, got, err, ErrCollectionTooMany)
	})
}

func TestValidateScreeningQuestionsV2_RejectsNonObjectItems(t *testing.T) {
	var typedNilMap map[string]any
	var typedNilStringPtr *string
	values := map[string]any{
		"null":             nil,
		"string":           screeningV2QuestionID,
		"int":              1,
		"float64":          1.0,
		"bool":             true,
		"slice":            []any{screeningV2QuestionID},
		"typed nil map":    typedNilMap,
		"typed nil string": typedNilStringPtr,
		"struct":           struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateScreeningQuestionsV2([]any{value})
			requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
		})
	}
}

func TestValidateScreeningQuestionsV2_RejectsUnknownType(t *testing.T) {
	t.Run("missing type is structural", func(t *testing.T) {
		in := []any{map[string]any{
			screeningV2KeyID:     screeningV2QuestionID,
			screeningV2KeyPrompt: "Prompt",
		}}
		got, err := ValidateScreeningQuestionsV2(in)
		requireScreeningV2Error(t, got, err, ErrScreeningV2MissingKey)
	})

	t.Run("non-string type is a validation error", func(t *testing.T) {
		values := map[string]any{
			"null":    nil,
			"int":     1,
			"float64": 1.0,
			"bool":    true,
			"map":     map[string]any{},
			"slice":   []any{screeningV2TypeOpen},
			"struct":  struct{}{},
		}
		for name, value := range values {
			t.Run(name, func(t *testing.T) {
				in := []any{map[string]any{
					screeningV2KeyID:     screeningV2QuestionID,
					screeningV2KeyType:   value,
					screeningV2KeyPrompt: "Prompt",
				}}
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
			})
		}
	})

	t.Run("unknown literal never falls back", func(t *testing.T) {
		values := []string{
			"",
			" ",
			" open",
			"open ",
			"OPEN",
			"Open",
			"multiple_choice",
			"single_choice",
			"single_choice_evaluated ",
			"unknown",
		}
		for _, value := range values {
			t.Run(fmt.Sprintf("%q", value), func(t *testing.T) {
				in := []any{screeningV2OpenMap(screeningV2QuestionID, "Prompt")}
				in[0].(map[string]any)[screeningV2KeyType] = value
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionInvalidLiteral)
			})
		}
	})
}

func TestValidateScreeningQuestionsV2_StrictKeySets(t *testing.T) {
	options := screeningV2Options(
		[2]string{screeningV2OptionIDA, "A"},
		[2]string{screeningV2OptionIDB, "B"},
	)
	valid := map[string]map[string]any{
		"open":                      screeningV2OpenMap(screeningV2QuestionID, "Prompt"),
		"single_choice_informative": screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options),
		"single_choice_evaluated":   screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, screeningV2OptionIDA),
	}
	for name, question := range valid {
		t.Run(name+"/accepted", func(t *testing.T) {
			if _, err := ValidateScreeningQuestionsV2([]any{question}); err != nil {
				t.Fatalf("ValidateScreeningQuestionsV2(%v): %v", question, err)
			}
		})
	}

	t.Run("missing each required key is structural", func(t *testing.T) {
		cases := map[string]struct {
			base map[string]any
			key  string
		}{
			"open id":                     {screeningV2OpenMap(screeningV2QuestionID, "Prompt"), screeningV2KeyID},
			"open prompt":                 {screeningV2OpenMap(screeningV2QuestionID, "Prompt"), screeningV2KeyPrompt},
			"informative id":              {screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options), screeningV2KeyID},
			"informative prompt":          {screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options), screeningV2KeyPrompt},
			"informative options":         {screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options), screeningV2KeyOptions},
			"evaluated id":                {screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, screeningV2OptionIDA), screeningV2KeyID},
			"evaluated prompt":            {screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, screeningV2OptionIDA), screeningV2KeyPrompt},
			"evaluated options":           {screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, screeningV2OptionIDA), screeningV2KeyOptions},
			"evaluated correct_option_id": {screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, screeningV2OptionIDA), screeningV2KeyCorrectOptionID},
		}
		for name, tc := range cases {
			t.Run(name, func(t *testing.T) {
				question := maps.Clone(tc.base)
				delete(question, tc.key)
				got, err := ValidateScreeningQuestionsV2([]any{question})
				requireScreeningV2Error(t, got, err, ErrScreeningV2MissingKey)
			})
		}
	})

	t.Run("unknown and forbidden keys are structural even when null", func(t *testing.T) {
		cases := map[string]struct {
			base map[string]any
			key  string
		}{
			"open options":                  {screeningV2OpenMap(screeningV2QuestionID, "Prompt"), screeningV2KeyOptions},
			"open correct_option_id":        {screeningV2OpenMap(screeningV2QuestionID, "Prompt"), screeningV2KeyCorrectOptionID},
			"informative correct_option_id": {screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options), screeningV2KeyCorrectOptionID},
			"extra unknown":                 {screeningV2OpenMap(screeningV2QuestionID, "Prompt"), "score"},
			"extra null unknown":            {screeningV2OpenMap(screeningV2QuestionID, "Prompt"), "knockout"},
			"extra typed key":               {screeningV2OpenMap(screeningV2QuestionID, "Prompt"), "ID"},
		}
		for name, tc := range cases {
			t.Run(name, func(t *testing.T) {
				question := maps.Clone(tc.base)
				question[tc.key] = nil
				got, err := ValidateScreeningQuestionsV2([]any{question})
				requireScreeningV2Error(t, got, err, ErrScreeningV2UnknownKey)
			})
		}
	})
}

func TestValidateScreeningQuestionsV2_AcceptsCanonicalVariants(t *testing.T) {
	options := screeningV2Options(
		[2]string{screeningV2OptionIDA, "func"},
		[2]string{screeningV2OptionIDB, "function"},
	)
	in := []any{
		screeningV2EvaluatedMap(screeningV2QuestionID, "¿Qué palabra clave declara una función en Go?", options, screeningV2OptionIDA),
		screeningV2InformativeMap(screeningV2QuestionIDAt(1), "¿Qué modalidad de trabajo prefieres?", options),
		screeningV2OpenMap(screeningV2QuestionIDAt(2), "Describe un proyecto del que estés orgulloso."),
	}

	got := mustScreeningV2(t, in)
	if len(got) != 3 {
		t.Fatalf("len(output) = %d, want 3", len(got))
	}
	if got[0].Type != screeningV2TypeSingleChoiceEvaluated {
		t.Errorf("output[0].Type = %q, want %q", got[0].Type, screeningV2TypeSingleChoiceEvaluated)
	}
	if got[1].Type != screeningV2TypeSingleChoiceInformative {
		t.Errorf("output[1].Type = %q, want %q", got[1].Type, screeningV2TypeSingleChoiceInformative)
	}
	if got[2].Type != screeningV2TypeOpen {
		t.Errorf("output[2].Type = %q, want %q", got[2].Type, screeningV2TypeOpen)
	}
	if got[2].Options != nil {
		t.Errorf("open Options = %+v, want nil", got[2].Options)
	}
	if got[2].CorrectOptionID != "" {
		t.Errorf("open CorrectOptionID = %q, want empty", got[2].CorrectOptionID)
	}
	if got[1].CorrectOptionID != "" {
		t.Errorf("informative CorrectOptionID = %q, want empty", got[1].CorrectOptionID)
	}
	if got[0].CorrectOptionID != screeningV2OptionIDA {
		t.Errorf("evaluated CorrectOptionID = %q, want %q", got[0].CorrectOptionID, screeningV2OptionIDA)
	}
}

func TestValidateScreeningQuestionsV2_QuestionIDRules(t *testing.T) {
	t.Run("valid UUIDv4 spellings preserved verbatim", func(t *testing.T) {
		ids := []string{screeningV2QuestionID, screeningV2QuestionIDUpper, screeningV2QuestionIDMixed}
		for _, id := range ids {
			t.Run(id, func(t *testing.T) {
				got := mustScreeningV2(t, []any{screeningV2OpenMap(id, "Prompt")})
				if got[0].ID != id {
					t.Errorf("ID = %q, want %q preserved", got[0].ID, id)
				}
			})
		}
	})

	t.Run("invalid UUIDv4 rejected", func(t *testing.T) {
		wrongVersion := "b0f1c2d3-4e5f-3a6b-8c7d-9e0f1a2b3c4d"
		wrongVersionFive := "b0f1c2d3-4e5f-5a6b-8c7d-9e0f1a2b3c4d"
		wrongVariantSeven := "b0f1c2d3-4e5f-4a6b-7c7d-9e0f1a2b3c4d"
		wrongVariantC := "b0f1c2d3-4e5f-4a6b-cc7d-9e0f1a2b3c4d"
		ids := map[string]string{
			"empty":           "",
			"compact 32":      strings.ReplaceAll(screeningV2QuestionID, "-", ""),
			"braces":          "{" + screeningV2QuestionID + "}",
			"urn":             "urn:uuid:" + screeningV2QuestionID,
			"nil uuid":        "00000000-0000-0000-0000-000000000000",
			"wrong version 3": wrongVersion,
			"wrong version 5": wrongVersionFive,
			"wrong variant 7": wrongVariantSeven,
			"wrong variant c": wrongVariantC,
			"trailing space":  screeningV2QuestionID + " ",
			"leading space":   " " + screeningV2QuestionID,
			"non hex":         screeningV2QuestionID[:35] + "g",
			"35 chars":        screeningV2QuestionID[:35],
			"37 chars":        screeningV2QuestionID + "0",
		}
		for name, id := range ids {
			t.Run(name, func(t *testing.T) {
				got, err := ValidateScreeningQuestionsV2([]any{screeningV2OpenMap(id, "Prompt")})
				requireScreeningV2Error(t, got, err, ErrCollectionInvalidLiteral)
			})
		}
	})

	t.Run("non-string id is a wrong type", func(t *testing.T) {
		values := map[string]any{
			"null":    nil,
			"int":     1,
			"float64": 1.0,
			"bool":    true,
			"map":     map[string]any{},
			"slice":   []any{screeningV2QuestionID},
		}
		for name, value := range values {
			t.Run(name, func(t *testing.T) {
				in := []any{screeningV2OpenMap(screeningV2QuestionID, "Prompt")}
				in[0].(map[string]any)[screeningV2KeyID] = value
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
			})
		}
	})
}

func TestValidateScreeningQuestionsV2_QuestionIDUniqueness(t *testing.T) {
	t.Run("distinct ids accepted", func(t *testing.T) {
		in := []any{
			screeningV2OpenMap(screeningV2QuestionID, "First"),
			screeningV2OpenMap(screeningV2QuestionIDAt(1), "Second"),
		}
		if _, err := ValidateScreeningQuestionsV2(in); err != nil {
			t.Fatalf("ValidateScreeningQuestionsV2: %v", err)
		}
	})

	t.Run("exact duplicate rejected", func(t *testing.T) {
		in := []any{
			screeningV2OpenMap(screeningV2QuestionID, "First"),
			screeningV2OpenMap(screeningV2QuestionID, "Second"),
		}
		got, err := ValidateScreeningQuestionsV2(in)
		requireScreeningV2Error(t, got, err, ErrCollectionDuplicate)
	})

	t.Run("case-only duplicate rejected", func(t *testing.T) {
		in := []any{
			screeningV2OpenMap(screeningV2QuestionID, "First"),
			screeningV2OpenMap(screeningV2QuestionIDUpper, "Second"),
		}
		got, err := ValidateScreeningQuestionsV2(in)
		requireScreeningV2Error(t, got, err, ErrCollectionDuplicate)
	})
}

func TestValidateScreeningQuestionsV2_PromptRules(t *testing.T) {
	t.Run("end trimming and preservation", func(t *testing.T) {
		got := mustScreeningV2(t, []any{screeningV2OpenMap(screeningV2QuestionID, "  ¿Qué prefieres?  ")})
		if got[0].Prompt != "¿Qué prefieres?" {
			t.Errorf("Prompt = %q, want trimmed literal", got[0].Prompt)
		}
	})

	t.Run("repeated prompts are legal", func(t *testing.T) {
		in := []any{
			screeningV2OpenMap(screeningV2QuestionID, "Same prompt"),
			screeningV2OpenMap(screeningV2QuestionIDAt(1), "Same prompt"),
		}
		if _, err := ValidateScreeningQuestionsV2(in); err != nil {
			t.Fatalf("ValidateScreeningQuestionsV2: %v", err)
		}
	})

	t.Run("wrong dynamic type", func(t *testing.T) {
		values := map[string]any{
			"null":    nil,
			"int":     1,
			"float64": 1.0,
			"bool":    true,
			"map":     map[string]any{},
			"slice":   []any{"Prompt"},
		}
		for name, value := range values {
			t.Run(name, func(t *testing.T) {
				in := []any{screeningV2OpenMap(screeningV2QuestionID, "Prompt")}
				in[0].(map[string]any)[screeningV2KeyPrompt] = value
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
			})
		}
	})

	t.Run("empty after trim", func(t *testing.T) {
		for _, prompt := range []string{"", " ", "\t\n", "\u00a0\u3000"} {
			t.Run(fmt.Sprintf("%q", prompt), func(t *testing.T) {
				in := []any{screeningV2OpenMap(screeningV2QuestionID, prompt)}
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionEmpty)
			})
		}
	})

	t.Run("invalid utf8", func(t *testing.T) {
		for _, prompt := range []string{"\xff", "Pr\xffompt", "\xc3", "\xed\xa0\x80"} {
			t.Run(fmt.Sprintf("%q", prompt), func(t *testing.T) {
				in := []any{screeningV2OpenMap(screeningV2QuestionID, prompt)}
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionInvalidUTF8)
			})
		}
	})

	t.Run("2000 codepoints accepted, 2001 rejected", func(t *testing.T) {
		accepted := strings.Repeat("a", 2000)
		if _, err := ValidateScreeningQuestionsV2([]any{screeningV2OpenMap(screeningV2QuestionID, accepted)}); err != nil {
			t.Fatalf("ValidateScreeningQuestionsV2(2000): %v", err)
		}
		got, err := ValidateScreeningQuestionsV2([]any{screeningV2OpenMap(screeningV2QuestionID, strings.Repeat("a", 2001))})
		requireScreeningV2Error(t, got, err, ErrCollectionTooLong)
	})

	t.Run("limit measured in codepoints after trimming", func(t *testing.T) {
		astral := strings.Repeat("\U0001f600", 2000)
		if _, err := ValidateScreeningQuestionsV2([]any{screeningV2OpenMap(screeningV2QuestionID, "  "+astral+"  ")}); err != nil {
			t.Fatalf("ValidateScreeningQuestionsV2(2000 astral): %v", err)
		}
		got, err := ValidateScreeningQuestionsV2([]any{screeningV2OpenMap(screeningV2QuestionID, strings.Repeat("\U0001f600", 2001))})
		requireScreeningV2Error(t, got, err, ErrCollectionTooLong)
	})
}

func TestValidateScreeningQuestionsV2_OptionRules(t *testing.T) {
	t.Run("2 and 8 accepted, 0 1 and 9 rejected", func(t *testing.T) {
		for _, count := range []int{2, 8} {
			t.Run(fmt.Sprintf("%d accepted", count), func(t *testing.T) {
				in := []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2NumberedOptions(count))}
				got := mustScreeningV2(t, in)
				if len(got[0].Options) != count {
					t.Errorf("len(Options) = %d, want %d", len(got[0].Options), count)
				}
			})
		}

		got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2NumberedOptions(0))})
		requireScreeningV2Error(t, got, err, ErrCollectionInvalidLiteral)

		got, err = ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2NumberedOptions(1))})
		requireScreeningV2Error(t, got, err, ErrCollectionInvalidLiteral)

		got, err = ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2NumberedOptions(9))})
		requireScreeningV2Error(t, got, err, ErrCollectionTooMany)
	})

	t.Run("options null or wrong root type is a wrong type", func(t *testing.T) {
		values := map[string]any{
			"null":            nil,
			"typed nil slice": []any(nil),
			"string":          "A",
			"int":             1,
			"map":             map[string]any{"id": screeningV2OptionIDA},
			"strings":         []string{screeningV2OptionIDA},
			"struct":          struct{}{},
		}
		for name, value := range values {
			t.Run(name, func(t *testing.T) {
				in := []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", nil)}
				in[0].(map[string]any)[screeningV2KeyOptions] = value
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
			})
		}
	})

	t.Run("option item must be a non-nil object", func(t *testing.T) {
		var typedNilMap map[string]any
		values := map[string]any{
			"null":      nil,
			"string":    screeningV2OptionIDA,
			"int":       1,
			"slice":     []any{screeningV2OptionIDA},
			"typed nil": typedNilMap,
			"struct":    struct{}{},
		}
		for name, value := range values {
			t.Run(name, func(t *testing.T) {
				options := []any{screeningV2OptionMap(screeningV2OptionIDA, "A"), value}
				in := []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)}
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
			})
		}
	})

	t.Run("option strict keys", func(t *testing.T) {
		t.Run("missing id", func(t *testing.T) {
			options := []any{map[string]any{"label": "A"}, screeningV2OptionMap(screeningV2OptionIDB, "B")}
			got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
			requireScreeningV2Error(t, got, err, ErrScreeningV2MissingKey)
		})
		t.Run("missing label", func(t *testing.T) {
			options := []any{map[string]any{"id": screeningV2OptionIDA}, screeningV2OptionMap(screeningV2OptionIDB, "B")}
			got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
			requireScreeningV2Error(t, got, err, ErrScreeningV2MissingKey)
		})
		for _, key := range []string{"correct_option_id", "value", "prompt", "id_label", "", "ID"} {
			t.Run("extra "+key, func(t *testing.T) {
				item := screeningV2OptionMap(screeningV2OptionIDA, "A")
				item[key] = nil
				options := []any{item, screeningV2OptionMap(screeningV2OptionIDB, "B")}
				got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
				requireScreeningV2Error(t, got, err, ErrScreeningV2UnknownKey)
			})
		}
	})

	t.Run("order preserved", func(t *testing.T) {
		options := screeningV2NumberedOptions(4)
		got := mustScreeningV2(t, []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		for i := range got[0].Options {
			if got[0].Options[i].ID != screeningV2OptionIDAt(i) {
				t.Errorf("Options[%d].ID = %q, want %q", i, got[0].Options[i].ID, screeningV2OptionIDAt(i))
			}
		}
	})
}

func TestValidateScreeningQuestionsV2_OptionIDRules(t *testing.T) {
	t.Run("valid UUIDv4 spellings preserved verbatim", func(t *testing.T) {
		upper := strings.ToUpper(screeningV2OptionIDA)
		options := screeningV2Options(
			[2]string{upper, "A"},
			[2]string{screeningV2OptionIDB, "B"},
		)
		got := mustScreeningV2(t, []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		if got[0].Options[0].ID != upper {
			t.Errorf("Options[0].ID = %q, want %q", got[0].Options[0].ID, upper)
		}
	})

	t.Run("non-v4 and non-string rejected", func(t *testing.T) {
		wrongVersion := "1a2b3c4d-5e6f-3a7b-8c9d-0e1f2a3b4c5d"
		got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2Options(
			[2]string{wrongVersion, "A"},
			[2]string{screeningV2OptionIDB, "B"},
		))})
		requireScreeningV2Error(t, got, err, ErrCollectionInvalidLiteral)

		options := screeningV2Options([2]string{screeningV2OptionIDA, "A"}, [2]string{screeningV2OptionIDB, "B"})
		options[0].(map[string]any)["id"] = 7
		got, err = ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
	})

	t.Run("case-only duplicate within one question rejected", func(t *testing.T) {
		options := screeningV2Options(
			[2]string{screeningV2OptionIDA, "A"},
			[2]string{strings.ToUpper(screeningV2OptionIDA), "B"},
		)
		got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		requireScreeningV2Error(t, got, err, ErrCollectionDuplicate)
	})

	t.Run("same option id across questions is legal", func(t *testing.T) {
		optionsA := screeningV2Options([2]string{screeningV2OptionIDA, "A"}, [2]string{screeningV2OptionIDB, "B"})
		optionsB := screeningV2Options([2]string{screeningV2OptionIDA, "A"}, [2]string{screeningV2OptionIDB, "B"})
		in := []any{
			screeningV2InformativeMap(screeningV2QuestionID, "First", optionsA),
			screeningV2InformativeMap(screeningV2QuestionIDAt(1), "Second", optionsB),
		}
		if _, err := ValidateScreeningQuestionsV2(in); err != nil {
			t.Fatalf("ValidateScreeningQuestionsV2: %v", err)
		}
	})
}

func TestValidateScreeningQuestionsV2_OptionLabelRules(t *testing.T) {
	t.Run("trim and preservation", func(t *testing.T) {
		options := screeningV2Options(
			[2]string{screeningV2OptionIDA, "  Remoto  "},
			[2]string{screeningV2OptionIDB, "Híbrido"},
		)
		got := mustScreeningV2(t, []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		if got[0].Options[0].Label != "Remoto" {
			t.Errorf("Label = %q, want %q", got[0].Options[0].Label, "Remoto")
		}
		if got[0].Options[1].Label != "Híbrido" {
			t.Errorf("Label = %q, want %q", got[0].Options[1].Label, "Híbrido")
		}
	})

	t.Run("wrong dynamic type", func(t *testing.T) {
		options := screeningV2Options([2]string{screeningV2OptionIDA, "A"}, [2]string{screeningV2OptionIDB, "B"})
		options[0].(map[string]any)["label"] = nil
		got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
	})

	t.Run("empty after trim", func(t *testing.T) {
		for _, label := range []string{"", " ", "\t\n", "\u00a0"} {
			options := screeningV2Options([2]string{screeningV2OptionIDA, label}, [2]string{screeningV2OptionIDB, "B"})
			got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
			requireScreeningV2Error(t, got, err, ErrCollectionEmpty)
		}
	})

	t.Run("invalid utf8", func(t *testing.T) {
		options := screeningV2Options([2]string{screeningV2OptionIDA, "A\xff"}, [2]string{screeningV2OptionIDB, "B"})
		got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		requireScreeningV2Error(t, got, err, ErrCollectionInvalidUTF8)
	})

	t.Run("200 accepted, 201 rejected, measured after trim in codepoints", func(t *testing.T) {
		accepted := "  " + strings.Repeat("\U0001f600", 200) + "  "
		options := screeningV2Options([2]string{screeningV2OptionIDA, accepted}, [2]string{screeningV2OptionIDB, "B"})
		got := mustScreeningV2(t, []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		if len(got[0].Options[0].Label) != len(strings.Repeat("\U0001f600", 200)) {
			t.Errorf("accepted label byte length changed")
		}

		tooLong := screeningV2Options(
			[2]string{screeningV2OptionIDA, strings.Repeat("a", 201)},
			[2]string{screeningV2OptionIDB, "B"},
		)
		got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", tooLong)})
		requireScreeningV2Error(t, got, err, ErrCollectionTooLong)
	})

	t.Run("duplicate trimmed labels rejected, case-sensitive", func(t *testing.T) {
		options := screeningV2Options(
			[2]string{screeningV2OptionIDA, "Remoto"},
			[2]string{screeningV2OptionIDB, "  Remoto  "},
		)
		got, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)})
		requireScreeningV2Error(t, got, err, ErrCollectionDuplicate)

		caseVariant := screeningV2Options(
			[2]string{screeningV2OptionIDA, "Remoto"},
			[2]string{screeningV2OptionIDB, "remoto"},
		)
		if _, err := ValidateScreeningQuestionsV2([]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", caseVariant)}); err != nil {
			t.Fatalf("case variant must be legal: %v", err)
		}
	})
}

func TestValidateScreeningQuestionsV2_CorrectOptionIDRules(t *testing.T) {
	options := screeningV2Options(
		[2]string{screeningV2OptionIDA, "A"},
		[2]string{screeningV2OptionIDB, "B"},
	)

	t.Run("exact member accepted", func(t *testing.T) {
		for _, correct := range []string{screeningV2OptionIDA, screeningV2OptionIDB} {
			in := []any{screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, correct)}
			got := mustScreeningV2(t, in)
			if got[0].CorrectOptionID != correct {
				t.Errorf("CorrectOptionID = %q, want %q", got[0].CorrectOptionID, correct)
			}
		}
	})

	t.Run("non-member rejected", func(t *testing.T) {
		for _, correct := range []string{"", screeningV2OptionIDC, "not-a-uuid", screeningV2QuestionID} {
			in := []any{screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, correct)}
			got, err := ValidateScreeningQuestionsV2(in)
			requireScreeningV2Error(t, got, err, ErrCollectionInvalidLiteral)
		}
	})

	t.Run("case-only difference is not a member", func(t *testing.T) {
		in := []any{screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, strings.ToUpper(screeningV2OptionIDA))}
		got, err := ValidateScreeningQuestionsV2(in)
		requireScreeningV2Error(t, got, err, ErrCollectionInvalidLiteral)
	})

	t.Run("null or non-string is a wrong type", func(t *testing.T) {
		values := map[string]any{
			"null":    nil,
			"int":     1,
			"float64": 1.0,
			"bool":    true,
			"map":     map[string]any{},
			"slice":   []any{screeningV2OptionIDA},
		}
		for name, value := range values {
			t.Run(name, func(t *testing.T) {
				in := []any{screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, screeningV2OptionIDA)}
				in[0].(map[string]any)[screeningV2KeyCorrectOptionID] = value
				got, err := ValidateScreeningQuestionsV2(in)
				requireScreeningV2Error(t, got, err, ErrCollectionWrongType)
			})
		}
	})
}

func TestValidateScreeningQuestionsV2_PreservesQuestionOrder(t *testing.T) {
	in := []any{
		screeningV2OpenMap(screeningV2QuestionIDAt(2), "Third"),
		screeningV2OpenMap(screeningV2QuestionIDAt(0), "First"),
		screeningV2OpenMap(screeningV2QuestionIDAt(1), "Second"),
	}
	got := mustScreeningV2(t, in)
	wantIDs := []string{screeningV2QuestionIDAt(2), screeningV2QuestionIDAt(0), screeningV2QuestionIDAt(1)}
	for i, want := range wantIDs {
		if got[i].ID != want {
			t.Errorf("output[%d].ID = %q, want %q", i, got[i].ID, want)
		}
	}
}

func TestValidateScreeningQuestionsV2_DoesNotMutateInput(t *testing.T) {
	options := screeningV2Options(
		[2]string{screeningV2OptionIDA, "  A  "},
		[2]string{screeningV2OptionIDB, "B"},
	)
	question := screeningV2EvaluatedMap(screeningV2QuestionID, "  Prompt  ", options, screeningV2OptionIDA)
	in := []any{question}
	before := map[string]any{
		"id":     screeningV2QuestionID,
		"type":   screeningV2TypeSingleChoiceEvaluated,
		"prompt": "  Prompt  ",
		"options": screeningV2Options(
			[2]string{screeningV2OptionIDA, "  A  "},
			[2]string{screeningV2OptionIDB, "B"},
		),
		"correct_option_id": screeningV2OptionIDA,
	}

	if _, err := ValidateScreeningQuestionsV2(in); err != nil {
		t.Fatalf("ValidateScreeningQuestionsV2: %v", err)
	}
	if !reflect.DeepEqual(question, before) {
		t.Errorf("input question mutated: got %v, want %v", question, before)
	}
	if len(in) != 1 || !reflect.DeepEqual(in[0], before) {
		t.Errorf("input slice mutated: %v", in)
	}
}

func TestValidateScreeningQuestionsV2_OutputDoesNotAliasInput(t *testing.T) {
	options := screeningV2Options(
		[2]string{screeningV2OptionIDA, "A"},
		[2]string{screeningV2OptionIDB, "B"},
	)
	in := []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)}

	first := mustScreeningV2(t, in)
	second := mustScreeningV2(t, in)

	if first[0].Options == nil || second[0].Options == nil {
		t.Fatal("expected non-nil option slices")
	}
	first[0].Options[0].Label = "changed"
	first[0].Options[0].ID = "changed"
	if second[0].Options[0].Label != "A" || second[0].Options[0].ID != screeningV2OptionIDA {
		t.Errorf("two calls aliased the same options: %+v", second[0].Options)
	}
	if options[0].(map[string]any)["label"] != "A" {
		t.Errorf("returned options aliased the input: %v", options)
	}
}

// screeningV2QuestionWithType builds an otherwise-valid open question whose
// type literal is value.
func screeningV2QuestionWithType(value string) map[string]any {
	question := screeningV2OpenMap(screeningV2QuestionID, "Prompt")
	question[screeningV2KeyType] = value
	return question
}

// screeningV2OpenWithForbiddenOption builds an open question carrying a null
// options key, which is still a forbidden key.
func screeningV2OpenWithForbiddenOption() map[string]any {
	question := screeningV2OpenMap(screeningV2QuestionID, "Prompt")
	question[screeningV2KeyOptions] = nil
	return question
}

func TestValidateScreeningQuestionsV2_ErrorOutputIsNil(t *testing.T) {
	options := screeningV2Options([2]string{screeningV2OptionIDA, "A"}, [2]string{screeningV2OptionIDB, "B"})
	cases := map[string]any{
		"null root":          nil,
		"not array":          "questions",
		"not object":         []any{"question"},
		"missing type":       []any{map[string]any{"id": screeningV2QuestionID, "prompt": "Prompt"}},
		"null type":          []any{map[string]any{"id": screeningV2QuestionID, "type": nil, "prompt": "Prompt"}},
		"unknown type":       []any{screeningV2QuestionWithType("multiple_choice")},
		"missing prompt":     []any{map[string]any{"id": screeningV2QuestionID, "type": screeningV2TypeOpen}},
		"forbidden key":      []any{screeningV2OpenWithForbiddenOption()},
		"bad id":             []any{screeningV2OpenMap("not-a-uuid", "Prompt")},
		"duplicate id":       []any{screeningV2OpenMap(screeningV2QuestionID, "A"), screeningV2OpenMap(screeningV2QuestionID, "B")},
		"empty prompt":       []any{screeningV2OpenMap(screeningV2QuestionID, " ")},
		"too few options":    []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2NumberedOptions(1))},
		"too many options":   []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2NumberedOptions(9))},
		"duplicate labels":   []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2Options([2]string{screeningV2OptionIDA, "A"}, [2]string{screeningV2OptionIDB, " A "}))},
		"bad membership":     []any{screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, screeningV2OptionIDC)},
		"too many questions": screeningV2NumberedQuestions(101),
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateScreeningQuestionsV2(in)
			if err == nil {
				t.Fatalf("ValidateScreeningQuestionsV2(%v) err = nil, want error", in)
			}
			if got != nil {
				t.Errorf("output = %+v, want nil", got)
			}
		})
	}

	t.Run("unknown type case is explicit", func(t *testing.T) {
		in := []any{screeningV2OpenMap(screeningV2QuestionID, "Prompt")}
		in[0].(map[string]any)[screeningV2KeyType] = "multiple_choice"
		got, err := ValidateScreeningQuestionsV2(in)
		requireScreeningV2Error(t, got, err, ErrCollectionInvalidLiteral)
	})

	t.Run("forbidden key case is explicit", func(t *testing.T) {
		in := []any{screeningV2OpenMap(screeningV2QuestionID, "Prompt")}
		in[0].(map[string]any)[screeningV2KeyOptions] = nil
		got, err := ValidateScreeningQuestionsV2(in)
		requireScreeningV2Error(t, got, err, ErrScreeningV2UnknownKey)
	})
}

// TestValidateScreeningQuestionsV2_V1PromptOnlyRegression is a read-only guard
// that the untouched v1 validator still accepts the prompt-only shape and
// rejects the v2 keys.
func TestValidateScreeningQuestionsV2_V1PromptOnlyRegression(t *testing.T) {
	got, err := ValidateScreeningQuestions([]any{map[string]any{"prompt": "  ¿Qué prefieres?  "}})
	if err != nil {
		t.Fatalf("v1 ValidateScreeningQuestions: %v", err)
	}
	if len(got) != 1 || got[0].Prompt != "¿Qué prefieres?" {
		t.Fatalf("v1 output = %+v, want one trimmed prompt", got)
	}

	withID := []any{map[string]any{"prompt": "Prompt", "id": screeningV2QuestionID}}
	if _, err := ValidateScreeningQuestions(withID); !errors.Is(err, ErrScreeningQuestionUnknownKey) {
		t.Fatalf("v1 with id err = %v, want ErrScreeningQuestionUnknownKey", err)
	}
}
